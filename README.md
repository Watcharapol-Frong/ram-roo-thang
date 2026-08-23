# รามรู้ทาง (RAM-ROO-THANG)

LINE bot + LIFF สำหรับนำทางในมหาวิทยาลัยรามคำแหง — ค้นหาอาคาร นำทางแบบเลี้ยวต่อเลี้ยว
ดูสภาพลานจอดรถแบบ crowdsourced จำตำแหน่งรถ และดูวันเวลาสอบของวิชาที่บันทึกไว้

> **สถานะ**: อยู่ระหว่างพัฒนาเพื่อ RU Innovation 2026 (demo 1 ก.ย. 2026)
> ดู [สถานะรายระบบ](#สถานะรายระบบ) ท้ายไฟล์ว่าอะไรเสร็จแล้ว อะไรยังไม่ได้ทำ

## เอกสารที่ต้องอ่านก่อนเริ่ม

1. `CONTEXT.md` — นิยามศัพท์ (MVP vs Full Vision ห้ามสับสน)
2. `MVP-SPEC-for-Dev.md` — สเปกเต็ม รวม section 9 Out of Scope
3. `docs/adr/` — เหตุผลของการตัดสินใจสำคัญ 4 เรื่อง

**ห้ามทำ**: อะไรก็ตามใน section 9 (Out of Scope) ของ `MVP-SPEC-for-Dev.md` โดยไม่คุยกันก่อน

## สถาปัตยกรรม

ระบบเป็น Cloudflare Worker **สองตัวแยกกัน** deploy คนละคำสั่ง อย่าสับสน:

| Worker | ทำอะไร | config | deploy |
|---|---|---|---|
| `ram-roo-thang-bot` | backend ทั้งหมด — LINE webhook + `/api/*` | `worker/wrangler.toml` | `cd worker && npm run deploy` |
| `ram-roo-thang-liff` | static assets ของหน้า LIFF | `liff/wrangler.jsonc` | `npx wrangler deploy --config liff/wrangler.jsonc` |

> ⚠️ **อย่าเชื่อมต่อ GitHub integration / Workers Builds กับ repo นี้** — เคยทำให้ static assets ถูก
> deploy ทับ API worker ทุกครั้งที่ push จนบอทล่ม และล้าง secrets ทิ้งทั้งชุด (22 ส.ค. 2026)
> deploy ด้วยมือผ่าน wrangler พร้อม `--config` ที่ระบุชัดเสมอ

## ข้อมูลอยู่ที่ไหน

| ที่เก็บ | เก็บอะไร | ทำไมอยู่ที่นี่ |
|---|---|---|
| **D1** `ram-roo-thang` | `users`, `coin_ledger`, `user_courses` | ต้องมี transaction ตอนบวก/หักเหรียญ และต้อง query/รวมยอดได้ |
| **KV** `BASELINE_DATA` | อาคาร 35 / ลานจอด 8 / บริการ 11 / ร้านค้า 25 | อ่านอย่างเดียว แทบไม่เปลี่ยน |
| **KV** `PARKING_REPORTS` | รายงานสภาพลานจอด | ต้องหมดอายุเอง — ใช้ TTL ของ KV |
| **KV** `RATE_LIMIT` | เวลารายงานล่าสุดของแต่ละคน | เหมือนกัน ใช้ TTL |
| **KV** `CHAT_HISTORY_RAM` | ประวัติแชทกับบอท | เหมือนกัน ใช้ TTL |
| **ไฟล์ static** | `ru_master.geojson` (91 จุด), `exam-lookup.json` (2,865 วิชา) | ข้อมูลนิ่ง เสิร์ฟตรงจาก LIFF ไม่เปลืองโควตาอ่านของ KV |

**D1 ไม่มี TTL** — อะไรที่ควรหายเองอย่าย้ายมา

### ทำไมข้อมูลผู้ใช้ถึงอยู่บน D1 ไม่ใช่ KV

1. KV ไม่มี atomic increment — บวก/หักเหรียญเป็น read-modify-write ยอดหายได้ถ้ายิงพร้อมกัน
2. KV query ไม่ได้เลย จึงทำ ledger (เรียงเวลา/กรองตามคน/รวมยอด) ไม่ได้
3. โควตาเขียน free tier: KV 1,000 แถว/วัน ส่วน D1 100,000 แถว/วัน — beta 200 คนประเมินไว้ ~2,200 writes/วัน

D1 สร้างที่ภูมิภาค **APAC** เพราะเขียนที่ primary ที่เดียว ถ้าไปตกอเมริกา write จากไทยจะช้าเห็นได้ชัด

### กติกาเหรียญ

| การกระทำ | เหรียญ | กันรับซ้ำด้วย |
|---|---|---|
| รายงานสภาพลานจอด | +10 | geofence 150 ม. + rate limit 30 นาที |
| ทำแบบประเมิน | +30 | ครั้งเดียวตลอดชีพ |
| บันทึกตำแหน่งรถ | +5 | วันละครั้ง (วันที่ตามเวลาไทย ไม่ใช่ UTC) |

แก้ตัวเลขที่ `COIN_REWARDS` ใน `worker/src/user.js` ที่เดียว

**`coin_ledger` คือความจริง** ส่วน `users.coins` เป็นยอดสรุปที่เขียนใน `batch` เดียวกันเสมอ (ทรานแซกชันเดียว)
ถ้าสองอันไม่ตรงกันให้เชื่อ ledger แล้วเรียก `recalculateBalance()`

การกันรับซ้ำใช้ **`UNIQUE (user_id, reason, ref_id)`** ให้ฐานข้อมูลปฏิเสธเอง ไม่ได้เขียน `if` เช็คในโค้ด:

| reason | ref_id | ผล |
|---|---|---|
| `FEEDBACK` | `once` | ครั้งเดียวตลอดชีพ |
| `SAVE_CAR` | `2026-08-23` | วันละครั้ง |
| `PARKING_REPORT` | เวลาที่รายงาน | 1 รายงาน = 1 ครั้ง |
| `SHOP_REDEEM` | id การแลก | (จองไว้ ยังไม่มีฝั่ง shop) |

## โครงสร้าง Project

```
ram-roo-thang-bot/
├── CONTEXT.md                     — นิยามศัพท์
├── MVP-SPEC-for-Dev.md            — สเปกเต็ม
├── docs/adr/                      — เหตุผลการตัดสินใจ (0001-0004)
│
├── worker/                        — API Worker (backend ทั้งหมด)
│   ├── wrangler.toml              — bindings: 4 KV + D1 + Workers AI
│   ├── .secrets.env.example       — คัดลอกเป็น .secrets.env แล้วใส่ token
│   ├── migrations/
│   │   └── 0001_users_and_coin_ledger.sql
│   └── src/
│       ├── index.js               — router (LINE webhook + /api/*) + CORS
│       ├── line.js                — signature verify, chat history, Flex Message, reply
│       ├── ai.js                  — Workers AI + alias matching (timeout 5 วิ พร้อม fallback)
│       ├── data.js                — KV access
│       ├── user.js                — ผู้ใช้ + เหรียญ + ledger (D1)
│       ├── schedule.js            — วิชาที่ผู้ใช้บันทึก (D1)
│       ├── parking.js             — รายงานลานจอด geofence + rate limit + aggregation
│       ├── building.js            — ข้อมูลอาคาร
│       ├── shop.js                — ลิสต์ร้านค้า/ซุ้ม
│       └── utils.js               — Haversine
│
├── liff/                          — หน้า LIFF (static ไม่มี build step)
│   ├── wrangler.jsonc
│   ├── index.html                 — โหลด LIFF SDK + components + app.js
│   ├── app.js                     — ทุก view, แผนที่, นำทาง, โปรไฟล์ (~3,000 บรรทัด)
│   ├── style.css
│   ├── components/
│   │   ├── RouteCalculator.js     — Google Directions API + เส้นประเชื่อมหมุด
│   │   ├── NavigationController.js— นำทางสด: ติดตามระยะ, เสียงพูด, คำนวณเส้นใหม่เมื่อออกนอกเส้น
│   │   └── SheetManager.js        — bottom sheet ทุกแบบ
│   └── data/                      — สำเนาไฟล์ static ที่เสิร์ฟให้ browser
│
├── data/                          — แหล่งความจริงของข้อมูล
│   ├── baseline-dataset.json      — ข้อมูลที่ seed เข้า KV
│   ├── ru_master.geojson           — 91 จุดบนแผนที่ (อาคาร 51 / จอดรถ 8 / ร้านค้า 25 / อื่นๆ 7)
│   ├── exam-schedule.json          — ตารางสอบเต็ม 2,865 วิชา (ผลจาก parser)
│   ├── exam-lookup.json            — รูปแบบกะทัดรัดที่ LIFF ใช้จริง (~10 KB หลัง gzip)
│   └── 20260302_exam_169.pdf       — ประกาศตารางสอบต้นฉบับ 111 หน้า
│
└── scripts/
    ├── dev-api.mjs                — backend สำหรับ dev (worker จริง + KV/D1 ในหน่วยความจำ)
    ├── serve-liff.mjs             — static server สำหรับ dev
    ├── seed-kv.sh                 — seed baseline-dataset.json เข้า KV (ต้องมี jq)
    ├── build-exam-schedule.py     — แปลง PDF ตารางสอบ -> JSON (ต้องมี pypdf)
    └── google-sheets-apps-script.js— โค้ดฝั่ง Google Sheets สำหรับรับผลแบบประเมิน
```

## API

ทุก endpoint ใต้ `/api/` มี CORS เปิดไว้ เพราะ LIFF อยู่คนละ origin กับ worker เสมอ

| Method | Path | ทำอะไร |
|---|---|---|
| POST | `/webhook` | LINE webhook (ตรวจ HMAC signature ก่อนเสมอ) |
| GET | `/api/buildings` · `/api/building?building_id=` | ข้อมูลอาคาร |
| GET | `/api/shops` | ร้านค้า/ซุ้ม |
| GET | `/api/parking/zones` · `/api/parking/zone?zone_id=` | ลานจอด + สถานะล่าสุด |
| GET | `/api/parking/status?zone_id=` | สถานะรวมของลานเดียว |
| POST | `/api/parking/report` | รายงานสภาพ (geofence + rate limit) → ได้ +10 เหรียญ |
| GET | `/api/user?user_id=` | โปรไฟล์ + ยอดเหรียญ + สิทธิ์ที่รับแล้ว + 20 รายการล่าสุด |
| GET | `/api/user/ledger?user_id=&limit=` | รายการเข้า-ออกของเหรียญ |
| POST | `/api/user/feedback` · `/api/user/save-car` | รับเหรียญ (idempotent) |
| GET/POST/DELETE | `/api/schedule` | วิชาที่ผู้ใช้บันทึก |

## LIFF deep links

| URL | ไปหน้าไหน |
|---|---|
| `?` (ไม่มี param) | แผนที่รวม เลือกจุดหมายเอง |
| `?dest_id=ECB` | แผนที่ + เลือกอาคารนั้นให้เลย |
| `?mode=parking&zone_id=...` | แผนที่ + เลือกลานจอดนั้น |
| `?car=lat,lng` | นำทางไปหารถที่เพื่อนแชร์มา |
| `?mode=profile` | โปรไฟล์ + เหรียญ + ตารางสอบ |
| `?mode=shop` · `?mode=settings` · `?mode=feedback` | ร้านค้า (Coming Soon) / ตั้งค่า / แบบประเมิน |

> LINE ส่ง query string จริงมาใน `?liff.state=` ไม่ได้ส่งตรงๆ — `readAppParams()` ใน `app.js`
> จัดการให้แล้ว **อย่าอ่าน `window.location.search` ตรงๆ เวลาทำ deep link ใหม่** ไม่งั้นหน้าจะแวบไปที่แผนที่ก่อน

## เริ่มงาน (Setup)

ต้องมีบัญชี Cloudflare และ LINE Developers Console แล้ว

```bash
cd worker
npm install

# 1. KV 4 ตัว — เอา id ที่ได้ไปใส่ wrangler.toml
npx wrangler kv namespace create BASELINE_DATA
npx wrangler kv namespace create PARKING_REPORTS
npx wrangler kv namespace create RATE_LIMIT
npx wrangler kv namespace create CHAT_HISTORY_RAM

# 2. D1 — เอา database_id ไปใส่ wrangler.toml แล้วสร้างตาราง
npx wrangler d1 create ram-roo-thang --location apac
npx wrangler d1 execute ram-roo-thang --remote --file=migrations/0001_users_and_coin_ledger.sql

# 3. secrets — ใส่ครั้งเดียว ไฟล์นี้ถูก gitignore ไว้
cp .secrets.env.example .secrets.env
#    LINE_CHANNEL_SECRET       -> Console แท็บ Basic settings
#    LINE_CHANNEL_ACCESS_TOKEN -> Console แท็บ Messaging API (ตัว long-lived)

# 4. seed ข้อมูลอาคาร/ลานจอดเข้า KV
cd .. && ./scripts/seed-kv.sh

cd worker && npm run deploy
```

ฝั่ง LIFF: แก้ `LIFF_ID`, `PROD_WORKER_BASE_URL`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_MAP_ID`,
`GOOGLE_MAPS_MAP_ID_2D` ที่ต้นไฟล์ `liff/app.js` (สร้าง LIFF app ผ่าน LINE Developers Console แยกต่างหาก)

### เรื่อง Map ID สองตัว

- `GOOGLE_MAPS_MAP_ID` — โหมด 3D ไม่ใส่ style เพราะ style ทำให้ตึก 3D หายไป
- `GOOGLE_MAPS_MAP_ID_2D` — โหมด 2D ใส่ style ซ่อน POI ของ Google ไว้

การซ่อนป้าย POI กับการแสดงตึก 3D ใช้ร่วมกันไม่ได้บน Google Maps (ทดสอบยืนยันแล้ว 3 รอบ)
จึงต้องแยก Map ID สองตัวและสลับตอนเปลี่ยนโหมด

## Secrets บน production

`worker/.secrets.env` (gitignore ไว้) เป็นแหล่งความจริงของ secrets — `npm run deploy` ส่งไฟล์นี้ไปกับทุก
deployment ผ่าน `wrangler deploy --secrets-file` ซึ่งทำงานแบบ additive (ไม่ลบตัวที่ไม่ได้ระบุ)

เหตุผลที่ต้องผูกไว้กับ deploy: เคยเจอ secrets หายทั้งชุดตอน worker ถูกเขียนทับ พอ secret หาย
`verifySignature` จะเอาสตริง `"undefined"` ไปทำ HMAC ทุก webhook จาก LINE จึงได้ 401 กลับไป
**บอทเงียบสนิทโดยไม่มี error ให้เห็น** ตอนนี้ webhook แยกเคสนี้เป็น 500 พร้อม log บอกชื่อ secret ที่ขาดแล้ว

```bash
cd worker
npm run deploy          # deploy + ยิง secrets ขึ้นไปด้วย (ใช้ตัวนี้เป็นปกติ)
npm run secrets:push    # ยิงเฉพาะ secrets ไม่ deploy โค้ด
npm run secrets:check   # ดูว่าบน production มี secret อะไรบ้าง — ต้องเห็นครบ 2 ตัว
npm run tail            # ดู log สด (รันในเทอร์มินัลจริง ไม่งั้น output จะถูก buffer)
```

## พัฒนาบนเครื่องตัวเอง

ต้องรัน 2 โปรเซส คนละเทอร์มินัล — LIFF เป็นแค่ static file ต้องมี backend ให้เรียก:

```bash
node scripts/dev-api.mjs      # backend -> :8787
cd liff && npm run dev        # static server -> :8123
```

เปิด **http://localhost:8123/?dev=1&api=http://localhost:8787**

- `dev-api.mjs` รัน `worker/src/index.js` **ตัวจริง** (router/handler เดิมทั้งหมด ไม่ได้เขียน mock)
  โดยสลับ KV เป็น Map ในหน่วยความจำ และสลับ D1 เป็น `node:sqlite` ที่รัน migration ไฟล์เดียวกับ production
  — UNIQUE constraint ที่ใช้กันรับเหรียญซ้ำจึงถูกทดสอบจริงตั้งแต่ในเครื่อง
- ข้อมูลหายเมื่อปิดโปรเซส และ `/webhook` ใช้ที่นี่ไม่ได้ (ต้องมี LINE + Workers AI จริง)
- **แก้โค้ด worker แล้วต้องรีสตาร์ท `dev-api.mjs`** ไม่มี hot reload
- `?dev=1` จะ stub LIFF SDK ทิ้งและจำลอง GPS ให้อยู่ในแคมปัส (เติม `&lat=&lng=` เพื่อจำลองตำแหน่งอื่น)
  **ทำงานเฉพาะ localhost** บน production พารามิเตอร์นี้ไม่มีผลโดยตั้งใจ ไม่งั้นใครก็ปลอมพิกัดผ่าน geofence ได้

ทดสอบ intent/alias matching ของ AI: `node test-module1-readiness.mjs` (30 เคส import ฟังก์ชันจริงจาก `ai.js`)

## Data pipeline

**แผนที่** — แก้ `data/ru_master.geojson` แล้วคัดลอกไป `liff/data/` ด้วย (LIFF เสิร์ฟจากที่นั่น)
ถ้าแก้ลานจอด/ร้านค้า ต้อง seed KV ใหม่ด้วย ถ้าแก้แค่อาคารไม่ต้อง

**ตารางสอบ** — มหาวิทยาลัยประกาศเป็น PDF ทุกภาค:

```bash
python3 scripts/build-exam-schedule.py <ไฟล์.pdf> -o data/exam-schedule.json
```

parser อ่านจาก **พิกัดบนหน้ากระดาษ** ไม่ใช่ลำดับบรรทัด เพราะลำดับบรรทัดให้ผลผิด — มีวิชาที่ช่องวันสอบ
ว่างจริง (เช่น `ACC3255(0)` วิชา 0 หน่วยกิต) ทำให้แถวถัดไปรับวันสอบของแถวอื่นมาทั้งหน้า
ใช้คอลัมน์ "ลำดับที่" เป็น checksum ว่าต้องได้ 1..N ครบเรียงไม่ขาดไม่ซ้ำ **ถ้า checksum ไม่ผ่านห้ามใช้ผลลัพธ์**

แล้วสร้าง `exam-lookup.json` (รูปแบบกะทัดรัดที่ LIFF โหลด) จาก `exam-schedule.json` อีกที

**ห้ามแต่งข้อมูลสอบขึ้นมาเอง** — โค้ดเดิมเคยมี fallback ที่ hash รหัสวิชาแล้วสุ่มอาคาร/ห้อง/วัน/เวลาออกมา
พิมพ์รหัสอะไรลงไปก็ได้คำตอบเสมอทั้งที่ไม่มีข้อมูลจริง สำหรับแอปที่พาคนไปห้องสอบแปลว่าไปผิดที่ผิดเวลา
ตอนนี้รหัสที่ไม่มีในตารางจะถูกปฏิเสธตั้งแต่ตอนกดเพิ่ม

## สถานะรายระบบ

| ระบบ | สถานะ | หมายเหตุ |
|---|---|---|
| แผนที่ + นำทางในแอป | ✅ | 2D/3D, เสียงพูดไทย, คำนวณเส้นใหม่เมื่อออกนอกเส้น, หมุนตามทิศ |
| ลานจอดรถ | ✅ | 8 โซนเป็น polygon, รายงาน 3 ระดับ, geofence, aggregation |
| Find My Car | ✅ | เก็บใน localStorage — เปลี่ยนเครื่องแล้วหาย (ตั้งใจ) |
| ruMaster Dataset | ✅ | 91 จุด |
| Exam Schedule Dataset | ⚠️ | 2,865 วิชา มีวันสอบ+คาบ **แต่ไม่มีอาคาร/ห้องสอบ** และเวลาคาบ A/B ยังไม่ยืนยัน |
| User Database + เหรียญ | ✅ | D1 + ledger กันรับซ้ำระดับฐานข้อมูล |
| แบบประเมิน → Google Sheets | ⚠️ | โค้ดพร้อม แต่ยังไม่ได้ใส่ `FEEDBACK_ENDPOINT_URL` = ยังเก็บผลไม่ได้ |
| Shop / ใช้เหรียญ | ❌ | หน้าเป็น Coming Soon — ฐานรองรับการหักเหรียญไว้แล้ว เหลือเคาะว่าแลกอะไร |
| Proactive Exam Alerts (Cron) | ❌ | ยังไม่มี `[triggers]` และ `scheduled` handler — ติดที่รอข้อมูลห้องสอบ + เวลาคาบ |
| Community | ❌ | ยังไม่เริ่ม (ADR-0004 ตัดออกจาก MVP ไว้ก่อน) |

### ยังต้องทำก่อนวัน demo

- [ ] ใส่อาคาร/ห้องสอบ และยืนยันเวลาคาบ A/B (บล็อก Exam Alerts อยู่)
- [ ] ใส่ `FEEDBACK_ENDPOINT_URL` หลัง deploy Google Apps Script
- [ ] โหลดทดสอบจริงกับคน 100-200 คนพร้อมกัน — ยังไม่เคยทดสอบโหลดจริงเลย
- [ ] seed ข้อมูลรายงานลานจอดจริงก่อนวันงาน (ต้องมีคนเดินไปเช็คอินจริง)
- [ ] เตรียม QR code ชี้ไปหา LINE OA (ไม่ใช่ LIFF ตรงๆ ต้องผ่านแชทก่อน)
