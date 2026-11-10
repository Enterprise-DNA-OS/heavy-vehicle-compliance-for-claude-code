-- Fictional demo carrier: Example Freight, a 5-unit Australian general freight operator.
-- Dates are relative to today so the attention commands always have something to say.
-- Idempotent: every insert skips a record that is already there.

insert into vehicles (code, rego, name, kind, gvm_kg, rego_due, inspection_due, service_interval_km, service_interval_days, odometer_km, odometer_on, maintenance_scheme) values
  ('PM01', 'XQ41AB', 'Kenworth T610 prime mover', 'prime_mover', 26000, current_date + 120, current_date + 200, 30000, 180, 412300, current_date - 1, 'nhvas'),
  ('PM02', 'XR77CD', 'Volvo FH540 prime mover', 'prime_mover', 26500, current_date + 45, current_date + 90, 25000, 180, 268900, current_date - 1, 'nhvas'),
  ('RG01', 'XS12EF', 'Isuzu FVZ 260 rigid tautliner', 'rigid', 26000, current_date - 3, null, 20000, 180, 104500, current_date - 2, 'nhvas'),
  ('TR01', 'Z90GH', 'Vawdrey 45ft drop deck trailer', 'trailer', null, current_date + 150, null, null, 180, null, null, 'nhvas'),
  ('TR02', 'Z91JK', 'Krueger 45ft tautliner trailer', 'trailer', null, current_date + 25, null, null, 180, null, null, 'nhvas')
on conflict (code) do nothing;

insert into drivers (code, name, licence_class, fatigue_option, work_diary, base, phone) values
  ('DPATEL', 'Dev Patel', 'HC', 'standard', 'written', 'Dandenong South', '0400 000 001'),
  ('KNGUYEN', 'Kim Nguyen', 'MC', 'standard', 'ewd', 'Dandenong South', '0400 000 002'),
  ('RLEE', 'Ray Lee', 'HR', 'bfm', 'written', 'Dandenong South', '0400 000 003'),
  ('TBROWN', 'Tom Brown', 'HR', 'standard', 'none', 'Dandenong South', '0400 000 004')
on conflict (code) do nothing;

insert into credentials (code, driver_id, kind, name, reference, expires_on, evidence)
select x.code, d.id, x.kind, x.name, x.reference, x.expires_on, x.evidence
from (values
  ('LIC-DP', 'DPATEL', 'licence', 'Heavy vehicle licence HC', '0123456', current_date + 400, 'Licence copy in driver file'),
  ('MED-DP', 'DPATEL', 'medical', 'Driver medical', '', current_date + 20, 'Clinic letter in driver file'),
  ('LIC-KN', 'KNGUYEN', 'licence', 'Heavy vehicle licence MC', '0234567', current_date + 700, 'Licence copy in driver file'),
  ('MED-KN', 'KNGUYEN', 'medical', 'Driver medical', '', current_date - 5, 'Clinic letter in driver file'),
  ('LIC-RL', 'RLEE', 'licence', 'Heavy vehicle licence HR', '0345678', current_date + 200, 'Licence copy in driver file'),
  ('BFM-RL', 'RLEE', 'fatigue_training', 'BFM work and rest hours training', 'RTO certificate', current_date + 15, ''),
  ('LIC-TB', 'TBROWN', 'licence', 'Heavy vehicle licence HR', '0456789', current_date + 100, 'Licence copy in driver file'),
  ('MED-TB', 'TBROWN', 'medical', 'Driver medical', '', null, '')
) as x(code, driver, kind, name, reference, expires_on, evidence)
join drivers d on d.code = x.driver
on conflict (code) do nothing;

insert into subcontractors (code, name, abn, contact_email, accreditation, insurance_due, cor_acknowledged_on, last_review_on) values
  ('SWIFT', 'Swift Haulage Pty Ltd', '11 111 111 111', 'ops@swift.example.invalid', 'nhvas', current_date + 200, current_date - 300, current_date - 100),
  ('OUTBACK', 'Outback Freight Lines', '22 222 222 222', 'admin@outback.example.invalid', 'none', current_date - 10, null, current_date - 400)
on conflict (code) do nothing;

