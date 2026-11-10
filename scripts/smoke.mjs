#!/usr/bin/env node
// npm test: a disposable database, every command exercised, the rules asserted. PASS or FAIL.
// Never touches DATABASE_URL: it uses TEST_DATABASE_URL (a disposable CI Postgres) or a temp PGlite.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { migrate } from './migrate.mjs';
import { seed } from './seed.mjs';
import { run, reads, save, resolve, compliance, fatigue, importFile, commandList } from './fleet.mjs';
import { checkDriver } from './lib/fatigue.mjs';
import { parseCsv } from './lib/csv.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-test-'));
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
process.env.DATA_DIR = path.join(temp, 'db');
process.env.OUTPUT_DIR = temp;

let db, checks = 0;
const ok = (v, msg) => { assert.ok(v, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const rejects = async (fn, match) => { await assert.rejects(fn, match); checks++; };
const file = (name, value) => { const p = path.join(temp, name); fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value)); return p; };
const cli = (script, args = [], status = 0) => {
  const out = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', script), ...args], { cwd: REPO_ROOT, env: process.env, encoding: 'utf8' });
  assert.equal(out.status, status, out.stderr || out.stdout); checks++;
  return out.stdout + out.stderr;
};
const H = 3600000;
const at = (h) => new Date(Date.UTC(2026, 0, 5) + h * H).toISOString();

