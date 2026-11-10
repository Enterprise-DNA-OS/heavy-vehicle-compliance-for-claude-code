-- Heavy Vehicle Compliance for Claude Code: the records an Australian carrier keeps
-- under the Heavy Vehicle National Law (HVNL) and an accreditation audit asks to see.
-- Plain Postgres. Runs on any Postgres 14+ and on embedded PGlite. No extensions.

create function stamp_updated() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- Prime movers, rigids, trailers, dollies and buses.
create table vehicles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                       -- fleet number
  rego text not null unique,
  name text not null,                              -- make, model, body
  kind text not null check (kind in ('prime_mover','rigid','trailer','dolly','bus','light')),
  gvm_kg integer check (gvm_kg > 0),
  rego_due date,
  inspection_due date,                             -- annual or roadworthy inspection where the state requires one
  service_interval_km integer check (service_interval_km > 0),
  service_interval_days integer check (service_interval_days > 0),
  odometer_km integer check (odometer_km >= 0),
  odometer_on date,
  maintenance_scheme text not null default 'none' check (maintenance_scheme in ('none','nhvas','hva','other')),
  status text not null default 'active' check (status in ('active','off_road','retired')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table drivers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  licence_class text not null check (licence_class in ('LR','MR','HR','HC','MC','C')),
  fatigue_option text not null default 'standard' check (fatigue_option in ('standard','bfm','afm')),
  work_diary text not null default 'written' check (work_diary in ('written','ewd','none')),
  base text not null default '',
  phone text,
  active boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Licences, medicals, fatigue training, inductions, dangerous goods: anything with an expiry.
create table credentials (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  driver_id uuid not null references drivers,
  kind text not null check (kind in ('licence','medical','fatigue_training','induction','dangerous_goods','other')),
  name text not null,
  reference text not null default '',
  expires_on date,
  evidence text not null default '',               -- where the copy is filed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Carriers who pull our loads. Each is a party in the chain of responsibility.
create table subcontractors (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  abn text not null default '',
  contact_email text,
  accreditation text not null default 'none' check (accreditation in ('none','nhvas','hva','trucksafe','wa_hva','other')),
  insurance_due date,
  cor_acknowledged_on date,                        -- signed our chain of responsibility terms
  last_review_on date,
  status text not null default 'active' check (status in ('active','suspended','ended')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Daily check faults and anything else found wrong with a vehicle.
create table defects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  vehicle_id uuid not null references vehicles,
  reported_on date not null,
  reported_by text not null,
  description text not null check (length(trim(description)) > 0),
  severity text not null check (severity in ('minor','major')),   -- major: do not operate until repaired
  status text not null default 'open' check (status in ('open','repaired','deferred')),
  repaired_on date,
  repair_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'repaired' or repaired_on is not null),
  check (repaired_on is null or repaired_on >= reported_on)
);

-- Scheduled services, repairs and inspections, with the odometer at the time.
create table services (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  vehicle_id uuid not null references vehicles,
  kind text not null check (kind in ('scheduled','repair','inspection')),
  done_on date not null,
  odometer_km integer check (odometer_km >= 0),
  workshop text not null default '',
  cost_cents integer not null default 0 check (cost_cents >= 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Work periods from the written work diary, the EWD export or the timesheet.
-- Time between work periods is treated as rest; a gap under 15 minutes counts as work.
create table work_periods (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  driver_id uuid not null references drivers,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  source text not null default 'written' check (source in ('written','ewd','timesheet')),
  evidence text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '24 hours')
);

-- One load on one combination: what was carried, what it weighed, who carried it.
create table trips (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  customer text not null,
  departs_at timestamptz not null,
  arrives_at timestamptz,
  origin text not null,
  destination text not null,
  distance_km integer check (distance_km >= 0),
  beyond_100km boolean not null default false,     -- goes more than 100 km from the driver's base: work diary needed
  vehicle_id uuid references vehicles,             -- prime mover or rigid
  trailer_id uuid references vehicles,
  driver_id uuid references drivers,
  subcontractor_id uuid references subcontractors,
  mass_limit_kg integer check (mass_limit_kg > 0), -- the limit that applies to this combination and route
  gross_mass_kg integer check (gross_mass_kg > 0), -- weighbridge or on-board scales
  weighed_by text not null default '',
  restraint_checked boolean not null default false,
  status text not null default 'planned' check (status in ('planned','departed','delivered','cancelled')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (arrives_at is null or arrives_at > departs_at),
  check ((subcontractor_id is null) or (driver_id is null and vehicle_id is null))
);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  occurred_on date not null,
  kind text not null check (kind in ('crash','near_miss','injury','load_shift','breach_notice','other')),
  vehicle_id uuid references vehicles,
  driver_id uuid references drivers,
  description text not null check (length(trim(description)) > 0),
  notifiable boolean not null default false,       -- notifiable incident under the state WHS Act
  notified_on date,
  root_cause text not null default '',
  corrective_action text not null default '',
  action_due date,
  closed_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Append-only diary of conversations and decisions about a driver, vehicle or subcontractor.
create table notes (
  id uuid primary key default gen_random_uuid(),
  about text not null check (about in ('drivers','vehicles','subcontractors')),
  about_id uuid not null,
  happened_on date not null,
  author text not null,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create function notes_append_only() returns trigger language plpgsql as $$
begin raise exception 'notes are append-only: add a new note instead'; end $$;
create trigger notes_append_only before update or delete on notes for each row execute function notes_append_only();

-- A load can only go to a combination and driver that are fit to go, at the time it is booked.
create function trip_guard() returns trigger language plpgsql as $$
declare v vehicles; t vehicles; d drivers; s subcontractors;
begin
  if new.status in ('cancelled','delivered') then return new; end if;
  if new.vehicle_id is not null then
    select * into v from vehicles where id = new.vehicle_id;
    if v.kind in ('trailer','dolly') then raise exception 'The towing vehicle cannot be a trailer or dolly'; end if;
    if v.status <> 'active' then raise exception 'Vehicle % is not active', v.code; end if;
    if exists (select 1 from defects where vehicle_id = v.id and status = 'open' and severity = 'major') then
      raise exception 'Vehicle % has an open major defect', v.code; end if;
  end if;
  if new.trailer_id is not null then
    select * into t from vehicles where id = new.trailer_id;
    if t.kind not in ('trailer','dolly') then raise exception 'Trailer % is not a trailer or dolly', t.code; end if;
    if t.status <> 'active' then raise exception 'Trailer % is not active', t.code; end if;
    if exists (select 1 from defects where vehicle_id = t.id and status = 'open' and severity = 'major') then
      raise exception 'Trailer % has an open major defect', t.code; end if;
  end if;
  if new.driver_id is not null then
    select * into d from drivers where id = new.driver_id;
    if not d.active then raise exception 'Driver % is not active', d.code; end if;
  end if;
  if new.subcontractor_id is not null then
    select * into s from subcontractors where id = new.subcontractor_id;
    if s.status <> 'active' then raise exception 'Subcontractor % is not active', s.code; end if;
  end if;
  return new;
end $$;
create function work_guard() returns trigger language plpgsql as $$
begin
  if exists (select 1 from work_periods w where w.id <> new.id and w.driver_id = new.driver_id
             and w.starts_at < new.ends_at and w.ends_at > new.starts_at) then
    raise exception 'Work period overlaps another work period for this driver';
  end if;
  return new;
end $$;
create trigger work_guard before insert or update on work_periods for each row execute function work_guard();

create trigger trip_guard before insert or update on trips for each row execute function trip_guard();

-- ---------------------------------------------------------------- views

-- Next service by kilometres and by date, whichever comes first.
create view service_due as
select v.id, v.code, v.rego, v.name, v.kind, v.odometer_km, v.odometer_on,
  ls.done_on last_service_on, ls.odometer_km last_service_km,
  case when v.service_interval_km is not null and ls.odometer_km is not null then ls.odometer_km + v.service_interval_km end next_service_km,
  case when v.service_interval_km is not null and ls.odometer_km is not null and v.odometer_km is not null
       then ls.odometer_km + v.service_interval_km - v.odometer_km end km_remaining,
  case when v.service_interval_days is not null and ls.done_on is not null then ls.done_on + v.service_interval_days end next_service_on,
  case when v.service_interval_days is not null and ls.done_on is not null then ls.done_on + v.service_interval_days - current_date end days_remaining
from vehicles v
left join lateral (
  select s.done_on, s.odometer_km from services s
  where s.vehicle_id = v.id and s.kind = 'scheduled'
  order by s.done_on desc, s.odometer_km desc nulls last limit 1
) ls on true
where v.status <> 'retired';

create view credential_status as
select c.id, c.code, d.code driver_code, d.name driver, c.kind, c.name, c.reference, c.expires_on,
  c.expires_on - current_date days_left, c.evidence
from credentials c join drivers d on d.id = c.driver_id
where d.active;

create view open_defects as
select x.id, x.code, v.code vehicle, v.rego, x.reported_on, x.reported_by, x.severity, x.status, x.description,
  current_date - x.reported_on days_open,
  (select count(*)::int from trips t where (t.vehicle_id = v.id or t.trailer_id = v.id) and t.status = 'planned') planned_trips
from defects x join vehicles v on v.id = x.vehicle_id
where x.status <> 'repaired';

create view trip_mass as
select t.id, t.code, t.customer, t.departs_at, t.origin, t.destination, t.status,
  coalesce(v.code, '') vehicle, coalesce(tr.code, '') trailer, coalesce(d.name, s.name, '') carrier,
  t.mass_limit_kg, t.gross_mass_kg, t.weighed_by, t.restraint_checked,
  case when t.gross_mass_kg is null or t.mass_limit_kg is null then null
       else round(100.0 * (t.gross_mass_kg - t.mass_limit_kg) / t.mass_limit_kg, 1) end over_pct,
  case when t.gross_mass_kg is null or t.mass_limit_kg is null then 'not weighed'
       when t.gross_mass_kg <= t.mass_limit_kg then 'within limit'
       when t.gross_mass_kg < t.mass_limit_kg * 1.05 then 'minor risk'
       when t.gross_mass_kg < t.mass_limit_kg * 1.20 then 'substantial risk'
       else 'severe risk' end mass_category
from trips t
left join vehicles v on v.id = t.vehicle_id
left join vehicles tr on tr.id = t.trailer_id
left join drivers d on d.id = t.driver_id
left join subcontractors s on s.id = t.subcontractor_id
where t.status <> 'cancelled';

create view subcontractor_status as
select s.id, s.code, s.name, s.abn, s.accreditation, s.insurance_due, s.insurance_due - current_date insurance_days_left,
  s.cor_acknowledged_on, s.last_review_on, current_date - s.last_review_on days_since_review, s.status,
  (select count(*)::int from trips t where t.subcontractor_id = s.id and t.status in ('planned','departed')) open_trips,
  (select count(*)::int from trips t where t.subcontractor_id = s.id and t.departs_at > now() - interval '90 days' and t.status <> 'cancelled') trips_90_days
from subcontractors s where s.status <> 'ended';

create view incident_actions as
select i.id, i.code, i.occurred_on, i.kind, coalesce(v.code, '') vehicle, coalesce(d.name, '') driver,
  i.description, i.notifiable, i.notified_on, i.corrective_action, i.action_due,
  case when i.action_due is not null then current_date - i.action_due end days_overdue, i.closed_on
from incidents i left join vehicles v on v.id = i.vehicle_id left join drivers d on d.id = i.driver_id;

-- Work totals per driver per calendar day (UTC), for the review page. The rule checks run in scripts/lib/fatigue.mjs.
create view work_days as
select d.code driver_code, d.name driver, d.fatigue_option, (w.starts_at at time zone 'UTC')::date work_day,
  round(sum(extract(epoch from (w.ends_at - w.starts_at)) / 60))::int work_minutes,
  count(*)::int periods, min(w.starts_at) first_start, max(w.ends_at) last_end
from work_periods w join drivers d on d.id = w.driver_id
group by d.code, d.name, d.fatigue_option, (w.starts_at at time zone 'UTC')::date;

-- ---------------------------------------------------------------- housekeeping

create trigger updated before update on vehicles for each row execute function stamp_updated();
create trigger updated before update on drivers for each row execute function stamp_updated();
create trigger updated before update on credentials for each row execute function stamp_updated();
create trigger updated before update on subcontractors for each row execute function stamp_updated();
create trigger updated before update on defects for each row execute function stamp_updated();
create trigger updated before update on services for each row execute function stamp_updated();
create trigger updated before update on work_periods for each row execute function stamp_updated();
create trigger updated before update on trips for each row execute function stamp_updated();
create trigger updated before update on incidents for each row execute function stamp_updated();

alter table vehicles enable row level security;
alter table drivers enable row level security;
alter table credentials enable row level security;
alter table subcontractors enable row level security;
alter table defects enable row level security;
alter table services enable row level security;
alter table work_periods enable row level security;
alter table trips enable row level security;
alter table incidents enable row level security;
alter table notes enable row level security;