insert into services (code, vehicle_id, kind, done_on, odometer_km, workshop, cost_cents, notes)
select x.code, v.id, x.kind, x.done_on, x.km, x.workshop, x.cost, x.notes
from (values
  ('SVC-101', 'PM01', 'scheduled', current_date - 150, 385000, 'Southside Diesel', 184050, 'A service, brakes inspected'),
  ('SVC-102', 'PM02', 'scheduled', current_date - 200, 240000, 'Southside Diesel', 162000, 'A service'),
  ('SVC-103', 'PM02', 'repair', current_date - 60, 259000, 'Southside Diesel', 96500, 'Air dryer replaced'),
  ('SVC-104', 'RG01', 'scheduled', current_date - 40, 98000, 'Isuzu Dandenong', 121000, 'B service'),
  ('SVC-105', 'TR01', 'scheduled', current_date - 100, null, 'Trailer Tech', 74000, 'Brakes and bearings'),
  ('SVC-106', 'TR02', 'scheduled', current_date - 30, null, 'Trailer Tech', 69000, 'Brakes and bearings')
) as x(code, vehicle, kind, done_on, km, workshop, cost, notes)
join vehicles v on v.code = x.vehicle
on conflict (code) do nothing;

-- Trips go in before the open major defect on TR01, as they would in real life: the load was booked, then the fault was found.
insert into trips (code, customer, departs_at, arrives_at, origin, destination, distance_km, beyond_100km, vehicle_id, trailer_id, driver_id, subcontractor_id, mass_limit_kg, gross_mass_kg, weighed_by, restraint_checked, status)
select x.code, x.customer, x.departs_at, x.arrives_at, x.origin, x.destination, x.km, x.far, v.id, t.id, d.id, s.id, x.limit_kg, x.gross_kg, x.weighed_by, x.restraint, x.status
from (values
  ('T201', 'Coastal Building Supplies', (current_date - 3)::timestamp at time zone 'UTC' + interval '20 hours', (current_date - 2)::timestamp at time zone 'UTC' + interval '1 hour', 'Dandenong South VIC', 'Albury NSW', 320, true, 'PM01', 'TR02', 'DPATEL', null, 42500, 44100, 'Dandenong weighbridge docket 55120', true, 'delivered'),
  ('T202', 'Riverina Grain Co', (current_date - 2)::timestamp at time zone 'UTC' + interval '4 hours', (current_date - 2)::timestamp at time zone 'UTC' + interval '17 hours', 'Laverton VIC', 'Wagga Wagga NSW', 450, true, 'PM02', 'TR01', 'KNGUYEN', null, 42500, 51500, 'Laverton weighbridge docket 88231', false, 'delivered'),
  ('T203', 'Metro Hardware', current_date::timestamp at time zone 'UTC', null, 'Dandenong South VIC', 'Traralgon VIC', 140, true, 'RG01', null, 'TBROWN', null, 22500, null, '', true, 'departed'),
  ('T204', 'Riverina Grain Co', (current_date + 1)::timestamp at time zone 'UTC' + interval '4 hours', null, 'Laverton VIC', 'Wagga Wagga NSW', 450, true, 'PM02', 'TR01', 'KNGUYEN', null, 42500, null, '', false, 'planned'),
  ('T205', 'Coastal Building Supplies', (current_date + 1)::timestamp at time zone 'UTC' + interval '6 hours', null, 'Dandenong South VIC', 'Canberra ACT', 660, true, null, null, null, 'OUTBACK', 42500, null, '', false, 'planned'),
  ('T206', 'Metro Hardware', (current_date - 5)::timestamp at time zone 'UTC' + interval '6 hours', (current_date - 5)::timestamp at time zone 'UTC' + interval '14 hours', 'Dandenong South VIC', 'Shepparton VIC', 190, true, null, null, null, 'SWIFT', 42500, 42000, 'On-board scales printout', true, 'delivered')
) as x(code, customer, departs_at, arrives_at, origin, destination, km, far, vehicle, trailer, driver, sub, limit_kg, gross_kg, weighed_by, restraint, status)
left join vehicles v on v.code = x.vehicle
left join vehicles t on t.code = x.trailer
left join drivers d on d.code = x.driver
left join subcontractors s on s.code = x.sub
where not exists (select 1 from trips existing where existing.code = x.code);  -- not "on conflict": the trip guard runs before the conflict check

