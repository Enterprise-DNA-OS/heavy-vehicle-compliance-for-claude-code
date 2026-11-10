---
description: "Bring vehicles and drivers across from ManageVehicle, and work records from an EWD export."
---

# Import

Read docs/replace-managevehicle.md. Always dry run first: `npm run fleet -- import managevehicle --kind=vehicles|drivers|work --file=<csv> --dry-run`. If the columns differ, write a mapping JSON (`{"code":"Unit No"}`) and pass `--map=<file>`. Then run it without --dry-run. Repeat imports change nothing; a changed record stops the import for reconciliation.
