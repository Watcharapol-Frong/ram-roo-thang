# รามรู้ทาง (RAM-ROO-THANG) — MVP

โครงสร้าง project สำหรับเริ่มงานตาม `MVP-SPEC-for-Dev.md`

## เอกสารต้องอ่านก่อนเริ่ม (เรียงตามลำดับ)
1. `CONTEXT.md` — นิยามศัพท์ (MVP vs Full Vision, ห้ามสับสน)
2. `MVP-SPEC-for-Dev.md` — สเปกเต็ม รวม Out of Scope
3. `docs/adr/` — เหตุผลของการตัดสินใจสำคัญ 2 เรื่อง (function calling แทน MCP, crowdsourced parking)

## โครงสร้าง Project

```
ram-roo-thang/
├── CONTEXT.md
├── MVP-SPEC-for-Dev.md
├── docs/adr/                  — เหตุผลการตัดสินใจ (0001-0003)
├── worker/                    — Cloudflare Worker (backend ทั้งหมด)
│   ├── wrangler.toml
│   └── src/
│       ├── index.js           — router หลัก (LINE webhook + API endpoints)
│       ├── line.js            — LINE webhook: signature verify, chat history, reply
│       ├── ai.js               — Workers AI + MCP-inspired context retrieval (มี fallback ที่ยังใช้ context ได้แม้ AI timeout)
│       ├── data.js             — KV access: baseline data, parking, geofence, rate limit, exam schedule
│       ├── parking.js          — POST /api/parking/report, GET /api/parking/status
│       ├── building.js         — GET /api/building, GET /api/buildings
│       ├── schedule.js         — POST/GET/DELETE /api/schedule (ไม่มี PII — ADR-0003)
│       └── utils.js            — Haversine distance
├── liff/                      — หน้า LIFF (map / parking report / profile view)
│   ├── package.json           — npm run dev (localhost:8123) / dev:wrangler / deploy
│   ├── wrangler.jsonc         — deploy เป็น static assets (คนละ Worker กับ backend)
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── components/            — RouteCalculator (Directions API), SheetManager (bottom sheet)
├── data/
│   └── baseline-dataset.json  — ข้อมูลอาคาร/ลานจอดตั้งต้น (ต้องเพิ่มให้ครบตาม Phase 1)
└── scripts/
    ├── seed-kv.sh             — สคริปต์ seed baseline dataset เข้า KV
    ├── serve-liff.mjs         — static server สำหรับพัฒนา LIFF บน localhost (zero dependency)
    └── dev-api.mjs            — backend สำหรับ dev: worker จริง + KV ในหน่วยความจำ (zero dependency)
```

## ส่วนเสริมนอกสเปกเดิม

ระหว่างเขียนโครงเจอช่องว่างที่ MVP-SPEC ฉบับแรกไม่ได้ระบุไว้ (ไม่ใช่ scope creep แต่เป็น plumbing/reliability ที่ขาดไม่ได้):

- **`GET /api/building?building_id=`** และ **`GET /api/buildings`** — LIFF อ่าน Cloudflare KV ตรงๆ จาก browser ไม่ได้ ต้องมี endpoint คืนพิกัด/ลิสต์อาคารให้ client ใช้ (อัปเดตใน spec section 6.3-6.4 แล้ว)
- **แก้ bug ใน `ai.js`** — เดิมถ้า Workers AI timeout ระบบจะทิ้ง context (ตึกที่หาเจอแล้ว) ทำให้ nav ใช้งานไม่ได้แม้หาตึกเจอ ตอนนี้ fallback ยังคืน context เดิมได้ (สำคัญมากสำหรับงานถ่ายทอดสด — ดู ADR ที่เกี่ยวข้อง)
- **Schedule intent ข้าม AI ไปเลย** — ลดจุดเสี่ยง timeout สำหรับฟีเจอร์ที่ไม่จำเป็นต้องใช้ NLU เลย

## เริ่มงาน (Setup)

