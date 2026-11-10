#!/usr/bin/env node
// The one CLI. Every slash command in .claude/commands drives it.
//
//   npm run fleet -- <command> [arguments] [--json]
//   npm run fleet -- help
//
// Reads print a table (or JSON with --json). Writes take a JSON file (--data=)
// or explicit flags, resolve names case-insensitively and by id prefix, and
// list the candidates and exit 1 when a name matches more than one record.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table } from './lib/format.mjs';
import { checkDriver } from './lib/fatigue.mjs';

// ---------------------------------------------------------------- record types

export const fields = {
  vehicles: ['code', 'rego', 'name', 'kind', 'gvm_kg', 'rego_due', 'inspection_due', 'service_interval_km', 'service_interval_days', 'odometer_km', 'odometer_on', 'maintenance_scheme', 'status', 'notes'],
  drivers: ['code', 'name', 'licence_class', 'fatigue_option', 'work_diary', 'base', 'phone', 'active', 'notes'],
  credentials: ['code', 'driver_id', 'kind', 'name', 'reference', 'expires_on', 'evidence'],
  subcontractors: ['code', 'name', 'abn', 'contact_email', 'accreditation', 'insurance_due', 'cor_acknowledged_on', 'last_review_on', 'status', 'notes'],
  defects: ['code', 'vehicle_id', 'reported_on', 'reported_by', 'description', 'severity', 'status', 'repaired_on', 'repair_note'],
  services: ['code', 'vehicle_id', 'kind', 'done_on', 'odometer_km', 'workshop', 'cost_cents', 'notes'],
  work_periods: ['code', 'driver_id', 'starts_at', 'ends_at', 'source', 'evidence'],
  trips: ['code', 'customer', 'departs_at', 'arrives_at', 'origin', 'destination', 'distance_km', 'beyond_100km', 'vehicle_id', 'trailer_id', 'driver_id', 'subcontractor_id', 'mass_limit_kg', 'gross_mass_kg', 'weighed_by', 'restraint_checked', 'status', 'notes'],
  incidents: ['code', 'occurred_on', 'kind', 'vehicle_id', 'driver_id', 'description', 'notifiable', 'notified_on', 'root_cause', 'corrective_action', 'action_due', 'closed_on'],
};
const refs = { driver_id: 'drivers', vehicle_id: 'vehicles', trailer_id: 'vehicles', subcontractor_id: 'subcontractors' };
const integers = ['gvm_kg', 'service_interval_km', 'service_interval_days', 'odometer_km', 'cost_cents', 'distance_km', 'mass_limit_kg', 'gross_mass_kg'];
const booleans = ['active', 'beyond_100km', 'restraint_checked', 'notifiable'];
const required = ['code', 'name', 'rego', 'customer', 'origin', 'destination', 'description', 'reported_by', 'kind', 'status', 'severity'];
const nameColumn = { vehicles: 'rego', credentials: 'name', defects: 'description', services: 'workshop', work_periods: 'source', trips: 'customer', incidents: 'description' };

// ---------------------------------------------------------------- reads

