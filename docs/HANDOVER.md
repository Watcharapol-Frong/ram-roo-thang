# Technical Architecture & Handover Specification: Ram Roo Thang (รามรู้ทาง)

**Target Audience:** Software Engineers, System Maintainers, and Contributors
**Project Scope:** Codebase Audit, Operational Handover, and Maintenance Guidelines
**Status:** Production (Active)
**Last verified against production:** 1 September 2026

**Scope of this document.** This is the operational handover: how the system is
deployed, what it costs, and what the incoming maintainer must check first.
`README.md` remains the deeper engineering reference (module layout, API surface,
data model, LIFF deep links). Where the two overlap, the repository configuration
files — `worker/wrangler.toml` and `liff/wrangler.jsonc` — are authoritative.

---

## 1. Executive Summary & Core Positioning

**Ram Roo Thang** is an open student-assistance service for Ramkhamhaeng University.
It bridges local operational gaps by providing tools tailored to campus-specific
workflows that generic navigation apps do not solve:

* **Academic Schedule Mapping:** Visualizing building codes and course sections (`schedule.js`, `myschedule.js`).
* **Exam Room & Building Mapping:** Routing students to specific campus buildings and room assignments (`examroom.js`, `exam.js`).
* **Interactive Campus Cartography:** Web-based map rendered with custom overlays and POIs (`ru_master.geojson`).

---

## 2. Technical Stack & Infrastructure Map (Production Reality)

```
                       +-----------------------------------+
                       |           Client Layer            |
                       |      LINE Official Account /      |
                       |       LIFF Web Application        |
                       +-----------------+-----------------+
                                         |
                       +-----------------+-----------------+
                       |                                   |
              Static Assets Request               API & Webhook Requests
                       |                                   |
                       v                                   v
        +------------------------------+    +------------------------------+
        |   Frontend Static Worker     |    |      Core API Worker         |
        |  (ram-roo-thang-liff)        |    |  (ram-roo-thang-bot)         |
        |  - Serves ./liff static dir  |    |  - LINE Webhook Dispatcher   |
        |  - Google Maps JS API Engine |    |  - Intent Parser & AI Engine |
        +------------------------------+    +--------------+---------------+
                                                           |
                 +-------------------+---------------------+-------------------+
                 |                   |                     |                   |
                 v                   v                     v                   v
        +-----------------+ +-----------------+ +-----------------+ +-----------------+
        |  Cloudflare D1  | |  Cloudflare KV  | |   Workers AI    | | Cloudflare Cron |
        | (ram-roo-thang) | |  (4 Namespaces) | |  (@cf/qwen/*,   | |                 |
        | - 13 Tables     | | - BASELINE_DATA | |   Vision OCR)   | | - 0 0 * * *     |
        | - Quota: 5M/day | | - RATE_LIMIT    | | - Daily Neuron  | |   Daily digest  |
        |   rows read     | | - CHAT_HISTORY  | |   Quota applies | |   (07:00 ICT)   |
        | - 100k/day      | | - PARKING_REP.  | |                 | | - 0 11 * * *    |
        |   rows written  | |   (bound, unused| |                 | |   Exam alerts   |
        |                 | |    - ADR 0005)  | |                 | |   (18:00 ICT)   |
        +-----------------+ +-----------------+ +-----------------+ +-----------------+
```

**Naming caution:** `ram-roo-thang-bot` is the *Worker*; `ram-roo-thang` is the
*D1 database*. They are different resources that differ by one suffix. Use the
Worker name for `wrangler tail` and the Cloudflare dashboard; use the database
name for every `wrangler d1` command.

### Map Engine & External API Costs

* **Current Map Engine:** **Google Maps JavaScript API**, loaded dynamically from `liff/app.js`.
* **Cost Exposure:**
  * The blanket $200/month Google Maps Platform credit no longer exists. Billing is
    now per-SKU with individual free caps.
  * The **Dynamic Maps** SKU allows **10,000 map loads per month** free; beyond that
    it is **$7.00 per 1,000 loads** in the 10,001–100,000 band, with volume discounts
    above that.
  * At ~10,000 loads/month the service is free. One heavy exam week can cross that
    line, so this is the number to watch, not an afterthought.
  * *Verify these figures in the Google Cloud Console billing page before relying on
    them for a budget — Google has changed this pricing model before.*
* **Critical Security Requirement:** The Maps API key in `liff/app.js` is served to
  every visitor (unavoidable for Maps JS API). It **must** be restricted to authorized
  HTTP referrers in the Google Cloud Console. An unrestricted key can be lifted from
  the page source and billed to this account by anyone.
* **Future Migration Target:** Moving map rendering to **MapLibre GL JS** would remove
  the third-party mapping quota entirely. It is a backlog item and is **not** present
  anywhere in the active codebase.

---

## 3. Product-Driven Scope Adjustments