```bash
cd worker
npm install
npx wrangler kv namespace create CHAT_HISTORY_RAM
npx wrangler kv namespace create BASELINE_DATA
npx wrangler kv namespace create PARKING_REPORTS
npx wrangler kv namespace create RATE_LIMIT
npx wrangler kv namespace create STUDENT_SCHEDULES
# เอา id ที่ได้ไปแทนที่ REPLACE_ME ใน wrangler.toml

npx wrangler d1 create ram-roo-thang --location apac
# เอา database_id ที่ได้ไปใส่ใน wrangler.toml แล้วสร้างตาราง:
npx wrangler d1 execute ram-roo-thang --remote --file=migrations/0001_users_and_coin_ledger.sql

cp .secrets.env.example .secrets.env
# ใส่ค่า LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN ลงใน .secrets.env (ครั้งเดียว)
# ไฟล์นี้ถูก gitignore ไว้ — `npm run deploy` จะยิงขึ้น production ให้เองทุกครั้ง

cd ..
./scripts/seed-kv.sh   # ⚠️ เช็ค syntax กับ wrangler version ก่อนรัน

cd worker
npm run dev
```

### ข้อมูลอยู่ที่ไหน

| ที่เก็บ | เก็บอะไร | ทำไม |
|---|---|---|
| D1 `ram-roo-thang` | users, coin_ledger, user_courses | ต้องมี transaction ตอนบวก/หักเหรียญ และต้อง query/รวมยอดได้ |
| KV `BASELINE_DATA` | อาคาร ลานจอด ร้านค้า | อ่านอย่างเดียว แทบไม่เปลี่ยน |
| KV `PARKING_REPORTS` | รายงานสภาพที่จอด | ต้องหมดอายุเอง ใช้ TTL ของ KV |
| KV `RATE_LIMIT` | เวลารายงานล่าสุดของแต่ละคน | เหมือนกัน ใช้ TTL |
| KV `CHAT_HISTORY_RAM` | ประวัติแชทกับบอท | เหมือนกัน ใช้ TTL |
| ไฟล์ static | `ru_master.geojson`, `exam-lookup.json` | ข้อมูลนิ่ง ไม่ต้องผ่าน KV ให้เปลืองโควตาอ่าน |

D1 ไม่มี TTL — อะไรที่ควรหายเองอย่าย้ายมา

ยอดเหรียญ: `coin_ledger` คือความจริง ส่วน `users.coins` เป็นยอดสรุปที่เขียนใน batch เดียวกันเสมอ
การกันรับเหรียญซ้ำใช้ `UNIQUE (user_id, reason, ref_id)` ให้ฐานข้อมูลปฏิเสธเอง ไม่ได้เขียน if เช็คในโค้ด

### Secrets บน production

`worker/.secrets.env` (gitignore ไว้) เป็นแหล่งความจริงของ secrets ทั้งหมด — `npm run deploy` ส่งไฟล์นี้ไปกับทุก
deployment ผ่าน `wrangler deploy --secrets-file` ซึ่งทำงานแบบ additive (ไม่ลบตัวที่ไม่ได้ระบุ)

เหตุผล: เคยเจอ secrets บน Cloudflare หายทั้งชุดมาแล้ว (22 ส.ค. 2026 — version 14:54 ไม่มี secret แล้ว
ทั้งที่ version 13:55 ยังมีครบ ตรงกับช่วงที่ Workers Builds จาก GitHub เขียนทับ worker ตัวนี้) พอ secret หาย
`verifySignature` จะเอาสตริง `"undefined"` ไปทำ HMAC ทำให้ทุก webhook จาก LINE ถูกตอบ 401 — บอทเงียบสนิท
โดยไม่มี error ให้เห็น การผูก secrets ไว้กับ deploy ทำให้อาการนี้กู้คืนเองในการ deploy ครั้งถัดไป

```bash
cd worker
npm run deploy          # deploy + ยิง secrets ขึ้นไปด้วย (ใช้ตัวนี้เป็นปกติ)
npm run secrets:push    # ยิงเฉพาะ secrets ไม่ deploy โค้ด
npm run secrets:check   # ดูว่าบน production มี secret อะไรอยู่บ้าง — ต้องเห็นครบ 2 ตัว
```

LIFF: แก้ `LIFF_ID`, `WORKER_BASE_URL`, `GOOGLE_MAPS_API_KEY` ใน `liff/app.js` ก่อน deploy (สร้าง LIFF app ผ่าน LINE Developers Console แยกต่างหาก ไม่ได้รวมอยู่ในโค้ดนี้)

