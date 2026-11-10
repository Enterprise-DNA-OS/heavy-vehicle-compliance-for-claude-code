# Moving off ManageVehicle

ManageVehicle does not publish its export columns. Its pricing page says its team helps you export your records when you leave, and its compliance pages say reports and documents can be exported to share with auditors. Ask for CSV or Excel files of the lists below, then bring them in here one at a time. Keep ManageVehicle running until a week of checks here matches.

## 1. Ask for these exports

| Export | Needed columns (the importer's default names) |
|---|---|
| Vehicle and trailer list | Fleet Number, Registration, Description, Vehicle Type, Rego Expiry, Odometer, Service Interval Km |
| Driver list | Driver ID, Driver Name, Licence Class, Licence Number, Licence Expiry, Medical Expiry, Fatigue Option |
| Work records (from the EWD) | Driver ID, Work Start, Work End, Source |

Save an Excel file as CSV (UTF-8). Dates as YYYY-MM-DD; work times as ISO timestamps with a time zone, for example `2026-10-21T06:00:00+10:00`. Examples of each file are in `examples/`.

## 2. Dry run, then import

```bash
npm run fleet -- import managevehicle --kind=vehicles --file=vehicles.csv --dry-run
npm run fleet -- import managevehicle --kind=vehicles --file=vehicles.csv
npm run fleet -- import managevehicle --kind=drivers --file=drivers.csv
npm run fleet -- import managevehicle --kind=work --file=ewd-export.csv
```

If your file names a column differently, write a mapping file and pass it:

```json
{ "code": "Unit No", "rego": "Plate", "kind": "Asset Type" }
```

```bash
npm run fleet -- import managevehicle --kind=vehicles --file=vehicles.csv --map=map.json --dry-run
```

Or ask Claude Code: "map this export to the importer and dry run it".

## 3. What maps

- Vehicle types: Prime Mover, Rigid, Truck, Trailer, Dolly, Bus, Ute, Van. Anything else stops the import with the row number.
- A driver's licence and medical expiry become credentials, marked "Imported from ManageVehicle: file the copy" so the evidence check reminds you to note where each copy is kept.
- Work records keep their start and end and are checked by `/fatigue` straight away.
- Repeat imports change nothing. A record that already exists with a different registration, type or name stops the import so you can decide which is right. A failed import saves nothing.

## 4. What does not carry over automatically

- Service history, defects, pre-start checklists, incidents, toolbox meetings and documents (PDFs and photos). Ask for each as a CSV or report and have Claude Code map it, or start these fresh from today and keep the old records filed for the audit period.
- Telematics and GPS data. Keep it with your telematics provider; bring across only what a check needs.
- The electronic work diary itself. This is not an NHVR-approved EWD. Drivers keep using a written work diary or an approved EWD; you import the records.
- Job dispatch and run sheets.

## 5. Check before you switch

Run `/compliance` and `/attention` and compare them with ManageVehicle's dashboard for a week. Every difference is either a gap in the import or a rule worth looking at.