try {
  db = await getDb();
  if (process.env.TEST_DATABASE_URL) await db.exec('drop schema public cascade; create schema public;');
  await migrate(db);
  eq((await migrate(db)).ran.length, 0, 'second migrate applies nothing');
  await seed(db); await seed(db);
  eq((await run(db, ['drivers'])).length, 4, 'seed is idempotent');

  // Every read runs.
  for (const cmd of Object.keys(reads)) ok(Array.isArray(await run(db, [cmd])), `read ${cmd}`);

  // The demo data says what it should.
  const grounded = await run(db, ['grounded']);
  ok(grounded.some((g) => g.trip === 'T204' && g.vehicle === 'TR01'), 'grounded: T204 on TR01 with open brake defect');
  const svc = await run(db, ['service-due']);
  ok(svc.some((s) => s.code === 'PM02' && Number(s.km_remaining) === -3900), 'service-due: PM02 overdue 3,900 km');
  ok(svc.some((s) => s.code === 'PM01' && Number(s.km_remaining) === 2700), 'service-due: PM01 due in 2,700 km');
  const mass = await run(db, ['mass']);
  eq(mass.find((m) => m.code === 'T202').mass_category, 'severe risk', 'mass: 21% over is severe');
  eq(mass.find((m) => m.code === 'T201').mass_category, 'minor risk', 'mass: 3.8% over is minor');
  ok(!mass.some((m) => m.code === 'T206'), 'mass: within limit not listed');
  ok((await run(db, ['diary-gaps'])).some((g) => g.code === 'T203'), 'diary gap: 100+ km trip, no diary');
  ok((await run(db, ['subcontractor-review'])).some((s) => s.code === 'OUTBACK'), 'subcontractor review: expired insurance');
  ok(!(await run(db, ['subcontractor-review'])).some((s) => s.code === 'SWIFT'), 'subcontractor review: current carrier not listed');
  ok((await run(db, ['credentials-due'])).some((c) => c.code === 'MED-TB'), 'credentials-due: missing expiry listed');
  ok((await run(db, ['actions-due'])).some((a) => a.code === 'INC-401' && a.days_overdue === 6), 'actions-due: overdue corrective action');
  ok((await run(db, ['repeat-defects'])).some((r) => r.vehicle === 'TR01'), 'repeat defects: TR01 twice in 12 months');

  // Standard hours, against hand-worked timelines.
  eq(checkDriver([{ starts_at: at(0), ends_at: at(5.25) }]).length, 0, '5h15m straight is within the limit');
  eq(checkDriver([{ starts_at: at(0), ends_at: at(5.5) }])[0].rule, 'SH-5.5H', '5h30m straight breaks the 5.5 hour rule');
  eq(checkDriver([{ starts_at: at(0), ends_at: at(5) }, { starts_at: at(5 + 10 / 60), ends_at: at(5.5) }])[0].rule, 'SH-5.5H', 'a 10-minute break is not rest');
  eq(checkDriver([{ starts_at: at(0), ends_at: at(5) }, { starts_at: at(5.25), ends_at: at(10) }]).filter((f) => f.rule === 'SH-5.5H').length, 0, 'a 15-minute break resets the 5.5 hour window');
  const long = [];
  for (let s = 0; s < 14; s += 5.5) long.push({ starts_at: at(s), ends_at: at(Math.min(s + 5, 14)) });
  ok(checkDriver(long).some((f) => f.rule === 'SH-24H'), 'more than 12 hours work in 24 hours');
  const shortRest = [{ starts_at: at(0), ends_at: at(5) }, { starts_at: at(6), ends_at: at(11) }, { starts_at: at(17), ends_at: at(18) }, { starts_at: at(24), ends_at: at(26) }];
  ok(checkDriver(shortRest).some((f) => f.rule === 'SH-24H' && f.finding.includes('longest rest')), 'no 7 hour stationary rest in 24 hours');
  const fine = [];
  for (let d = 0; d < 6; d++) fine.push({ starts_at: at(d * 24), ends_at: at(d * 24 + 5) }, { starts_at: at(d * 24 + 5.5), ends_at: at(d * 24 + 10) });
  eq(checkDriver(fine).length, 0, 'six 9.5-hour days with long rests are clean');
  const week = [];
  for (let d = 0; d < 8; d++) week.push({ starts_at: at(d * 24), ends_at: at(d * 24 + 5) }, { starts_at: at(d * 24 + 5.25), ends_at: at(d * 24 + 10) }, { starts_at: at(d * 24 + 10.5), ends_at: at(d * 24 + 11.5) });
  ok(checkDriver(week).some((f) => f.rule === 'SH-7D'), 'eight 11-hour days break the 72 hour week');
  const kim = (await fatigue(db)).filter((f) => f.driver === 'Kim Nguyen').map((f) => f.rule);
  ok(kim.includes('SH-5.5H') && kim.includes('SH-24H'), 'demo: Kim breaks the 5.5 hour and 24 hour limits');
  ok(!(await fatigue(db)).some((f) => f.driver === 'Dev Patel'), 'demo: Dev is clean');
  ok((await fatigue(db)).some((f) => f.driver === 'Ray Lee' && f.rule === 'BFM'), 'demo: BFM driver referred for review');

  // The full compliance check names the rule and the source.
  const issues = await compliance(db);
  for (const rule of ['REGO', 'NHVAS-M4', 'NHVAS-M3', 'CREDENTIAL', 'EVIDENCE', 'SH-5.5H', 'WORK-DIARY', 'MASS', 'MASS-RECORD', 'RESTRAINT', 'COR-SUB', 'CAPA']) {
    ok(issues.some((i) => i.rule === rule), `compliance finds ${rule}`);
  }
  ok(issues.every((i) => i.source), 'every finding cites a source');

  // Lookups.
  eq((await resolve(db, 'drivers', 'kim nguyen')).code, 'KNGUYEN', 'case-insensitive name');
  eq((await resolve(db, 'vehicles', 'xr77cd')).code, 'PM02', 'rego lookup');
  const kimRow = await resolve(db, 'drivers', 'KNGUYEN');
  eq((await resolve(db, 'drivers', kimRow.id.slice(0, 8))).code, 'KNGUYEN', 'id prefix');
  await rejects(() => resolve(db, 'vehicles', 'PM0'), /Ambiguous/);
  await rejects(() => resolve(db, 'drivers', 'nobody here'), /No drivers/);
  await rejects(() => run(db, ['vehicles', 'extra']), /Wrong number/);
  await rejects(() => run(db, ['vehicles', '--typo']), /Unknown option/);

  // Validation.
  await rejects(() => save(db, 'drivers', { code: 'X', name: '' }), /blank/);
  await rejects(() => save(db, 'vehicles', { rego_due: '2026-02-30' }, 'PM01'), /real/);
  await rejects(() => save(db, 'trips', { gross_mass_kg: 12.5 }, 'T201'), /whole number/);
  await rejects(() => save(db, 'drivers', { colour: 'red' }), /Unknown/);
  await rejects(() => save(db, 'work_periods', { code: 'TZ', driver_id: 'DPATEL', starts_at: '2026-01-01T00:00:00', ends_at: '2026-01-01T01:00:00Z' }), /time zone/);
  await rejects(() => save(db, 'drivers', { code: 'CHANGED' }, 'DPATEL'), /cannot change/);

  // Rules the database itself enforces.
  await rejects(() => save(db, 'trips', { code: 'TX1', customer: 'Test', departs_at: at(1000), origin: 'A', destination: 'B', vehicle_id: 'PM01', trailer_id: 'TR01', driver_id: 'DPATEL' }), /major defect/);
  await rejects(() => save(db, 'trips', { code: 'TX2', customer: 'Test', departs_at: at(1000), origin: 'A', destination: 'B', vehicle_id: 'TR02', driver_id: 'DPATEL' }), /cannot be a trailer/);
  await rejects(() => save(db, 'trips', { code: 'TX3', customer: 'Test', departs_at: at(1000), origin: 'A', destination: 'B', vehicle_id: 'PM01', subcontractor_id: 'SWIFT' }), /check constraint/);
  const kn1 = (await db.query("select starts_at, ends_at from work_periods where code = 'WP-KN1'"))[0];
  await rejects(() => save(db, 'work_periods', { code: 'WX1', driver_id: 'KNGUYEN', starts_at: new Date(kn1.starts_at).toISOString(), ends_at: new Date(new Date(kn1.ends_at).getTime() + H).toISOString() }), /overlaps/);
  await rejects(() => save(db, 'defects', { status: 'repaired' }, 'DEF-302'), /check constraint/);

  // Writes through the CLI.
  await run(db, ['add', 'drivers', '--data=' + file('d.json', { code: 'NEWDRV', name: 'New Driver', licence_class: 'HR' })]);
  await run(db, ['update', 'drivers', 'NEWDRV', '--data=' + file('u.json', { phone: '0400 999 999' })]);
  eq((await resolve(db, 'drivers', 'NEWDRV')).phone, '0400 999 999', 'add and update');
  await run(db, ['log', 'drivers', 'NEWDRV', '--author=Ops', '--text=Induction done', '--date=2026-11-01']);
  eq((await run(db, ['driver', 'NEWDRV'])).notes.length, 1, 'driver history shows the note');
  await rejects(() => db.query("update notes set body = 'changed'"), /append-only/);
  ok(issues.length < (await compliance(db)).length, 'a new driver with no licence on file is flagged');

  const raised = (await run(db, ['defect', 'PM01', '--text=Brake light out', '--by=Dev Patel', '--major']))[0];
  await rejects(() => save(db, 'trips', { code: 'TX4', customer: 'Test', departs_at: at(1000), origin: 'A', destination: 'B', vehicle_id: 'PM01', driver_id: 'DPATEL' }), /major defect/);
  await rejects(() => run(db, ['repair', raised.code]), /--note/);
  await run(db, ['repair', raised.code, '--note=Globe replaced, Southside Diesel']);
  await save(db, 'trips', { code: 'TX4', customer: 'Test', departs_at: at(1000), origin: 'A', destination: 'B', vehicle_id: 'PM01', driver_id: 'DPATEL' });
  ok(true, 'repaired vehicle can take a load');

  await run(db, ['service', 'PM02', '--km=270100', '--workshop=Southside Diesel', '--cost=1840.50']);
  const pm02 = (await run(db, ['vehicle', 'PM02']));
  eq(Number(pm02.vehicle[0].odometer_km), 270100, 'service moves the odometer forward');
  eq(Number(pm02.service[0].km_remaining), 25000, 'service resets the interval');
  eq(Number(pm02.services[0].cost_cents), 184050, 'cost stored in cents');
  await rejects(() => run(db, ['service', 'PM02', '--cost=abc']), /amount/);

  ok((await run(db, ['subcontractor', 'outback'])).trips.length >= 1, 'subcontractor view');
  const attention = await run(db, ['attention']);
  ok(attention.grounded.length && attention.compliance.length, 'attention combines the lists');

  // Drafts, never sends.
  for (const args of [['weekly-review'], ['draft-weekly'], ['draft-insurance-request', 'OUTBACK']]) {
    const out = (await run(db, args))[0].file;
    const text = fs.readFileSync(out, 'utf8');
    ok(text.startsWith('# DRAFT') && text.includes('Nothing has been sent'), `${args[0]} writes a draft only`);
  }
  ok(fs.readFileSync((await run(db, ['draft-insurance-request', 'OUTBACK']))[0].file, 'utf8').includes('chain of responsibility terms'), 'request asks for the missing acknowledgement');

  // Import from ManageVehicle registers and an EWD export.
  const vcsv = path.join(REPO_ROOT, 'examples', 'managevehicle-vehicles.csv');
  const dcsv = path.join(REPO_ROOT, 'examples', 'managevehicle-drivers.csv');
  const wcsv = path.join(REPO_ROOT, 'examples', 'ewd-work-records.csv');
  eq((await importFile(db, 'vehicles', vcsv, { dryRun: true }))[0].created, 3, 'dry run counts vehicles');
  ok(!(await db.query("select id from vehicles where code = 'IMP-PM10'")).length, 'dry run saves nothing');
  await run(db, ['import', 'managevehicle', '--kind=vehicles', '--file=' + vcsv]);
  eq((await importFile(db, 'vehicles', vcsv))[0].unchanged, 3, 'repeat import changes nothing');
  eq((await resolve(db, 'vehicles', 'IMP-PM10')).kind, 'prime_mover', 'vehicle type mapped');
  await run(db, ['import', 'managevehicle', '--kind=drivers', '--file=' + dcsv]);
  await importFile(db, 'drivers', dcsv);
  eq((await db.query("select count(*)::int n from credentials c join drivers d on d.id = c.driver_id where d.code = 'IMP-D1'"))[0].n, 2, 'licence and medical imported once');
  await run(db, ['import', 'managevehicle', '--kind=work', '--file=' + wcsv]);
  eq((await importFile(db, 'work', wcsv))[0].unchanged, 3, 'work records import once');
  ok((await fatigue(db, { days: 100000 })).some((f) => f.driver === 'Imported Driver One' && f.rule === 'SH-5.5H'), 'imported work is checked');
  const raw = fs.readFileSync(vcsv, 'utf8');
  await rejects(() => importFile(db, 'vehicles', file('bad-type.csv', raw.replace('Prime Mover', 'Spaceship'))), /unknown vehicle type/);
  await rejects(() => importFile(db, 'vehicles', file('changed.csv', raw.replace('IMP001', 'IMP999'))), /different rego/);
  await rejects(() => importFile(db, 'vehicles', file('dupe.csv', raw + raw.split(/\r?\n/)[1] + '\n')), /duplicate/);
  const renamed = raw.replace('Fleet Number', 'Unit').replaceAll('IMP-', 'MAP-').replaceAll('IMP0', 'MAP0');
  await importFile(db, 'vehicles', file('mapped.csv', renamed), { map: file('map.json', { code: 'Unit' }) });
  ok((await db.query("select id from vehicles where code = 'MAP-PM10'")).length === 1, 'column mapping file');
  await rejects(() => importFile(db, 'vehicles', file('rollback.csv', renamed.replaceAll('MAP-', 'RB-').replaceAll('MAP0', 'RB0').replace('Trailer', 'Spaceship')), { map: file('map2.json', { code: 'Unit' }) }), /unknown vehicle type/);
  ok(!(await db.query("select id from vehicles where code like 'RB-%'")).length, 'a failed import saves nothing');
  assert.throws(() => parseCsv('A,A\n1,2'), /unique/); checks++;
  eq(parseCsv('﻿A,B\r\n"x,y","say ""hi"""')[0].B, 'say "hi"', 'CSV quoting');

  // Export is a full snapshot and never overwrites.
  const out = path.join(temp, 'export.json');
  await run(db, ['export', '--out=' + out]);
  eq(Object.keys(JSON.parse(fs.readFileSync(out, 'utf8'))).length, 12, 'export holds every record type');
  await rejects(() => run(db, ['export', '--out=' + out]), /EEXIST/);

  // Row-level security: an ordinary role sees nothing.
  await db.exec('create role hv_reader; grant usage on schema public to hv_reader; grant select on drivers to hv_reader; set role hv_reader');
  eq((await db.query('select * from drivers')).length, 0, 'RLS denies an ordinary reader');
  await db.exec('reset role; drop owned by hv_reader; drop role hv_reader');

  await db.close(); db = null;

  // The CLI, the views and the documents, as a user runs them.
  ok(JSON.parse(cli('fleet.mjs', ['grounded', '--json'])).length > 0, 'CLI --json');
  ok(cli('fleet.mjs', ['vehicle', 'PM0'], 1).includes('Candidates'), 'CLI lists candidates and exits 1');
  ok(cli('fleet.mjs', ['vehicle', 'PM0', '--json'], 1).includes('candidates'), 'CLI candidates as JSON');
  cli('fleet.mjs', ['nonsense'], 1);
  cli('view.mjs'); cli('docs.mjs');
  const weekHtml = fs.readFileSync(path.join(temp, 'views', 'week.html'), 'utf8');
  ok(weekHtml.includes('Example Freight') && weekHtml.includes('T204'), 'branded weekly view');
  ok(fs.readdirSync(path.join(temp, 'docs-out', 'vehicle-file')).length >= 5, 'vehicle files rendered');
  ok(fs.readdirSync(path.join(temp, 'docs-out', 'incident-report')).length >= 2, 'incident reports rendered');

  const commands = fs.readdirSync(path.join(REPO_ROOT, '.claude', 'commands')).filter((n) => n.endsWith('.md') && n !== 'README.md');
  for (const c of commandList) ok(commands.includes(`${c}.md`) || ['help'].includes(c), `slash command recipe for ${c}`);
  console.log(`PASS: ${checks} checks; ${commands.length} slash commands; ${process.platform}; ${process.env.TEST_DATABASE_URL ? 'PostgreSQL' : 'PGlite'}`);
} catch (e) {
  console.error('FAIL:', e.message, e.stack?.split('\n').find((l) => l.includes('smoke.mjs')) || '');
  process.exitCode = 1;
} finally {
  if (db) await db.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
