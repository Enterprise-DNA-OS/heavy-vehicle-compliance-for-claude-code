<h1 align="center">Heavy Vehicle Compliance for Claude Code</h1>

<p align="center">
  <strong>The open-source heavy vehicle compliance system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your ManageVehicle data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=managevehicle">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/managevehicle?utm_source=github&utm_medium=readme&utm_campaign=managevehicle">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#ten-questions-to-ask">Ten questions</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#the-rules-it-checks">Rules</a> &bull;
  <a href="#instead-of-managevehicle">Instead of ManageVehicle</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Heavy Vehicle Compliance for Claude Code keeps the records an Australian carrier needs under the Heavy Vehicle National Law (HVNL) and shows to an accreditation auditor: vehicles and trailers, servicing, daily check faults, driver licences and medicals, work and rest records, load weights, load restraint, subcontracted carriers and incidents. It is a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask in plain English.

ManageVehicle charges A$30 a month per road vehicle for the first 30, A$20 for each one after that, A$7 per trailer, and A$199 or A$399 a month for subcontractor management ([managevehicle.com/pricing](https://www.managevehicle.com/pricing), checked 10 November 2026). A carrier with 40 trucks, 30 trailers and unlimited subcontractors pays A$1,709 a month, about A$20,500 a year. This holds the same records in a database you own.

It is for owner-run carriers with 5 to 80 trucks: the operations manager who books the loads, the compliance officer who keeps the accreditation, and the owner who carries the chain of responsibility duty.

Want it with a web front end, a driver phone app, or on a different stack? That is a customisation, and it is what Enterprise DNA does: [book a call](https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=managevehicle).

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/heavy-vehicle-compliance-for-claude-code.git
cd heavy-vehicle-compliance-for-claude-code
npm install
npm run demo        # fictional carrier: 5 units, 4 drivers, 2 subcontractors
npm test            # disposable database, every command, PASS or FAIL
npm run fleet -- attention
npm run view        # read-only pages in views/
npm run docs        # vehicle files, driver files, incident reports in docs-out/
```

Then open the folder in Claude Code and type `/attention`.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-vehicle fee. One carrier per database. Row-level security is on with no public policies: connect with a trusted role. Never run `npm run demo` against your working database.

## Ten questions to ask

Each is answered today by one command on your own records.

1. Which loads are booked on a truck or trailer with an open major defect? (`grounded`)
2. Which vehicles are due for service by kilometres or by date in the next 30 days, and which are already overdue? (`service-due`)
3. Which drivers have a licence, medical or fatigue training expiring this month, or no copy on file? (`credentials-due`)
4. Which drivers' recorded work broke a standard hours limit in the last four weeks, and in which window? (`fatigue`)
5. Which loads weighed more than the recorded limit, and was it a minor, substantial or severe risk breach? (`mass`)
6. Which loads left with no recorded weight or no load restraint check? (`unweighed`)
7. Which trips went more than 100 km from base with no work diary record behind them? (`diary-gaps`)
8. Which subcontractors are carrying our loads with expired insurance or no signed chain of responsibility terms? (`subcontractor-review`)
9. Which trucks keep coming back with faults, and what has each cost to maintain this year? (`repeat-defects`, `maintenance-spend`)
10. Which incident corrective actions are overdue? (`actions-due`)

## The commands

43 recipes live in `.claude/commands`. The weekly rituals:

| Command | What it does |
|---|---|
| `/attention` | Everything that needs a decision today: loads that cannot go, compliance findings, services due, expiring credentials, open incident actions |
| `/weekly-review` | The Monday compliance review, written to `drafts/` |
| `/compliance` | Every rule in `docs/compliance.md` checked against the records, with the source cited |
| `/fatigue` | Recorded work against the standard hours limits for solo drivers |
| `/defect`, `/repair` | Record a daily check fault (`--major` stops new loads on that vehicle) and close it when fixed |
| `/service` | Record a service; resets the kilometre and date interval |
| `/grounded` | Booked loads on a vehicle with an open major defect |
| `/service-due`, `/rego-due` | Servicing, registration and inspection coming up or overdue |
| `/credentials-due` | Licences, medicals and training expiring or missing |
| `/mass`, `/unweighed` | Loads over the recorded limit, and loads with no weight or restraint check |
| `/diary-gaps` | 100+ km trips with no work diary record |
| `/subcontractor-review` | Carriers with insurance, acknowledgement or review gaps |
| `/draft-insurance-request` | Drafts the document request to a subcontractor; never sends |
| `/actions-due` | Incident corrective actions still open |
| `/driver`, `/vehicle`, `/subcontractor` | One record, its history and notes |
| `/add`, `/update`, `/log` | Record what the operator tells you |
| `/import` | ManageVehicle vehicle and driver registers, EWD work records |
| `/export` | Every record to one JSON file |
| `/documents`, `/views`, `/new-view` | Paperwork and read-only pages in your brand |
| `/customise` | Add a field, change a rule, rename a stage |

Every recipe drives one CLI: `npm run fleet -- help`. Fields and flags are in [docs/cli.md](docs/cli.md).

## The rules it checks

Each check cites its source in [docs/compliance.md](docs/compliance.md): HVNL standard hours for solo drivers (Fatigue Management Regulation, Schedule 1), the 100 km work diary requirement, mass breach categories (HVNL ss 98 to 100), loading requirements and the Load Restraint Guide, the primary duty in HVNL s 26C, the NHVAS Maintenance Management standards, and the WHS duty to notify. BFM and AFM hours are referred for a manual check rather than calculated.

This is a record check, not a fitness-to-drive decision, not legal advice and not an approved electronic work diary. Drivers keep using their written work diary or an NHVR-approved EWD; this reads those records.

## Documents and views

`npm run docs` renders, in your brand (`brand.json`):

- a vehicle maintenance file per vehicle (service history, faults found and repaired, next service)
- a driver compliance file per driver (licences, medicals, training, recorded work)
- a chain of responsibility review per subcontractor
- an incident report per incident

`npm run view` renders three read-only pages: the Monday review, fleet maintenance, and mass and restraint. Static HTML files: open them, print them, attach them. Why there are no screens: [docs/why-no-front-end.md](docs/why-no-front-end.md).

## Your first hour: ten things to ask for

1. "Put our business name and logo on the documents."
2. "Import our vehicle list from this ManageVehicle export."
3. "Import last month's EWD records for every driver."
4. "Kim just found an air leak on TR01 at pre-start. Record it as major."
5. "What can't go tomorrow?"
6. "Which drivers need a medical before Christmas?"
7. "Add a dangerous goods licence expiry for Ray."
8. "Our service interval for the Volvos is 25,000 km. Change it."
9. "Draft a request to Outback Freight for their certificate of currency."
10. "Write Monday's compliance review."

## Instead of ManageVehicle

Export your vehicle and driver lists to CSV, dry run the import, map any column names that differ, then import for real. EWD work records come across from the EWD provider's CSV export. Full steps, what maps and what does not carry over: [docs/replace-managevehicle.md](docs/replace-managevehicle.md).

## Architecture

```
heavy-vehicle-compliance-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/fleet.mjs         the one CLI the commands drive
  scripts/lib/fatigue.mjs   the standard hours checks
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema, guards and views
  supabase/seed.sql         fictional demo carrier
  views.json, documents.json  the pages and paperwork
  docs/                     rules, CLI contract, replacement guide
```

## Testing

`npm test` builds a disposable database and checks every command, the standard hours windows against hand-worked timelines, mass categories, the trip and work period guards, imports (dry run, repeat, mapped columns, rollback on a bad row), drafts, export, row-level security and the rendered documents. It ignores `DATABASE_URL`; set `TEST_DATABASE_URL` only to a disposable Postgres. Verified on Linux with PGlite and PostgreSQL 17. The Windows and Linux workflow in `.github/workflows` runs on demand.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, one small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Heavy Vehicle Compliance for Claude Code for your business, brings your ManageVehicle records across, connects it to your EWD and telematics exports, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=managevehicle)
- Read more: [enterprisedna.co/omni/instead-of/managevehicle](https://enterprisedna.co/omni/instead-of/managevehicle?utm_source=github&utm_medium=readme&utm_campaign=managevehicle)

## License

MIT. Copyright (c) 2026 Enterprise DNA. Independent project: ManageVehicle is a product of its owners and is not affiliated with this project.
