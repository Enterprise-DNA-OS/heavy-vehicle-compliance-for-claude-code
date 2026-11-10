# The rules this system checks

`npm run fleet -- compliance` checks the records against the rules below. Each has an id (the `rule` column in the output), the source, what a breach looks like in the data, and the scope. Rules change: confirm the current text with the National Heavy Vehicle Regulator (NHVR) and your accreditation auditor before relying on a check. Nothing here is legal advice, and a clear result is never a fitness-to-drive decision or dispatch clearance.

Western Australia and the Northern Territory do not apply the HVNL. If you run there, tell Claude Code which rules apply and use `/customise` to change the checks.

## Fatigue: standard hours for a solo driver

Source: Heavy Vehicle (Fatigue Management) National Regulation, Schedule 1, Table 1 (standard hours, solo drivers of a fatigue-regulated heavy vehicle). NHVR guide: https://www.nhvr.gov.au/work-and-rest and https://www.nhvr.gov.au/safety-accreditation-compliance/fatigue-management/counting-time

| Rule | In any period of | Maximum work | Rest the check looks for |
|---|---|---|---|
| SH-5.5H | 5 hours 30 minutes | 5 hours 15 minutes | (15 continuous minutes) |
| SH-8H | 8 hours | 7 hours 30 minutes | (30 minutes in 15-minute blocks) |
| SH-11H | 11 hours | 10 hours | (60 minutes in 15-minute blocks) |
| SH-24H | 24 hours | 12 hours | 7 continuous hours stationary rest |
| SH-7D | 7 days | 72 hours | 24 continuous hours stationary rest |
| SH-14D | 14 days | 144 hours | not checked: night rest breaks |

How the check works (`scripts/lib/fatigue.mjs`): it reads the recorded work periods for each standard hours driver over the last 28 days, treats any time between work periods as rest, and counts a break shorter than 15 continuous minutes as work. Each window is anchored at the start of a work period. A long rest check only runs on windows that end before the driver's last recorded work, so a week in progress is not called short of rest. It reports the first breaching window per rule.

Not checked here, and listed for a manual review: the 14-day night rest breaks, the 15-minute rounding a work diary applies, two-up driving, the personal use exemption, and Basic or Advanced Fatigue Management (BFM, AFM) hours. A BFM or AFM driver with recorded work is listed as `BFM` or `AFM` for a manual check against the accreditation.

## Work diary

- **WORK-DIARY.** Source: HVNL Chapter 6, Part 6.4 (work diaries), which requires a driver doing 100+ km work (more than 100 km from the driver's base) on a fatigue-regulated heavy vehicle to keep a work diary. Breach in the data: a trip marked `beyond_100km` whose driver keeps no diary (`work_diary = 'none'`), or with no recorded work period overlapping the trip.

## Mass and loading

- **MASS.** Source: HVNL s 96 (compliance with mass requirements) and ss 98 to 100 (minor, substantial and severe risk breaches). NHVR: https://www.nhvr.gov.au/safety-accreditation-compliance/on-road-compliance-and-enforcement/breach-categorisation. Breach in the data: `gross_mass_kg` over `mass_limit_kg` on a trip. Category: under 5% over is minor risk, 5% to under 20% substantial risk, 20% or more severe risk. The limit is the one you record for that combination and route (general mass limits, concessional or higher mass limits, a permit); the check does not work out axle group limits.
- **MASS-RECORD.** Source: HVNL s 26C (primary duty: so far as is reasonably practicable). Breach in the data: a departed or delivered load with no recorded weight. This is an operator policy check, not a legal breach in itself.
- **RESTRAINT.** Source: HVNL Part 4.4 (loading requirements) and the NTC Load Restraint Guide 2018. Breach in the data: a departed or delivered load with no restraint check recorded.

## Vehicles

- **REGO.** Source: state registration law. Breach: registration expired or no expiry recorded.
- **INSPECTION.** Source: the state inspection scheme where one applies. Breach: inspection date passed.
- **NHVAS-M4.** Source: NHVAS Maintenance Management standard 4 (maintenance schedules and methods). Breach: a service overdue by kilometres or by date, or a vehicle with no interval or no scheduled service on record.
- **NHVAS-M3.** Source: NHVAS Maintenance Management standard 3 (fault repair) and HVNL s 26C. Breach: a major defect open, or a minor defect open more than 14 days (an operator setting; change it with `/customise`). The database refuses a new or changed load on a vehicle or trailer with an open major defect.

NHVAS is moving to Heavy Vehicle Accreditation (HVA). The record keeping the standards ask for (daily checks, fault recording and reporting, fault repair, schedules, records) is the same evidence either way.

## Drivers

- **CREDENTIAL.** Source: state driver licensing for the licence; operator policy for medicals and inductions. Breach: expired, no expiry recorded, or no heavy vehicle licence on file.
- **EVIDENCE.** Source: NHVAS and HVA records and documentation. Breach: a credential with no note of where the copy is filed.
- **FATIGUE-TRAINING.** Source: NHVAS Basic Fatigue Management standards. Breach: a BFM or AFM driver with no current fatigue training on file.

## Chain of responsibility

- **COR-SUB.** Source: HVNL s 26C (primary duty of each party in the chain to ensure, so far as is reasonably practicable, the safety of its transport activities). Breach in the data: an active subcontractor with expired or missing insurance, no signed acknowledgement of your chain of responsibility terms, or no review in 365 days (an operator setting). What "reasonably practicable" needs for your business is a judgement for you and your adviser; these are the records that show the steps you took.

## Incidents

- **WHS-NOTIFY.** Source: Work Health and Safety Act, s 38 (duty to notify the regulator of a notifiable incident immediately after becoming aware of it), as adopted in each state. Breach: an incident marked notifiable with no notification date.
- **CAPA.** Source: your safety management system. Breach: a corrective action past its due date and not closed.
