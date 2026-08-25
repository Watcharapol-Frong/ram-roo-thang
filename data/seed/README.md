# Seed data

Data files, not schema migrations. They are kept out of `worker/migrations/` on purpose:
`scripts/dev-api.mjs` executes **every** `.sql` file in that folder on boot, so a 216 KB
INSERT script there made every local dev start replay 3,404 rows for no reason.

Each file starts with a `DELETE` so re-running it is safe and idempotent.

```bash
# Load the class schedule into production D1
cd worker && npx wrangler d1 execute ram-roo-thang --remote --file=../data/seed/class-schedule.sql
```

Regenerate `class-schedule.sql` from the university PDF with
`python3 scripts/build-class-schedule.py <file.pdf>` followed by the SQL generation step
documented in the main README.
