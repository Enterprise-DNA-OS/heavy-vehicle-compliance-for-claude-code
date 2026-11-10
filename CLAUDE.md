# Heavy Vehicle Compliance for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS]
- **Operator:** [YOUR NAME], [your role]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| What needs doing today | `/attention` |
| The Monday review | `/weekly-review` |
| Are we compliant? What would the auditor find? | `/compliance` |
| Did anyone break their hours? | `/fatigue` |
| A driver found a fault | `/defect` |
| A fault was fixed | `/repair` |
| A truck came back from the workshop | `/service` |
| What can't go? | `/grounded` |
| What's due for service? | `/service-due` |
| Rego or inspection coming up | `/rego-due` |
| Licences, medicals, training expiring | `/credentials-due` |
| Overweight loads | `/mass` |
| Loads with no weight or restraint check | `/unweighed` |
| Long trips with no diary | `/diary-gaps` |
| Subcontractor paperwork | `/subcontractor-review`, `/draft-insurance-request` |
| Incident actions | `/actions-due` |
| Everything about one driver, truck or carrier | `/driver`, `/vehicle`, `/subcontractor` |
| Record something new or changed | `/add`, `/update`, `/log` |
| Costs and repeat faults | `/maintenance-spend`, `/repeat-defects`, `/driver-defects` |
| Bring records across from ManageVehicle or an EWD | `/import` |
| Paperwork for the auditor | `/documents` |
| A page to look at or print | `/views`, `/new-view` |
| Change a field or a rule | `/customise` |
| A full copy of the data | `/export` |

If an ask fits nothing here, run the CLI directly (`npm run fleet -- help`) and then propose a new command for it.

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.
- A clear check is never a fitness-to-drive decision or dispatch clearance. Say what was checked and what was not (docs/compliance.md).
- This is not an approved electronic work diary. Never tell a driver they can drive on the strength of a result here.
- Never move a load to another vehicle or driver, or close a defect, without the operator saying so in this session.
- Times display in UTC. Convert to the depot's local time before quoting a departure.
- Before changing a rule, read docs/compliance.md and confirm the change with the operator; the doc and the check change together.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the thesis and the guide for moving off ManageVehicle.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/managevehicle