export const reads = {
  vehicles: 'select code,rego,name,kind,status,rego_due,inspection_due,odometer_km,maintenance_scheme from vehicles order by code',
  drivers: 'select code,name,licence_class,fatigue_option,work_diary,base,active from drivers order by name',
  subcontractors: 'select code,name,accreditation,insurance_due,cor_acknowledged_on,last_review_on,open_trips,status from subcontractor_status order by name',
  trips: 'select code,customer,departs_at,origin,destination,vehicle,trailer,carrier,status,mass_category from trip_mass order by departs_at desc',
  credentials: 'select code,driver,kind,name,expires_on,days_left from credential_status order by expires_on nulls first',
  incidents: 'select code,occurred_on,kind,vehicle,driver,notifiable,notified_on,action_due,closed_on from incident_actions order by occurred_on desc',
  'service-due': `select code,rego,name,odometer_km,next_service_km,km_remaining,next_service_on,days_remaining from service_due
    where (km_remaining is not null and km_remaining <= 3000) or (days_remaining is not null and days_remaining <= 30)
       or (next_service_km is null and next_service_on is null and kind <> 'light')
    order by least(coalesce(km_remaining / 100, 9999), coalesce(days_remaining, 9999))`,
  'rego-due': `select code,rego,name,kind,rego_due,rego_due - current_date days_left,inspection_due,inspection_due - current_date inspection_days_left from vehicles
    where status <> 'retired' and (rego_due is null or rego_due <= current_date + 30 or inspection_due <= current_date + 30) order by least(rego_due, inspection_due) nulls first`,
  'credentials-due': `select code,driver,kind,name,expires_on,days_left,evidence from credential_status
    where expires_on is null or expires_on <= current_date + 30 order by expires_on nulls first`,
  'open-defects': 'select code,vehicle,rego,severity,status,reported_on,reported_by,days_open,planned_trips,description from open_defects order by severity, days_open desc',
  grounded: `select x.vehicle,x.rego,x.code defect,x.description,x.days_open,t.code trip,t.departs_at,t.customer from open_defects x
    join vehicles v on v.code = x.vehicle join trips t on (t.vehicle_id = v.id or t.trailer_id = v.id) and t.status = 'planned'
    where x.severity = 'major' and x.status = 'open' order by t.departs_at`,
  mass: `select code,customer,departs_at,vehicle,trailer,carrier,mass_limit_kg,gross_mass_kg,over_pct,mass_category from trip_mass
    where mass_category not in ('within limit','not weighed') order by over_pct desc`,
  unweighed: `select code,customer,departs_at,vehicle,carrier,status,mass_category,restraint_checked from trip_mass
    where status in ('departed','delivered') and (mass_category = 'not weighed' or not restraint_checked) order by departs_at desc`,
  'diary-gaps': `select t.code,t.departs_at,t.origin,t.destination,d.code driver_code,d.name driver,d.work_diary,
    (select count(*)::int from work_periods w where w.driver_id = d.id and w.starts_at < coalesce(t.arrives_at, t.departs_at + interval '12 hours') and w.ends_at > t.departs_at) periods_recorded
    from trips t join drivers d on d.id = t.driver_id
    where t.beyond_100km and t.status <> 'cancelled' and (d.work_diary = 'none' or not exists (
      select 1 from work_periods w where w.driver_id = d.id and w.starts_at < coalesce(t.arrives_at, t.departs_at + interval '12 hours') and w.ends_at > t.departs_at))
      and t.departs_at <= now()
    order by t.departs_at desc`,
  'subcontractor-review': `select code,name,accreditation,insurance_due,insurance_days_left,cor_acknowledged_on,last_review_on,days_since_review,open_trips,trips_90_days from subcontractor_status
    where status = 'active' and (insurance_due is null or insurance_days_left <= 30 or cor_acknowledged_on is null or last_review_on is null or days_since_review > 365)
    order by open_trips desc, insurance_due nulls first`,
  'actions-due': `select code,occurred_on,kind,vehicle,driver,corrective_action,action_due,days_overdue,notifiable,notified_on from incident_actions
    where closed_on is null order by action_due nulls first`,
  'work-days': 'select driver,fatigue_option,work_day,work_minutes,periods,first_start,last_end from work_days where work_day >= current_date - 14 order by work_day desc, driver',
  'work-periods': 'select w.code,d.name driver,w.starts_at,w.ends_at,round(extract(epoch from (w.ends_at - w.starts_at))/60)::int minutes,w.source,w.evidence from work_periods w join drivers d on d.id = w.driver_id order by w.starts_at desc limit 200',
  'service-history': `select v.code vehicle,s.code,s.kind,s.done_on,s.odometer_km,s.workshop,s.cost_cents,s.notes from services s join vehicles v on v.id = s.vehicle_id order by s.done_on desc`,
  'maintenance-spend': `select v.code vehicle,v.rego,v.name,count(s.id)::int jobs,coalesce(sum(s.cost_cents),0)::int cost_cents,
    case when max(s.odometer_km) > min(s.odometer_km) then round(100.0 * sum(s.cost_cents) / (max(s.odometer_km) - min(s.odometer_km)), 1) end cents_per_km
    from vehicles v left join services s on s.vehicle_id = v.id and s.done_on >= current_date - 365
    where v.status <> 'retired' group by v.id order by cost_cents desc`,
  'repeat-defects': `select v.code vehicle,v.rego,count(*)::int defects_12_months,count(*) filter (where x.severity = 'major')::int major,max(x.reported_on) last_reported
    from defects x join vehicles v on v.id = x.vehicle_id where x.reported_on >= current_date - 365
    group by v.id having count(*) >= 2 order by defects_12_months desc`,
  'driver-defects': `select reported_by,count(*)::int reported_12_months,max(reported_on) last_reported from defects where reported_on >= current_date - 365 group by reported_by order by reported_12_months desc`,
};

const READ_ONLY_EXTRA = ['driver', 'vehicle', 'subcontractor', 'fatigue', 'compliance', 'attention'];

// ---------------------------------------------------------------- helpers

