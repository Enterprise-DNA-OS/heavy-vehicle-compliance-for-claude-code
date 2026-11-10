---
description: "Record a fault found at the daily check or anywhere else."
---

# Defect

Run `npm run fleet -- defect <vehicle> --text="<fault>" --by="<who found it>" [--major] [--date=YYYY-MM-DD]`. Use --major when the vehicle should not operate until repaired: the database then refuses new loads on it.
