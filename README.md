# RAM-ROO-THANG (รามรู้ทาง)

A LINE bot + LIFF app for navigating Ramkhamhaeng University — find buildings, get turn-by-turn
walking directions, check crowdsourced parking conditions, remember where you parked, and look up
exam dates for the courses you saved.

> **Status**: in development for RU Innovation 2026 (demo Sept 1, 2026).
> See [System status](#system-status) at the bottom for what is done and what is not.

## Read these before you start

1. `CONTEXT.md` — terminology (MVP vs Full Vision — do not conflate them)
2. `MVP-SPEC-for-Dev.md` — full spec, including section 9 Out of Scope
3. `docs/adr/` — the reasoning behind four key decisions

**Do not build** anything listed in section 9 (Out of Scope) of `MVP-SPEC-for-Dev.md` without
discussing it first.

## Architecture

The system is **two separate Cloudflare Workers**, deployed with different commands. Don't mix them up:

| Worker | Responsibility | Config | Deploy |
|---|---|---|---|
| `ram-roo-thang-bot` | All backend — LINE webhook + `/api/*` | `worker/wrangler.toml` | `cd worker && npm run deploy` |
| `ram-roo-thang-liff` | Static assets for the LIFF pages | `liff/wrangler.jsonc` | `npx wrangler deploy --config liff/wrangler.jsonc` |

> ⚠️ **Never connect a GitHub integration / Workers Builds to this repo.** It previously deployed
> the static assets *over* the API worker on every push, taking the bot down and wiping all secrets
> (Aug 22, 2026). Always deploy manually via wrangler with an explicit `--config`.

## Where data lives

| Store | Contents | Why here |
|---|---|---|
| **D1** `ram-roo-thang` | `users`, `coin_ledger`, `user_courses`, `exam_alerts_sent`, `room_import_drafts` | Needs real transactions when granting/spending coins, and needs to be queryable |
| **KV** `BASELINE_DATA` | 35 buildings / 8 parking zones / 11 services / 25 shops | Read-only, almost never changes |
| **KV** `PARKING_REPORTS` | Parking condition reports | Must expire on its own — uses KV TTL |
| **KV** `RATE_LIMIT` | Last report time per user | Same, uses TTL |
| **KV** `CHAT_HISTORY_RAM` | Bot conversation history | Same, uses TTL |
| **Static files** | `ru_master.geojson` (91 places), `exam-lookup.json` (2,865 courses) | Static data — served directly by the LIFF worker instead of burning KV read quota |

**D1 has no TTL** — don't move anything here that should expire by itself.

### Why user data is on D1 and not KV

1. KV has no atomic increment — granting/spending coins is read-modify-write, so concurrent
   requests silently lose writes.
2. KV cannot be queried at all, so a ledger (ordered by time, filtered by user, summed) is impossible.
3. Free-tier write quota: KV allows 1,000 rows/day, D1 allows 100,000 rows/day. A 200-user beta is
   estimated at ~2,200 writes/day.

D1 is created in the **APAC** region because writes go to a single primary — a US primary would make
every write from Thailand noticeably slower.

### Coin rules

| Action | Coins | Abuse protection |
|---|---|---|
| Report parking conditions | +10 | 150 m geofence + 30 min rate limit |
| Complete the feedback survey | +30 | Once per account, ever |
| Save your car location | +5 | Once per day (Bangkok date, not UTC) |

Change the amounts in one place: `COIN_REWARDS` in `worker/src/user.js`.

**`coin_ledger` is the source of truth.** `users.coins` is a materialized total, always written in the
same `batch` (a single D1 transaction). If the two ever disagree, trust the ledger and call
`recalculateBalance()`.

Double-claim protection is enforced by **`UNIQUE (user_id, reason, ref_id)`** — the database rejects
it, not an `if` statement in application code:

| reason | ref_id | Effect |
|---|---|---|
| `FEEDBACK` | `once` | Claimable once, ever |
| `SAVE_CAR` | `2026-08-23` | Once per day |
| `PARKING_REPORT` | Report timestamp | One report = one grant |
| `SHOP_REDEEM` | Redemption id | (reserved — shop not built yet) |

## Project structure

```
ram-roo-thang-bot/
├── CONTEXT.md                     — terminology
├── MVP-SPEC-for-Dev.md            — full spec
├── docs/adr/                      — decision records (0001-0004)
│
├── worker/                        — API Worker (all backend)
│   ├── wrangler.toml              — bindings: 4 KV + D1 + Workers AI
│   ├── .secrets.env.example       — copy to .secrets.env and fill in tokens
│   ├── migrations/
│   │   ├── 0001_users_and_coin_ledger.sql
│   │   ├── 0002_exam_alerts.sql
│   │   ├── 0003_exam_rooms.sql
│   │   └── 0004_shop.sql
│   └── src/
│       ├── index.js               — router (LINE webhook + /api/*) + CORS
│       ├── line.js                — signature verify, chat history, Flex Messages, reply
│       ├── ai.js                  — Workers AI + alias matching (5s timeout with fallback)
│       ├── data.js                — KV access
│       ├── user.js                — users, coins, ledger (D1)
│       ├── schedule.js            — saved courses (D1)
│       ├── flex.js                — shared Flex card design system (all bot cards build from here)
│       ├── exam.js                — proactive exam alerts (cron + manual trigger)
│       ├── examroom.js            — reads exam rooms from a photo (vision model + validation)
│       ├── parking.js             — parking reports: geofence, rate limit, aggregation
│       ├── building.js            — building lookup
│       ├── shop.js                — campus shop listing + coin redemption store
│       └── utils.js               — Haversine distance
│
├── liff/                          — LIFF pages (plain static, no build step)
│   ├── wrangler.jsonc
│   ├── index.html                 — loads LIFF SDK + components + app.js
│   ├── app.js                     — all views, map, navigation, profile (~3,000 lines)
│   ├── style.css
│   ├── components/
│   │   ├── RouteCalculator.js     — Google Directions API + dashed marker connectors
│   │   ├── NavigationController.js— live nav: progress tracking, voice, auto re-routing
│   │   └── SheetManager.js        — every bottom sheet variant
│   └── data/                      — copies of the static files served to the browser
│
├── data/                          — source of truth for datasets
│   ├── baseline-dataset.json      — seeded into KV
│   ├── ru_master.geojson           — 91 map places (51 buildings / 8 parking / 25 shops / 7 other)
│   ├── exam-schedule.json          — full exam timetable, 2,865 courses (parser output)
│   ├── exam-lookup.json            — compact form the LIFF actually loads (~10 KB gzipped)
│   └── 20260302_exam_169.pdf       — the original 111-page university announcement
│
└── scripts/
    ├── dev-api.mjs                — dev backend (real worker + in-memory KV/D1)
    ├── serve-liff.mjs             — dev static server
    ├── seed-kv.sh                 — seed baseline-dataset.json into KV (needs jq)
    ├── build-exam-schedule.py     — convert the exam PDF to JSON (needs pypdf)
    └── google-sheets-apps-script.js— Google Sheets receiver for survey responses
```

## API

Every `/api/*` endpoint has CORS enabled, because the LIFF is always on a different origin than the worker.

| Method | Path | Purpose |
|---|---|---|
| POST | `/webhook` | LINE webhook (HMAC signature is verified first, always) |
| GET | `/api/buildings` · `/api/building?building_id=` | Building data |
| GET | `/api/shops` | Shops and stalls |
| GET | `/api/parking/zones` · `/api/parking/zone?zone_id=` | Parking zones + latest status |
| GET | `/api/parking/status?zone_id=` | Aggregated status for one zone |
| POST | `/api/parking/report` | Submit a report (geofence + rate limit) → grants +10 coins |
| GET | `/api/user?user_id=` | Profile, coin balance, claimed rewards, last 20 ledger entries |
| GET | `/api/user/ledger?user_id=&limit=` | Full coin transaction history |
| POST | `/api/user/feedback` · `/api/user/save-car` | Claim coins (idempotent) |
| GET/POST/DELETE | `/api/schedule` | The user's saved courses |
| GET | `/api/shop/items?user_id=` | Redeemable items + the user's balance |
| POST | `/api/shop/redeem` | Spend coins on an item |
| GET | `/api/shop/redemptions?user_id=` | The user's redemption history |
| POST | `/api/admin/exam-alerts` | Manually trigger exam alerts (requires `x-admin-token`) |

## LIFF deep links

| URL | Opens |
|---|---|
| `?` (no params) | Full map, user picks a destination |
| `?dest_id=ECB` | Map with that building already selected |
| `?mode=parking&zone_id=...` | Map with that parking zone selected |
| `?car=lat,lng` | Navigate to a car location a friend shared |
| `?mode=profile` | Profile + coins + exam schedule |
| `?mode=shop` · `?mode=settings` · `?mode=feedback` | Shop (Coming Soon) / Settings / Survey |

> LINE delivers the real query string inside `?liff.state=`, not directly. `readAppParams()` in
> `app.js` handles this. **Do not read `window.location.search` directly when adding a new deep
> link** — the page will flash the map first before landing on the right view.

## Proactive Exam Alerts

A Cron Trigger runs daily at **11:00 UTC = 18:00 Bangkok** (`[triggers]` in `worker/wrangler.toml`)
and pushes a LINE message to every user who has a saved course with an exam **the next day**.
Evening was chosen because it still leaves time to prepare; a morning-of alert would be too late.
Cloudflare crons are always UTC — there is no timezone setting.

The message lists each course sorted by exam period, with times, plus a link to the profile page.
Exam rooms are not in the university announcement, so the message says so explicitly rather than
guessing. When room data arrives, `formatAlertMessage()` in `worker/src/exam.js` is the only place to change.

Period times (confirmed against the university announcement, Aug 23 2026):
**A = 09:30–12:00/12:30**, **B = 14:00–16:30**. `PERIOD_TIME` in `worker/src/exam.js` must stay in
sync with `EXAM_PERIOD_TIME` in `liff/app.js`. An earlier value of 13:30–16:00 for period B was
wrong — it came from a hardcoded demo table, not the announcement.

### Exam rooms come from the student, via OCR

The university does not publish exam rooms as a dataset — they are assigned per student and released
close to the exam week through e-Service. So users send a photo of their personal exam schedule into
the LINE chat and a vision model reads it (`worker/src/examroom.js`).

**The official timetable validates the OCR.** We already know the exam date and period for all 2,865
courses, so the image is only trusted for the *room*; dates and periods always come from the
announcement. A course code the model misread or invented simply isn't in the dataset and gets
dropped before the user ever sees it.

**Nothing is saved without confirmation.** Results go into `room_import_drafts` (30-minute TTL) and a
Flex card with Save/Cancel buttons. OCR can be wrong, and wrong here means someone walks to the wrong
exam room — the last decision belongs to the student, not the model.

The prompt explicitly forbids extracting names or student IDs, which appear on these schedules. This
project stores no PII anywhere else and that shouldn't change here.

Model choice, measured against a mock RU schedule image on Aug 23 2026 — both a clean render and a
simulated phone photo (1.6° skew, 760px, JPEG q45):

| Model | Correct | Latency |
|---|---|---|
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | **5/5** | **6.9s** — chosen |
| `@cf/google/gemma-4-26b-a4b-it` | 5/5 | 27s — a reasoning model; burns its token budget thinking |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | 4/5 | 4.6s — read `ECO1003` as `EC01003` |
| `@cf/aisingapore/gemma-sea-lion-v4-27b-it` | 1/5 | 11s — invented course codes not in the image |

> Note: the Cloudflare dashboard's "vision" filter lists models by *task category*. Mistral Small 3.1
> and Llama 4 Scout are categorized as Text Generation and don't appear there, but both accept images.

### Delivery guarantees

`exam_alerts_sent` has `UNIQUE (user_id, exam_date, kind)`. A row is claimed **before** the LINE push,
because Cloudflare crons are not exactly-once and the endpoint can be triggered manually too.

On a push failure the claim is rolled back **only when retrying could plausibly work** (5xx or a
network error). A 4xx — typically the user blocked the OA — keeps the row, so we don't retry every
day and burn the LINE message quota on someone who will never receive it.

> ⚠️ **LINE push messages count against the Official Account's monthly quota** (reply messages don't).
> With 200 users across a 14-day exam period this adds up fast — check the OA plan before the beta.