### พัฒนา LIFF บนเครื่องตัวเอง

ต้องรัน 2 โปรเซส (คนละเทอร์มินัล) — LIFF เป็นแค่ static file ต้องมี backend ให้เรียก:

```bash
node scripts/dev-api.mjs      # backend: worker จริง + KV ในหน่วยความจำ -> :8787
cd liff && npm run dev        # static server (ไม่ต้อง npm install)     -> :8123
```

แล้วเปิด **http://localhost:8123/?dev=1&api=http://localhost:8787**

- `scripts/dev-api.mjs` รัน `worker/src/index.js` ตัวจริง (router/handler เดิมทั้งหมด) โดยสลับ KV เป็น Map ในหน่วยความจำที่ seed จาก `data/baseline-dataset.json` — ลองกดได้ครบทุก flow โดยไม่แตะ KV ของ production และไม่ต้องมีบัญชี Cloudflare (ข้อมูลหายเมื่อปิดโปรเซส, `/webhook` ใช้ที่นี่ไม่ได้เพราะต้องมี LINE + Workers AI)
- `?api=` ใช้ได้เฉพาะใน dev mode (localhost) เท่านั้น — บน production ปลายทาง API ล็อกไว้เสมอ
- ถ้าอยากเสิร์ฟ LIFF ผ่าน workerd จริงตาม `wrangler.jsonc`: `cd liff && npm install && npm run dev:wrangler`

`?dev=1` จะ stub LIFF SDK ทิ้งและจำลองพิกัด GPS ให้อยู่ในแคมปัส (เติม `&lat=&lng=` เพื่อจำลองตำแหน่งอื่น เช่น นอกแคมปัส) — **ทำงานเฉพาะ localhost เท่านั้น** บน production พารามิเตอร์นี้ไม่มีผลใดๆ โดยตั้งใจ (ไม่งั้นใครก็ปลอมพิกัดผ่าน geofence ของการรายงานลานจอดได้จากเบราว์เซอร์ธรรมดา)

## ยังไม่ได้ทำ / ต้องทำต่อ

- [ ] เพิ่มพิกัดอาคาร/ลานจอดจริงให้ครบใน `data/baseline-dataset.json` (Phase 1 ตามแผน)
- [ ] ทดสอบ `retrieveContext` ใน `ai.js` — ตอนนี้ match building ด้วย keyword ง่ายๆ ยังไม่ได้ทดสอบกับคำถามหลากหลายรูปแบบ
- [ ] ทดสอบ Workers AI function calling / prompt จริงบน `@cf/qwen/qwen3-30b-a3b-fp8` — ยังไม่ได้รันจริง
- [ ] ตรวจสอบ `wrangler kv key put` syntax ใน `scripts/seed-kv.sh` ให้ตรงกับ wrangler version ที่ใช้
- [ ] วางแผน seed ข้อมูล parking check-in จริงก่อนวันเดโม (คนละเรื่องกับโค้ด — ต้องมีคนเดินไปเช็คอินจริง)
- [ ] สร้าง LIFF app จริงผ่าน LINE Developers Console แล้วใส่ค่าใน `liff/app.js`
- [ ] **โหลดทดสอบจริงกับคน 100-200 คนพร้อมกันก่อนวันงาน** (ยืมเพื่อน/คนรู้จักช่วยยิง request พร้อมกัน) — infra (Workers/KV/Maps Embed) รองรับตามทฤษฎี แต่ยังไม่เคยทดสอบโหลดจริงเลย
- [ ] ทดสอบ flow ผ่านแชท AI แบบเห็นผลจริงว่า timeout fallback ทำงานถูกต้อง (ลองปิด/หน่วง AI response ทดสอบ)
- [ ] เตรียม QR code ที่ชี้ไปหา LINE OA (ไม่ใช่ LIFF ตรงๆ เพราะ Q2 confirmed ว่าต้องผ่านแชทก่อน)

**ห้ามทำ**: อะไรก็ตามใน section 9 (Out of Scope) ของ `MVP-SPEC-for-Dev.md` โดยไม่คุยกันก่อน
