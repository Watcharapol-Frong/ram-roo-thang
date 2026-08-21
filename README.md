# รามรู้ทาง (RAM-ROO-THANG) — Bot Worker

LINE OA + Cloudflare Worker ที่ตอบแชตด้วย Workers AI, นำทางเดินเท้าไปอาคาร, และรับ/แสดงสถานะลานจอดรถแบบ crowdsourced

> ดู scope เต็มที่ `MVP Spec` (ส่งแยกให้ทีม dev), `CONTEXT.md` สำหรับนิยามศัพท์ และ `docs/adr/` สำหรับเหตุผลการตัดสินใจทางเทคนิค **ห้ามเพิ่มฟีเจอร์นอก MVP scope โดยไม่ยืนยันก่อน**

## โครงสร้างโปรเจกต์

```
src/
  index.js            entry point (Worker fetch handler)
  router.js           route ตาม path/method ไปยัง handler ที่เกี่ยวข้อง
  line/
    webhook.js         verify signature + parse LINE webhook events
    signature.js        HMAC signature verification
    events.js           handleEvent — logic หลักตอบแชต
    reply.js             เรียก LINE Messaging API (reply, loading animation)
    flexMessage.js       สร้าง Flex Message การ์ดอาคาร
  ai/
    client.js           เรียก Workers AI (@cf/qwen/qwen3-30b-a3b-fp8)
    functions.js         function calling stubs (getBuildingInfo, getParkingStatus — TODO)
  parking/
    report.js            POST /api/parking/report (TODO — stub 501)
    status.js             GET /api/parking/status (TODO — stub 501)
    geofence.js            Haversine distance (implement แล้ว)
  data/
    baseline.js          KV accessor สำหรับ BASELINE_DATA

liff/
  index.html            โครง LIFF page เปล่า (navigation + parking report view — TODO)

data/
  baseline-seed.example.json   ตัวอย่างข้อมูลอาคาร/ลานจอดสำหรับ seed

scripts/
  seed-baseline.mjs     แปลง baseline-seed.json -> wrangler kv bulk put format

docs/adr/                Architecture Decision Records
CONTEXT.md                นิยามศัพท์
wrangler.toml              Cloudflare Worker config (KV bindings, AI binding)
```

## สถานะการ implement เทียบกับ MVP spec

| ส่วน | สถานะ |
|---|---|
| LINE webhook + Workers AI chat (spec เดิม) | ✅ ทำงานได้ (ย้ายจาก `worker.js` เดิมมาอยู่ใน `src/line/`, `src/ai/client.js` แบบ behavior เดิมทุกประการ) |
| `src/parking/geofence.js` (Haversine) | ✅ implement แล้ว |
| `src/data/baseline.js` (KV accessor) | ✅ implement แล้ว (แค่ get/parse ตรงๆ) |
| Function calling (`getBuildingInfo`, `getParkingStatus`) — spec §4 | 🔲 stub เท่านั้น รอ seed data + wiring เข้า `ai/client.js` |
| `POST /api/parking/report` — spec §6.1 | 🔲 stub (คืน 501) รอ implement validation + write |
| `GET /api/parking/status` — spec §6.2 | 🔲 stub (คืน 501) รอ implement aggregation logic (spec §5) |
| LIFF page (navigation + parking report view) — spec §7 | 🔲 โครงหน้าเปล่าเท่านั้น |
| `BASELINE_DATA` / `PARKING_REPORTS` / `RATE_LIMIT` KV namespaces | 🔲 เพิ่ม binding ใน `wrangler.toml` แล้ว แต่ยังไม่ได้สร้าง namespace จริงบน Cloudflare (ดูด้านล่าง) |

## Setup

### 1. ติดตั้ง dependency

```bash
npm install
```

### 2. สร้าง KV namespace ที่ยังไม่มี

`CHAT_HISTORY_RAM` มี id อยู่แล้วใน `wrangler.toml` ส่วนอีก 3 ตัวต้องสร้างเองแล้วแทนที่ `REPLACE_ME_*` ในไฟล์:

```bash
wrangler kv namespace create BASELINE_DATA
wrangler kv namespace create PARKING_REPORTS
wrangler kv namespace create RATE_LIMIT
```

### 3. ตั้งค่า secrets สำหรับรันในเครื่อง

```bash
cp .dev.vars.example .dev.vars
# แก้ค่า LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN, LIFF_URL
```

Production ใช้ `wrangler secret put <NAME>` แทน

### 4. รัน dev server

```bash
npm run dev
```

### 5. Deploy

```bash
npm run deploy
```

## Seed baseline data

```bash
cp data/baseline-seed.example.json data/baseline-seed.json
# แก้พิกัด/รายชื่ออาคารและลานจอดให้ตรงของจริง
node scripts/seed-baseline.mjs
# รันคำสั่ง wrangler ที่ script พิมพ์ออกมา
```