### Triggering it manually

The exam period is Oct 14–28, 2026, which is after demo day, so the cron has nothing to send during
the demo. Use the admin endpoint to show it working:

```bash
# Dry run — returns who would receive what, sends nothing
curl -X POST https://<worker>/api/admin/exam-alerts \
  -H "x-admin-token: $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"date":"2026-10-25","dry_run":true}'

# Actually send — dry_run must be explicitly false
curl -X POST https://<worker>/api/admin/exam-alerts \
  -H "x-admin-token: $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"date":"2026-10-25","dry_run":false}'
```

`ADMIN_TOKEN` lives in `worker/.secrets.env`. Without it the endpoint always returns 401; the cron
still works regardless.

## Setup

Assumes you already have a Cloudflare account and a LINE Developers Console channel.

```bash
cd worker
npm install

# 1. Four KV namespaces — put the returned ids into wrangler.toml
npx wrangler kv namespace create BASELINE_DATA
npx wrangler kv namespace create PARKING_REPORTS
npx wrangler kv namespace create RATE_LIMIT
npx wrangler kv namespace create CHAT_HISTORY_RAM

# 2. D1 — put database_id into wrangler.toml, then create the tables
npx wrangler d1 create ram-roo-thang --location apac
npx wrangler d1 execute ram-roo-thang --remote --file=migrations/0001_users_and_coin_ledger.sql

# 3. Secrets — fill in once; this file is gitignored
cp .secrets.env.example .secrets.env
#    LINE_CHANNEL_SECRET       -> Console, Basic settings tab
#    LINE_CHANNEL_ACCESS_TOKEN -> Console, Messaging API tab (the long-lived one)
#    ADMIN_TOKEN               -> any long random string (guards the manual alert endpoint)

# 4. Seed building/parking data into KV
cd .. && ./scripts/seed-kv.sh

cd worker && npm run deploy
```

