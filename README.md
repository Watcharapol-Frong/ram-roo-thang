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
├── liff/                      — หน้า LIFF (nav / parking report / profile view)
│   ├── index.html
│   ├── app.js
│   └── style.css
├── data/
│   └── baseline-dataset.json  — ข้อมูลอาคาร/ลานจอดตั้งต้น (ต้องเพิ่มให้ครบตาม Phase 1)
└── scripts/
    └── seed-kv.sh              — สคริปต์ seed baseline dataset เข้า KV
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

npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN

cd ..
./scripts/seed-kv.sh   # ⚠️ เช็ค syntax กับ wrangler version ก่อนรัน

cd worker
npm run dev
```

LIFF: แก้ `LIFF_ID`, `WORKER_BASE_URL`, `GOOGLE_MAPS_API_KEY` ใน `liff/app.js` ก่อน deploy (สร้าง LIFF app ผ่าน LINE Developers Console แยกต่างหาก ไม่ได้รวมอยู่ในโค้ดนี้)

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
