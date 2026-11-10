---
description: "Add a record: vehicle, driver, credential, subcontractor, defect, service, work period, trip or incident."
---

# Add

Write the fields the operator gave to a temp JSON file and run `npm run fleet -- add <type> --data=<file>`. Fields are listed in docs/cli.md. Driver, vehicle and subcontractor references can be codes or names. Never invent a value the operator did not give.