For the LIFF: set `LIFF_ID`, `PROD_WORKER_BASE_URL`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_MAP_ID` and
`GOOGLE_MAPS_MAP_ID_2D` at the top of `liff/app.js` (create the LIFF app separately in the LINE
Developers Console).

### Why there are two Map IDs

- `GOOGLE_MAPS_MAP_ID` — used for 3D mode, **unstyled**, because any style removes the 3D buildings
- `GOOGLE_MAPS_MAP_ID_2D` — used for 2D mode, styled to hide Google's own POI labels

Hiding POI labels and showing 3D buildings are mutually exclusive on Google Maps (verified three
times). Hence two Map IDs, swapped when the view mode changes.

## Secrets in production

`worker/.secrets.env` (gitignored) is the source of truth for secrets. `npm run deploy` ships it with
every deployment via `wrangler deploy --secrets-file`, which is additive — it never deletes secrets
you didn't list.

Why they're tied to the deploy: all secrets were once wiped when the worker got overwritten. With the
secret missing, `verifySignature` hashes the literal string `"undefined"`, so every LINE webhook gets
a 401 back — **the bot goes completely silent with no error anywhere**. The webhook now returns 500
with a log naming the missing secret, so this failure mode is no longer invisible.

```bash
cd worker
npm run deploy          # deploy + push secrets (use this normally)
npm run secrets:push    # push secrets only, no code deploy
npm run secrets:check   # list secrets in production — you should see both
npm run tail            # live logs (run in a real terminal, or output gets buffered)
```

## Local development

Two processes, two terminals — the LIFF is static files and needs a backend to call:

```bash
node scripts/dev-api.mjs      # backend -> :8787
cd liff && npm run dev        # static server -> :8123
```

Open **http://localhost:8123/?dev=1&api=http://localhost:8787**

- `dev-api.mjs` runs the **real** `worker/src/index.js` (same router and handlers, nothing mocked),
  swapping KV for in-memory Maps and D1 for `node:sqlite` running the same migration file as
  production — so the UNIQUE constraints that prevent double coin claims are genuinely exercised locally.
- Data is lost when the process exits, and `/webhook` doesn't work here (needs real LINE + Workers AI).
- **Restart `dev-api.mjs` after editing worker code** — there is no hot reload.
- The dev D1 shim runs **every** file in `worker/migrations/` in name order, so new migrations are
  picked up automatically on restart.
- `?dev=1` stubs out the LIFF SDK and fakes a GPS position on campus (add `&lat=&lng=` to simulate
  elsewhere). It **only works on localhost** — on production the parameter is deliberately ignored,
  otherwise anyone could spoof coordinates past the parking geofence from a normal browser.

Test the AI's intent/alias matching: `node test-module1-readiness.mjs` (30 cases, importing the real
functions from `ai.js`).

## Data pipelines

**Map** — edit `data/ru_master.geojson`, then copy it to `liff/data/` as well (that's what the LIFF
serves). If you changed parking zones or shops you also need to re-seed KV; building-only changes
don't require it.

**Exam timetable** — the university publishes a PDF each term:

```bash
python3 scripts/build-exam-schedule.py <file.pdf> -o data/exam-schedule.json
```

The parser reads **coordinates on the page**, not line order, because line order produces wrong data —
some courses have a genuinely empty exam-date cell (e.g. `ACC3255(0)`, a 0-credit course), which makes
every following row inherit another row's exam date for the rest of the page. The "ลำดับที่" (sequence)
column is used as a checksum: it must come out as exactly 1..N with no gaps or duplicates.
**If the checksum fails, do not use the output.**

Then regenerate `exam-lookup.json` (the compact form the LIFF loads) from `exam-schedule.json`.

**Never fabricate exam data.** The old code had a fallback that hashed the course code to invent a
building, room, date and time — so any string you typed produced a confident answer with nothing real
behind it. For an app that walks people to an exam room, that means sending them to the wrong place at
the wrong time. Course codes not present in the timetable are now rejected at input.

## System status

| System | Status | Notes |
|---|---|---|
| Map + in-app navigation | ✅ | 2D/3D, Thai voice guidance, auto re-routing, heading-up rotation |
| Parking | ✅ | 8 zones as polygons, 3-level reports, geofence, aggregation |
| Find My Car | ✅ | Stored in localStorage — lost when switching devices (by design) |
| ruMaster dataset | ✅ | 91 places |
| Exam schedule dataset | ✅ | 2,865 courses with dates + periods; rooms supplied by students via chat photo OCR |
| User database + coins | ✅ | D1 + ledger, double-claim prevention enforced by the database |
| Survey → Google Sheets | ⚠️ | Code is ready but `FEEDBACK_ENDPOINT_URL` is unset, so no responses are collected yet |
| Shop / spending coins | ✅ | One item (LINE sticker, 30 coins). Items live in `shop_items` so pricing can change without a deploy; an admin page is still to come |
| Proactive Exam Alerts (Cron) | ✅ | Day-before push including the exam room when the student has supplied one |
| Community | ❌ | Not started (ADR-0004 kept it out of the MVP) |

### Load test results (Aug 24, 2026)

200 simulated users running the full journey (open app → map data → profile → add 3 courses →
claim feedback coins → shop → redeem) against **production**, 40 concurrent:

| | |
|---|---|
| Requests | 2,200 |
| Failures | **0 (0.00%)** |
| Throughput | 90 req/s |
| Wall time | 24s |

Slowest endpoint was `GET /api/buildings` (p95 1.8s, max 5.7s) — it does ~36 sequential KV reads.
Moving that to a static JSON file, like `exam-lookup.json`, is the obvious next optimization.

For context, the target scenario is 200 users spread over 30 minutes ≈ 0.11 users/sec. This test ran
at 8.2 users/sec — roughly **75× the expected peak** — and still didn't drop a request. D1 writes for
the whole run were ~1,400 rows against a 100,000/day quota.

Reproduce: `node scripts/loadtest.mjs 200 40` (test users are prefixed `LOADTEST_`; delete them from
D1 afterwards).

### Before demo day

- [ ] Set `ADMIN_TOKEN` in `worker/.secrets.env` so the alerts can be demoed manually
- [ ] Check the LINE OA message quota against the expected beta volume
- [ ] Set `FEEDBACK_ENDPOINT_URL` after deploying the Google Apps Script
- [x] Load test — 200 users × 11 requests against production, 0 failures (see below)
- [ ] Seed real parking reports before the event (requires people physically checking in)
- [ ] Prepare a QR code pointing at the LINE OA (not the LIFF directly — users must go through chat first)