export function options(args) {
  const opts = {}, pos = [];
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      opts[arg.slice(2, eq < 0 ? undefined : eq)] = eq < 0 ? true : arg.slice(eq + 1);
    } else pos.push(arg);
  }
  return { opts, pos };
}

const today = () => new Date().toISOString().slice(0, 10);

function cell(key, v, row) {
  if (v === null || v === undefined) return '';
  if (key.endsWith('_cents')) return `AUD ${(Number(v) / 100).toFixed(2)}`;
  if (v instanceof Date) return v.toISOString().slice(0, 16).replace('T', ' ') + 'Z';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function print(value, json = false) {
  if (json) return JSON.stringify(value, null, 2);
  if (Array.isArray(value)) {
    if (!value.length) return '(none)';
    const keys = Object.keys(value[0]).filter((k) => !['id', 'created_at', 'updated_at'].includes(k));
    return table(value, keys.map((key) => ({ key, label: key.replace(/_cents$/, '').replaceAll('_', ' '), format: (v, row) => cell(key, v, row) })));
  }
  return Object.entries(value).map(([k, v]) => `${k.replaceAll('_', ' ').toUpperCase()}\n${print(Array.isArray(v) ? v : [{ value: v }])}`).join('\n\n');
}

export async function resolve(db, type, ref) {
  if (!fields[type]) throw Error(`Unknown record type: ${type}`);
  if (!ref || typeof ref !== 'string') throw Error(`A ${type} reference is required`);
  const label = nameColumn[type] || 'name';
  let rows = await db.query(`select * from ${type} where lower(code) = lower($1) or lower(${label}::text) = lower($1)`, [ref]);
  if (!rows.length) {
    rows = await db.query(`select * from ${type} where left(id::text, length($1)) = lower($1) or strpos(lower(code), lower($1)) > 0 or strpos(lower(${label}::text), lower($1)) > 0 order by code`, [ref]);
  }
  if (rows.length !== 1) {
    const e = Error(rows.length
      ? `Ambiguous ${type} "${ref}": ${rows.map((r) => `${r.code} (${r[label]})`).join('; ')}`
      : `No ${type} matches "${ref}"`);
    e.candidates = rows.map((r) => ({ id: r.id, code: r.code, name: r[label] }));
    throw e;
  }
  return rows[0];
}

function isDate(v) {
  return /^\d{4}-\d\d-\d\d$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
}

export function validate(type, data) {
  if (!fields[type]) throw Error(`Unknown record type: ${type}`);
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.keys(data).length) throw Error('Supply a non-empty record object');
  for (const [k, v] of Object.entries(data)) {
    if (!fields[type].includes(k)) throw Error(`Unknown ${type} field: ${k}`);
    if (v === null) continue;
    if (integers.includes(k)) { if (!Number.isSafeInteger(v) || v < 0) throw Error(`${k} must be a whole number, zero or more`); continue; }
    if (booleans.includes(k)) { if (typeof v !== 'boolean') throw Error(`${k} must be true or false`); continue; }
    if (typeof v !== 'string') throw Error(`${k} must be text`);
    if (required.includes(k) && !v.trim()) throw Error(`${k} cannot be blank`);
    if ((k.endsWith('_on') || k.endsWith('_due')) && !isDate(v)) throw Error(`${k} needs a real YYYY-MM-DD date`);
    if (k.endsWith('_at')) {
      if (!isDate(v.slice(0, 10))) throw Error(`${k} needs a real calendar date`);
      if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)$/.test(v)) throw Error(`${k} needs an ISO timestamp with a time zone, for example 2026-11-10T06:00:00+10:00`);
    }
  }
}