| Module | Action | Product / Technical Rationale |
| --- | --- | --- |
| **Parking Crowdsourcing** (`parking.js`, ADR 0005) | **Preserve code and table** | Not constrained by D1 write quotas — current write volume is roughly five orders of magnitude below the 100k rows/day limit. The real constraint is **cold-start data freshness**: at low DAU, infrequent reports produce stale status badges. Keep the code and `parking_reports` table; revisit the UI if report frequency stays low. **No environment toggle exists today** — see "Proposed work" below. |
| **Shop & Coin Ledger** (`shop.js`, `0004_shop.sql`) | **Disabled (already configured)** | Reward fulfillment requires active administrative operations. Currently off via `SHOP_ENABLED = false` in `liff/app.js` and `shop_items.active = 0` in D1. No code change needed. |
| **Workers AI Inference** (`ai.js`, `examroom.js`) | **Constrained / Monitored** | Chat (`@cf/qwen/qwen3-30b-a3b-fp8`) and exam-schedule image OCR consume Cloudflare Workers AI daily Neuron allocation. This is the tightest free-tier bottleneck in the system and must be watched during exam spikes. |
| **Exam & Class Lookup** (`exam.js`, `examroom.js`, `schedule.js`) | **Core Priority** | Provides building- and room-level lookups that Google Maps does not index. Clarification: the dataset covers building and room assignments, **not** individual seat numbers. |

### Proposed work (not yet implemented)

* **Parking feature flag.** The table above recommends being able to switch parking
  reporting off without a code change. There is currently **no** such environment
  variable in `worker/` or `liff/`. The nearest existing pattern is the
  `SHOP_ENABLED` constant in `liff/app.js` — a build-time constant, not an env var.
  Whoever implements this should decide deliberately between the two approaches
  rather than assume a flag already exists.

---

## 4. Deployment, Database & Operations Runbook

### 4.1. Secrets (read this before the first deploy)

Three secrets must exist on the Core API Worker: `LINE_CHANNEL_SECRET`,
`LINE_CHANNEL_ACCESS_TOKEN`, and `ADMIN_TOKEN`.

`worker/.secrets.env` is gitignored and will **not** be in a fresh clone. Copy the
template and fill it in once:

```bash
cd worker
cp .secrets.env.example .secrets.env
# then fill in the values — see the comments in that file for where each one lives
```

**Why this matters.** The bot once went completely silent because the secrets were
missing from Cloudflare: `verifySignature` HMAC'd the literal string `"undefined"`,
so every LINE webhook returned 401. The `deploy` script now re-uploads the secrets
on every deploy, so if they are ever wiped again the next deploy restores them.
That safety net only works if you deploy with `npm run deploy` (§4.3).

### 4.2. Database Maintenance (`ram-roo-thang`)

Migrations are executed directly against the remote database. Do **not** use
`wrangler d1 migrations apply` — this project has never used it, so the
`d1_migrations` tracking table does not exist and wrangler would attempt to re-run
all migrations from scratch.

Run these from the `worker/` directory (the `--file` paths are relative to it):

```bash
cd worker

# Apply a specific migration or seed script to production D1
npx wrangler d1 execute ram-roo-thang --remote --file=./migrations/0011_parking_reports.sql

# Query production directly for an audit
npx wrangler d1 execute ram-roo-thang --remote --command="SELECT COUNT(*) FROM users;"
```

Always run the migration **before** deploying the code that depends on it. A
migration applied against a not-yet-deployed Worker changes nothing user-visible,
which makes it the safe ordering.

### 4.3. Deploying the Backend API & Cron Triggers

```bash
cd worker
npm install
npm run deploy
```

**Use `npm run deploy`, not `npx wrangler deploy`.** The npm script is
`wrangler deploy --secrets-file .secrets.env`, which re-uploads the secrets described
in §4.1 as part of every deploy. Plain `npx wrangler deploy` is defined separately in
`package.json` as `deploy:no-secrets` and skips that step — it will not delete
existing secrets, but it removes the mechanism that recovers them if they ever
disappear.

### 4.4. Deploying the Frontend (Worker Static Assets)

The frontend in `liff/` is hosted as a Cloudflare Worker with static asset routing
(`liff/wrangler.jsonc`) — it is **not** a Cloudflare Pages project.

```bash
cd liff
npm install       # liff/node_modules is not checked in; wrangler is a devDependency
npx wrangler deploy
```

Alternatively, deploy it using the Worker directory's already-installed toolchain:

```bash
cd worker
npx wrangler deploy --config ../liff/wrangler.jsonc
```

**Keep `data/ru_master.geojson` in sync.** The map dataset exists in two places —
`data/ru_master.geojson` and `liff/data/ru_master.geojson`. They must stay identical;
they have silently drifted before. Verify with `cmp` before deploying:

```bash
cmp data/ru_master.geojson liff/data/ru_master.geojson && echo "in sync"
```

---

## 5. Immediate Operational Checklist for Incoming Dev

1. **Google Cloud Console:** Verify HTTP referrer restrictions on the Maps API key
   in `liff/app.js`, and confirm the current Dynamic Maps free cap and unit price
   (§2) against the live billing page.
2. **Secrets:** Create `worker/.secrets.env` from the template (§4.1) and confirm
   with `npm run secrets:check` that all three secrets exist on the Worker.
3. **Workers AI Monitoring:** Watch daily Neuron consumption around exam-schedule
   publication periods — the tightest free-tier limit in the stack.
4. **Parking Feature Decision:** Retain the `parking_reports` table and API
   endpoints. Monitor report frequency to decide whether a cold-start warning in
   the UI is warranted, and whether the feature flag under "Proposed work" (§3) is
   worth building.
5. **Health Check:** `GET /api/health?deep=1` on the Core API Worker exercises
   config, D1, KV, Workers AI, exam alerts, and the LINE API in one request. Run it
   after every deploy.