insert into defects (code, vehicle_id, reported_on, reported_by, description, severity, status, repaired_on, repair_note)
select x.code, v.id, x.reported_on, x.by, x.description, x.severity, x.status, x.repaired_on, x.note
from (values
  ('DEF-301', 'TR01', current_date - 1, 'Kim Nguyen', 'Air leak at rear trailer brake chamber, audible at pre-start', 'major', 'open', null::date, ''),
  ('DEF-302', 'PM01', current_date - 18, 'Dev Patel', 'Passenger side mirror cracked', 'minor', 'open', null::date, ''),
  ('DEF-303', 'RG01', current_date - 30, 'Tom Brown', 'Tail light lens broken', 'minor', 'repaired', current_date - 28, 'Lens replaced in yard by Tom'),
  ('DEF-304', 'TR01', current_date - 70, 'Kim Nguyen', 'Curtain strap torn', 'minor', 'repaired', current_date - 66, 'Strap replaced, Trailer Tech')
) as x(code, vehicle, reported_on, by, description, severity, status, repaired_on, note)
join vehicles v on v.code = x.vehicle
on conflict (code) do nothing;

-- Work periods in UTC. Kim's Wagga run breaks two standard hours limits; Dev's is clean; Ray works BFM.
insert into work_periods (code, driver_id, starts_at, ends_at, source, evidence)
select x.code, d.id, (current_date - x.day_offset)::timestamp at time zone 'UTC' + x.start_h * interval '1 hour', (current_date - x.day_offset)::timestamp at time zone 'UTC' + x.end_h * interval '1 hour', x.source, x.evidence
from (values
  ('WP-KN1', 'KNGUYEN', 2, 4.0, 10.0, 'ewd', 'EWD export, demo'),
  ('WP-KN2', 'KNGUYEN', 2, 10.25, 17.5, 'ewd', 'EWD export, demo'),
  ('WP-KN3', 'KNGUYEN', 1, 3.0, 8.0, 'ewd', 'EWD export, demo'),
  ('WP-DP1', 'DPATEL', 3, 19.0, 24.0, 'written', 'Work diary page 41, demo'),
  ('WP-DP2', 'DPATEL', 2, 0.5, 4.5, 'written', 'Work diary page 41, demo'),
  ('WP-DP3', 'DPATEL', 1, 6.0, 11.0, 'written', 'Work diary page 42, demo'),
  ('WP-RL1', 'RLEE', 2, 2.0, 9.0, 'written', 'Work diary page 12, demo'),
  ('WP-RL2', 'RLEE', 2, 9.5, 16.0, 'written', 'Work diary page 12, demo')
) as x(code, driver, day_offset, start_h, end_h, source, evidence)
join drivers d on d.code = x.driver
where not exists (select 1 from work_periods existing where existing.code = x.code);  -- the overlap guard runs before any conflict check

insert into incidents (code, occurred_on, kind, vehicle_id, driver_id, description, notifiable, notified_on, root_cause, corrective_action, action_due, closed_on)
select x.code, x.occurred_on, x.kind, v.id, d.id, x.description, x.notifiable, x.notified_on, x.root_cause, x.action, x.action_due, x.closed_on
from (values
  ('INC-401', current_date - 20, 'load_shift', 'PM02', 'KNGUYEN', 'Pallets shifted forward under braking near Seymour; no injury, load re-secured on site', false, null::date, 'Two straps per pallet row instead of three', 'Refresher on the Load Restraint Guide for all drivers; restraint sign-off on every load', current_date - 6, null::date),
  ('INC-402', current_date - 5, 'near_miss', 'RG01', 'TBROWN', 'Forklift reversed close to driver at customer dock', false, null::date, 'No exclusion zone marked at dock 3', 'Customer told; site rule added to driver induction', current_date + 10, current_date - 2)
) as x(code, occurred_on, kind, vehicle, driver, description, notifiable, notified_on, root_cause, action, action_due, closed_on)
left join vehicles v on v.code = x.vehicle
left join drivers d on d.code = x.driver
on conflict (code) do nothing;