export async function save(db, type, data, ref = null) {
  validate(type, data);
  const row = ref ? await resolve(db, type, ref) : null;
  if (row && 'code' in data && data.code !== row.code) throw Error('code cannot change; add a new record');
  const values = { ...data };
  for (const [key, target] of Object.entries(refs)) {
    if (typeof values[key] === 'string' && values[key]) values[key] = (await resolve(db, target, values[key])).id;
  }
  const keys = Object.keys(values), params = Object.values(values);
  if (row) {
    params.push(row.id);
    return db.query(`update ${type} set ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} where id = $${params.length} returning *`, params);
  }
  return db.query(`insert into ${type} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, params);
}

const newCode = (prefix) => `${prefix}-${randomUUID().slice(0, 6).toUpperCase()}`;

// ---------------------------------------------------------------- compliance

export async function fatigue(db, { days = 28 } = {}) {
  const findings = [];
  const drivers = await db.query('select id, code, name, fatigue_option from drivers where active order by name');
  for (const d of drivers) {
    const periods = await db.query(`select starts_at, ends_at from work_periods where driver_id = $1 and starts_at >= now() - ($2::int * interval '1 day') order by starts_at`, [d.id, days]);
    if (!periods.length) continue;
    if (d.fatigue_option !== 'standard') {
      findings.push({ driver: d.name, rule: d.fatigue_option.toUpperCase(), window_start: '', finding: `Works under ${d.fatigue_option.toUpperCase()}: check the recorded hours against the accredited limits by hand; not calculated here` });
      continue;
    }
    for (const f of checkDriver(periods)) findings.push({ driver: d.name, ...f });
  }
  return findings;
}

export async function compliance(db) {
  const issues = [];
  const add = (record, rule, finding, source) => issues.push({ record, rule, finding, source });
  const t = today();

  for (const v of await db.query("select * from vehicles where status <> 'retired' order by code")) {
    if (!v.rego_due || v.rego_due < t) add(v.code, 'REGO', v.rego_due ? `Registration expired ${v.rego_due}` : 'No registration expiry recorded', 'State registration law');
    if (v.inspection_due && v.inspection_due < t) add(v.code, 'INSPECTION', `Inspection overdue since ${v.inspection_due}`, 'State inspection scheme');
  }
  for (const s of await db.query('select * from service_due order by code')) {
    if (s.km_remaining !== null && s.km_remaining < 0) add(s.code, 'NHVAS-M4', `Service overdue by ${-s.km_remaining} km`, 'Maintenance Management standard 4: maintenance schedules and methods');
    else if (s.days_remaining !== null && s.days_remaining < 0) add(s.code, 'NHVAS-M4', `Service overdue by ${-s.days_remaining} days`, 'Maintenance Management standard 4: maintenance schedules and methods');
    if (s.next_service_km === null && s.next_service_on === null && s.kind !== 'light') add(s.code, 'NHVAS-M4', 'No service interval or no scheduled service on record', 'Maintenance Management standard 4');
  }
  for (const x of await db.query("select * from open_defects where status = 'open' order by code")) {
    if (x.severity === 'major') add(x.vehicle, 'NHVAS-M3', `Major defect ${x.code} open ${x.days_open} day${x.days_open === 1 ? "" : "s"}${x.planned_trips ? `, ${x.planned_trips} planned trip(s)` : ''}`, 'Maintenance Management standard 3: fault repair; HVNL s 26C');
    else if (x.days_open > 14) add(x.vehicle, 'NHVAS-M3', `Minor defect ${x.code} open ${x.days_open} days`, 'Maintenance Management standard 3: fault repair');
  }
  for (const c of await db.query('select * from credential_status order by driver')) {
    if (!c.expires_on) add(c.driver, 'CREDENTIAL', `${c.name}: no expiry recorded`, 'Operator record keeping');
    else if (c.days_left < 0) add(c.driver, 'CREDENTIAL', `${c.name} expired ${c.expires_on}`, c.kind === 'licence' ? 'State driver licensing' : 'Operator policy');
    if (c.kind !== 'other' && !c.evidence) add(c.driver, 'EVIDENCE', `${c.name}: no copy on file`, 'NHVAS / HVA records and documentation');
  }
  for (const d of await db.query("select d.code, d.name from drivers d where d.active and d.licence_class <> 'C' and not exists (select 1 from credentials c where c.driver_id = d.id and c.kind = 'licence')")) {
    add(d.name, 'CREDENTIAL', 'No heavy vehicle licence on file', 'State driver licensing');
  }
  for (const d of await db.query("select d.name from drivers d where d.active and d.fatigue_option in ('bfm','afm') and not exists (select 1 from credentials c where c.driver_id = d.id and c.kind = 'fatigue_training' and c.expires_on >= current_date)")) {
    add(d.name, 'FATIGUE-TRAINING', 'BFM or AFM driver without current fatigue training on file', 'NHVAS Basic Fatigue Management standards');
  }
  for (const f of await fatigue(db)) add(f.driver, f.rule, f.finding, f.rule.startsWith('SH-') ? 'Heavy Vehicle (Fatigue Management) National Regulation Sch 1 (standard hours)' : 'Accreditation conditions');
  for (const g of await db.query(reads['diary-gaps'])) add(g.driver, 'WORK-DIARY', g.work_diary === 'none' ? `Trip ${g.code} went beyond 100 km and the driver keeps no work diary` : `Trip ${g.code} went beyond 100 km with no work recorded for it`, 'HVNL Ch 6 Pt 6.4 (work diaries for 100+ km work)');
  for (const m of await db.query("select * from trip_mass where mass_category not in ('within limit','not weighed')")) {
    add(m.code, 'MASS', `${m.gross_mass_kg} kg against a ${m.mass_limit_kg} kg limit (${m.over_pct}% over): ${m.mass_category}`, 'HVNL s 96 and ss 98 to 100 (breach categories)');
  }
  for (const m of await db.query(reads.unweighed)) {
    if (m.mass_category === 'not weighed') add(m.code, 'MASS-RECORD', 'Load left with no recorded weight', 'HVNL s 26C: reasonable steps');
    if (!m.restraint_checked) add(m.code, 'RESTRAINT', 'No load restraint check recorded', 'HVNL Pt 4.4 (loading requirements); Load Restraint Guide 2018');
  }
  for (const s of await db.query("select * from subcontractor_status where status = 'active'")) {
    if (!s.insurance_due || s.insurance_days_left < 0) add(s.name, 'COR-SUB', s.insurance_due ? `Insurance expired ${s.insurance_due}${s.open_trips ? `, ${s.open_trips} open trip(s)` : ''}` : 'No insurance certificate recorded', 'HVNL s 26C: chain of responsibility');
    if (!s.cor_acknowledged_on) add(s.name, 'COR-SUB', 'Has not acknowledged our chain of responsibility terms', 'HVNL s 26C (primary duty)');
    if (!s.last_review_on || s.days_since_review > 365) add(s.name, 'COR-SUB', s.last_review_on ? `Last reviewed ${s.days_since_review} days ago` : 'Never reviewed', 'Operator policy: annual review');
  }
  for (const i of await db.query('select * from incident_actions where closed_on is null')) {
    if (i.notifiable && !i.notified_on) add(i.code, 'WHS-NOTIFY', 'Notifiable incident with no notification date recorded', 'WHS Act s 38 (notify the regulator immediately)');
    if (i.days_overdue > 0) add(i.code, 'CAPA', `Corrective action ${i.days_overdue} days overdue: ${i.corrective_action || 'none recorded'}`, 'Operator safety management system');
  }
  return issues;
}

// ---------------------------------------------------------------- writes with rules

async function logNote(db, type, ref, { author, text, date }) {
  if (!['drivers', 'vehicles', 'subcontractors'].includes(type)) throw Error('log works on drivers, vehicles or subcontractors');
  if (!author || !text || !date) throw Error('log needs --author, --text and --date');
  if (!isDate(date)) throw Error('--date needs a real YYYY-MM-DD date');
  const row = await resolve(db, type, ref);
  return db.query('insert into notes (about, about_id, happened_on, author, body) values ($1,$2,$3,$4,$5) returning about, happened_on, author, body', [type, row.id, date, author, text]);
}

async function raiseDefect(db, vehicle, o) {
  if (!o.text || !o.by) throw Error('defect needs --text and --by (who found it)');
  const severity = o.major ? 'major' : 'minor';
  return save(db, 'defects', { code: newCode('DEF'), vehicle_id: vehicle, reported_on: o.date || today(), reported_by: o.by, description: o.text, severity });
}

async function repairDefect(db, ref, o) {
  if (!o.note) throw Error('repair needs --note (what was done and by whom)');
  return save(db, 'defects', { status: 'repaired', repaired_on: o.date || today(), repair_note: o.note }, ref);
}

async function recordService(db, vehicle, o) {
  const km = o.km === undefined ? null : Number(o.km);
  if (km !== null && !Number.isSafeInteger(km)) throw Error('--km must be a whole number');
  const cents = o.cost === undefined ? 0 : Math.round(Number(o.cost) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) throw Error('--cost must be an amount in dollars, for example 1840.50');
  const v = await resolve(db, 'vehicles', vehicle);
  await db.exec('BEGIN');
  try {
    const rows = await save(db, 'services', { code: newCode('SVC'), vehicle_id: v.code, kind: o.kind || 'scheduled', done_on: o.date || today(), odometer_km: km, workshop: o.workshop || '', cost_cents: cents, notes: o.notes || '' });
    if (km !== null && (v.odometer_km === null || km > v.odometer_km)) await db.query('update vehicles set odometer_km = $1, odometer_on = $2 where id = $3', [km, o.date || today(), v.id]);
    await db.exec('COMMIT');
    return rows;
  } catch (e) { await db.exec('ROLLBACK'); throw e; }
}

async function writeDraft(name, title, body) {
  const dir = path.resolve(process.env.OUTPUT_DIR || REPO_ROOT, 'drafts');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}-${today()}-${randomUUID().slice(0, 6)}.md`);
  fs.writeFileSync(file, `# DRAFT: ${title}\n\nNothing has been sent. Check every line against the source records before it is used.\n\n${body}\n`, { flag: 'wx' });
  return [{ file }];
}

