# The CLI

```bash
npm run fleet -- <command> [arguments] [--json]
```

Human tables by default, `--json` for machines. Names resolve by code, by name (or registration, for vehicles), case-insensitively, then by id prefix or partial match. More than one match lists the candidates and exits 1 (with `--json`, the candidates come back on stderr). Unknown options and extra arguments are refused.

## Reads

`vehicles`, `drivers`, `subcontractors`, `trips`, `credentials`, `incidents`, `service-due`, `rego-due`, `credentials-due`, `open-defects`, `grounded`, `mass`, `unweighed`, `diary-gaps`, `subcontractor-review`, `actions-due`, `work-days`, `work-periods`, `service-history`, `maintenance-spend`, `repeat-defects`, `driver-defects`.

One record: `driver <ref>`, `vehicle <ref>`, `subcontractor <ref>`.

Checks: `fatigue [--days=28]`, `compliance`, `attention`.

## Writes

| Command | What it does |
|---|---|
| `add <type> --data=<file.json>` | Insert one record |
| `update <type> <ref> --data=<file.json>` | Change fields; `code` never changes |
| `log <drivers\|vehicles\|subcontractors> <ref> --author= --text= --date=YYYY-MM-DD` | Append a note |
| `defect <vehicle> --text= --by= [--major] [--date=]` | Record a fault |
| `repair <defect> --note= [--date=]` | Close a fault |
| `service <vehicle> [--km=] [--workshop=] [--cost=dollars] [--kind=scheduled\|repair\|inspection] [--date=] [--notes=]` | Record a service; moves the odometer forward |
| `import managevehicle --kind=vehicles\|drivers\|work --file= [--map=] [--dry-run]` | Bring records across |
| `export --out=<new file>` | Every record to JSON; never overwrites |

Drafts (written to `drafts/`, never sent): `weekly-review`, `draft-weekly`, `draft-insurance-request <subcontractor>`.

## Record types and fields

| Type | Fields |
|---|---|
| vehicles | code, rego, name, kind (prime_mover, rigid, trailer, dolly, bus, light), gvm_kg, rego_due, inspection_due, service_interval_km, service_interval_days, odometer_km, odometer_on, maintenance_scheme (none, nhvas, hva, other), status (active, off_road, retired), notes |
| drivers | code, name, licence_class (LR, MR, HR, HC, MC, C), fatigue_option (standard, bfm, afm), work_diary (written, ewd, none), base, phone, active, notes |
| credentials | code, driver_id, kind (licence, medical, fatigue_training, induction, dangerous_goods, other), name, reference, expires_on, evidence |
| subcontractors | code, name, abn, contact_email, accreditation (none, nhvas, hva, trucksafe, wa_hva, other), insurance_due, cor_acknowledged_on, last_review_on, status (active, suspended, ended), notes |
| defects | code, vehicle_id, reported_on, reported_by, description, severity (minor, major), status (open, repaired, deferred), repaired_on, repair_note |
| services | code, vehicle_id, kind (scheduled, repair, inspection), done_on, odometer_km, workshop, cost_cents, notes |
| work_periods | code, driver_id, starts_at, ends_at, source (written, ewd, timesheet), evidence |
| trips | code, customer, departs_at, arrives_at, origin, destination, distance_km, beyond_100km, vehicle_id, trailer_id, driver_id, subcontractor_id, mass_limit_kg, gross_mass_kg, weighed_by, restraint_checked, status (planned, departed, delivered, cancelled), notes |
| incidents | code, occurred_on, kind (crash, near_miss, injury, load_shift, breach_notice, other), vehicle_id, driver_id, description, notifiable, notified_on, root_cause, corrective_action, action_due, closed_on |

Dates are `YYYY-MM-DD`. Timestamps need a time zone (`2026-11-10T06:00:00+10:00`); tables display them in UTC. Money is whole cents (`cost_cents`), shown as AUD. `*_id` fields take a code or name.

## Rules the database enforces

- A load cannot be booked or changed onto a vehicle or trailer with an open major defect, an inactive vehicle, driver or subcontractor, or a trailer in the towing slot.
- A subcontracted load has no own driver or vehicle.
- A driver's work periods cannot overlap; one period is at most 24 hours.
- A repaired defect needs a repair date on or after the report date.
- Notes are append-only.
