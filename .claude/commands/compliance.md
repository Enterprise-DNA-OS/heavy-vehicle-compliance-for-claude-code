---
description: "Check every record against the rules in docs/compliance.md and report what is breached, missing or about to lapse, with the rule and source."
---

# Compliance

1. Read docs/compliance.md.
2. Run `npm run fleet -- compliance`.
3. Report as a table ordered by severity: open major defects with planned loads, severe mass, standard hours breaches, expired credentials, then the rest.
4. For each breach, say the next step the operator can approve: record a repair, ground a vehicle, request a document (draft only), add a corrective action.
5. If a rule looks out of date, say so and stop. The operator confirms the rule, then the doc and the check change together. Nothing here is legal advice.