function mdTable(rows) {
  if (!rows.length) return '_None._\n';
  const keys = Object.keys(rows[0]).filter((k) => k !== 'id');
  return [`| ${keys.join(' | ')} |`, `| ${keys.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${keys.map((k) => cell(k, r[k], r).replaceAll('|', '/')).join(' | ')} |`)].join('\n') + '\n';
}

// ---------------------------------------------------------------- import

// ManageVehicle does not publish its export columns. These are the column names this
// importer expects; --map=<json> renames them to whatever the file actually has.
export const importHeaders = {
  vehicles: { code: 'Fleet Number', rego: 'Registration', name: 'Description', kind: 'Vehicle Type', rego_due: 'Rego Expiry', odometer_km: 'Odometer', service_interval_km: 'Service Interval Km' },
  drivers: { code: 'Driver ID', name: 'Driver Name', licence_class: 'Licence Class', licence_number: 'Licence Number', licence_due: 'Licence Expiry', medical_due: 'Medical Expiry', fatigue_option: 'Fatigue Option' },
  work: { driver: 'Driver ID', starts_at: 'Work Start', ends_at: 'Work End', source: 'Source' },
};
const kindMap = { 'prime mover': 'prime_mover', prime_mover: 'prime_mover', rigid: 'rigid', truck: 'rigid', trailer: 'trailer', dolly: 'dolly', bus: 'bus', ute: 'light', van: 'light', light: 'light' };

export async function importFile(db, kind, file, { map = null, dryRun = false } = {}) {
  if (!importHeaders[kind]) throw Error('--kind must be vehicles, drivers or work');
  if (!file) throw Error('Use --file=<CSV exported from ManageVehicle or your EWD>');
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  if (!rows.length) throw Error('The CSV has no rows');
  const mapping = { ...importHeaders[kind], ...(map ? JSON.parse(fs.readFileSync(map, 'utf8')) : {}) };
  for (const k of Object.keys(mapping)) if (!(k in importHeaders[kind])) throw Error(`Unknown mapping field ${k}`);
  const counts = { created: 0, unchanged: 0 };
  const seen = new Set();
  await db.exec('BEGIN');
  try {
    for (const [i, raw] of rows.entries()) {
      const r = Object.fromEntries(Object.entries(mapping).map(([k, h]) => [k, pick(raw, h).trim()]));
      const line = `CSV row ${i + 2}`;
      if (kind === 'vehicles') {
        if (!r.code || !r.rego) throw Error(`${line}: fleet number and registration are required`);
        if (seen.has(r.code)) throw Error(`${line}: duplicate fleet number ${r.code}`);
        seen.add(r.code);
        const vkind = kindMap[r.kind.toLowerCase()];
        if (!vkind) throw Error(`${line}: unknown vehicle type "${r.kind}"`);
        const data = { code: r.code, rego: r.rego, name: r.name || r.code, kind: vkind };
        if (r.rego_due) data.rego_due = r.rego_due;
        if (r.odometer_km) data.odometer_km = Number(r.odometer_km.replaceAll(',', ''));
        if (r.service_interval_km) data.service_interval_km = Number(r.service_interval_km.replaceAll(',', ''));
        validate('vehicles', data);
        const existing = (await db.query('select * from vehicles where code = $1', [r.code]))[0];
        if (existing) {
          for (const k of ['rego', 'kind']) if (existing[k] !== data[k]) throw Error(`${line}: vehicle ${r.code} already exists with a different ${k}; reconcile it first`);
          counts.unchanged++;
        } else { await save(db, 'vehicles', data); counts.created++; }
      } else if (kind === 'drivers') {
        if (!r.code || !r.name) throw Error(`${line}: driver id and name are required`);
        if (seen.has(r.code)) throw Error(`${line}: duplicate driver ${r.code}`);
        seen.add(r.code);
        const data = { code: r.code, name: r.name, licence_class: r.licence_class.toUpperCase(), fatigue_option: (r.fatigue_option || 'standard').toLowerCase() };
        validate('drivers', data);
        let d = (await db.query('select * from drivers where code = $1', [r.code]))[0];
        if (d) { if (d.name !== data.name) throw Error(`${line}: driver ${r.code} already exists under another name; reconcile it first`); counts.unchanged++; }
        else { d = (await save(db, 'drivers', data))[0]; counts.created++; }
        for (const [ck, due, label] of [['licence', r.licence_due, `Heavy vehicle licence ${data.licence_class}`], ['medical', r.medical_due, 'Medical']]) {
          if (!due) continue;
          const exists = (await db.query('select id from credentials where driver_id = $1 and kind = $2 and expires_on = $3', [d.id, ck, due])).length;
          if (!exists) await save(db, 'credentials', { code: newCode(ck === 'licence' ? 'LIC' : 'MED'), driver_id: d.code, kind: ck, name: label, reference: ck === 'licence' ? r.licence_number : '', expires_on: due, evidence: 'Imported from ManageVehicle: file the copy' });
        }
      } else {
        const d = await resolve(db, 'drivers', r.driver);
        const data = { driver_id: d.code, starts_at: r.starts_at, ends_at: r.ends_at, source: (r.source || 'ewd').toLowerCase(), evidence: `Imported from ${path.basename(file)}` };
        validate('work_periods', data);
        const existing = (await db.query('select id from work_periods where driver_id = $1 and starts_at = $2 and ends_at = $3', [d.id, data.starts_at, data.ends_at]));
        if (existing.length) counts.unchanged++;
        else { await save(db, 'work_periods', { code: newCode('WP'), ...data }); counts.created++; }
      }
    }
    await db.exec(dryRun ? 'ROLLBACK' : 'COMMIT');
    return [{ mode: dryRun ? 'dry run, nothing saved' : 'imported', kind, rows: rows.length, ...counts }];
  } catch (e) { await db.exec('ROLLBACK'); throw e; }
}

// ---------------------------------------------------------------- dispatcher

const allowed = {
  add: ['data'], update: ['data'], log: ['author', 'text', 'date'], defect: ['text', 'by', 'major', 'date'], repair: ['note', 'date'],
  service: ['km', 'date', 'workshop', 'cost', 'kind', 'notes'], fatigue: ['days'], import: ['kind', 'file', 'map', 'dry-run'], export: ['out'],
};
const arity = { add: 1, update: 2, log: 2, defect: 1, repair: 1, service: 1, driver: 1, vehicle: 1, subcontractor: 1, 'draft-insurance-request': 1, import: 1 };

export const commandList = [...Object.keys(reads), ...READ_ONLY_EXTRA, 'add', 'update', 'log', 'defect', 'repair', 'service', 'weekly-review', 'draft-weekly', 'draft-insurance-request', 'import', 'export'];

export async function run(db, args) {
  const { opts: o, pos } = options(args);
  const [cmd = 'help', ...rest] = pos;
  for (const key of Object.keys(o)) if (key !== 'json' && !(allowed[cmd] || []).includes(key)) throw Error(`Unknown option --${key} for ${cmd}`);
  if (rest.length !== (arity[cmd] || 0)) throw Error(`Wrong number of arguments for ${cmd}; see docs/cli.md`);

  if (reads[cmd]) return db.query(reads[cmd]);
  switch (cmd) {
    case 'help':
      return [{ usage: 'npm run fleet -- <command> [arguments] [--json]', commands: commandList.join(', ') }];
    case 'driver': {
      const d = await resolve(db, 'drivers', rest[0]);
      return {
        driver: [d],
        credentials: await db.query('select code,kind,name,reference,expires_on,days_left,evidence from credential_status where driver_code = $1 order by expires_on nulls first', [d.code]),
        recent_work: await db.query('select work_day,work_minutes,periods from work_days where driver_code = $1 and work_day >= current_date - 14 order by work_day desc', [d.code]),
        fatigue_findings: (await fatigue(db)).filter((f) => f.driver === d.name),
        trips: await db.query('select t.code,t.departs_at,t.origin,t.destination,t.status from trips t where t.driver_id = $1 order by t.departs_at desc limit 10', [d.id]),
        notes: await db.query("select happened_on,author,body from notes where about = 'drivers' and about_id = $1 order by happened_on", [d.id]),
      };
    }
    case 'vehicle': {
      const v = await resolve(db, 'vehicles', rest[0]);
      return {
        vehicle: [v],
        service: await db.query('select next_service_km,km_remaining,next_service_on,days_remaining from service_due where id = $1', [v.id]),
        defects: await db.query('select code,reported_on,reported_by,severity,status,description,repaired_on from defects where vehicle_id = $1 order by reported_on desc', [v.id]),
        services: await db.query('select code,kind,done_on,odometer_km,workshop,cost_cents from services where vehicle_id = $1 order by done_on desc', [v.id]),
        notes: await db.query("select happened_on,author,body from notes where about = 'vehicles' and about_id = $1 order by happened_on", [v.id]),
      };
    }
    case 'subcontractor': {
      const s = await resolve(db, 'subcontractors', rest[0]);
      return {
        subcontractor: await db.query('select * from subcontractor_status where id = $1', [s.id]),
        trips: await db.query('select code,departs_at,origin,destination,status,mass_category from trip_mass where id in (select id from trips where subcontractor_id = $1) order by departs_at desc', [s.id]),
        notes: await db.query("select happened_on,author,body from notes where about = 'subcontractors' and about_id = $1 order by happened_on", [s.id]),
      };
    }
    case 'fatigue':
      return fatigue(db, { days: o.days ? Number(o.days) : 28 });
    case 'compliance':
      return compliance(db);
    case 'attention':
      return {
        grounded: await db.query(reads.grounded),
        compliance: await compliance(db),
        service_due: await db.query(reads['service-due']),
        expiring: await db.query(reads['credentials-due']),
        incident_actions: await db.query(reads['actions-due']),
      };
    case 'add':
    case 'update': {
      if (!o.data) throw Error('Use --data=<JSON file>');
      return save(db, rest[0], JSON.parse(fs.readFileSync(o.data, 'utf8')), cmd === 'update' ? rest[1] : null);
    }
    case 'log': return logNote(db, rest[0], rest[1], o);
    case 'defect': return raiseDefect(db, rest[0], o);
    case 'repair': return repairDefect(db, rest[0], o);
    case 'service': return recordService(db, rest[0], o);
    case 'weekly-review':
    case 'draft-weekly': {
      const issues = await compliance(db);
      const body = [
        `## Compliance findings (${issues.length})`, mdTable(issues),
        '## Loads that cannot go', mdTable(await db.query(reads.grounded)),
        '## Services due', mdTable(await db.query(reads['service-due'])),
        '## Expiring in 30 days', mdTable(await db.query(reads['credentials-due'])),
        '## Subcontractors to review', mdTable(await db.query(reads['subcontractor-review'])),
        '## Incident actions open', mdTable(await db.query(reads['actions-due'])),
      ].join('\n');
      return writeDraft(cmd, `Monday compliance review, week of ${today()}`, body);
    }
    case 'draft-insurance-request': {
      const s = await resolve(db, 'subcontractors', rest[0]);
      const status = (await db.query('select * from subcontractor_status where id = $1', [s.id]))[0];
      const asks = [];
      if (!status.insurance_due || status.insurance_days_left <= 30) asks.push('a current certificate of currency for your motor vehicle and public liability insurance');
      if (!status.cor_acknowledged_on) asks.push('your signed acknowledgement of our chain of responsibility terms');
      if (status.accreditation === 'none') asks.push('details of any heavy vehicle accreditation you hold');
      if (!asks.length) asks.push('confirmation that your insurance and accreditation details are unchanged');
      const body = `To: ${s.contact_email || '[contact email]'}\nSubject: Documents for carrying our loads\n\nHi ${s.name},\n\nBefore we book further work with you, please send:\n\n${asks.map((a) => `- ${a}`).join('\n')}\n\nThanks,\n[Your name]\n`;
      return writeDraft('insurance-request', `Document request for ${s.name}`, body);
    }
    case 'import':
      if (rest[0] !== 'managevehicle') throw Error('Supported importer: managevehicle (vehicles, drivers) and EWD work records (--kind=work)');
      return importFile(db, o.kind, o.file, { map: o.map, dryRun: Boolean(o['dry-run']) });
    case 'export': {
      if (!o.out) throw Error('Use --out=<new JSON file>');
      const data = { format: 'heavy-vehicle-compliance-v1', exported_at: new Date().toISOString() };
      await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        for (const t of [...Object.keys(fields), 'notes']) data[t] = await db.query(`select * from ${t} order by code`.replace('order by code', t === 'notes' ? 'order by created_at' : 'order by code'));
        await db.exec('COMMIT');
      } catch (e) { await db.exec('ROLLBACK'); throw e; }
      const file = path.resolve(o.out);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
      return [{ file, record_types: Object.keys(data).length - 2 }];
    }
    default:
      throw Error(`Unknown command "${cmd}". Run: npm run fleet -- help`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let db;
  const args = process.argv.slice(2);
  try {
    db = await getDb();
    console.log(print(await run(db, args), Boolean(options(args).opts.json)));
  } catch (e) {
    if (args.includes('--json')) console.error(JSON.stringify({ error: e.message, ...(e.candidates ? { candidates: e.candidates } : {}) }));
    else console.error(e.message + (e.candidates?.length ? '\nCandidates:\n' + e.candidates.map((c) => `  ${c.code}  ${c.name}`).join('\n') : ''));
    process.exitCode = 1;
  } finally {
    if (db) await db.close();
  }
}
