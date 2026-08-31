# รามรู้ทาง (RAM-ROO-THANG) — MVP Technical Spec สำหรับ Dev Team

**เวอร์ชัน**: MVP 1.0 (สำหรับ Demo วันที่ 1 กันยายน 2569 เท่านั้น)
**สถานะปัจจุบัน**: มี LINE OA + webhook (`worker.js`) ที่ตอบแชตด้วย Workers AI จาก mock data — เอกสารนี้คือสิ่งที่ต้องสร้างเพิ่มเพื่อให้ครบ MVP

> ⚠️ **อ่านก่อนเริ่ม**: เอกสารนี้คือ **MVP scope เท่านั้น** ไม่ใช่ระบบเต็มรูปแบบที่เคยเห็นใน Proposal/โปสเตอร์/SR&TD v1.1-v2.0 ห้ามหยิบฟีเจอร์จากเอกสารฉบับอื่นมาทำเพิ่มโดยไม่ถามก่อน ดู "Out of Scope" ท้ายเอกสารสำหรับสิ่งที่ตั้งใจไม่ทำในรอบนี้

---

## 1. Scope โดยสรุป

ผู้ใช้พิมพ์คุยกับ AI ผ่าน LINE OA เพื่อ:
1. ถามหาตึก → ได้คำตอบ + กดปุ่มเปิด LIFF เห็น**เส้นทางเดินจริง**จากตำแหน่งปัจจุบันไปตึกเป้าหมาย พร้อมระยะทาง/เวลาโดยประมาณ
2. ถามสถานะลานจอดรถ → ได้คำตอบจากข้อมูลที่ **user คนอื่นเพิ่งรายงานจริง** (หรือ fallback ไปข้อมูล baseline ถ้าไม่มีรายงานสด)
3. กดปุ่มใน LIFF เพื่อ**รายงานสถานะลานจอด**ที่ตัวเองอยู่ ณ ตอนนั้น (ต้องอยู่ใกล้ลานจอดจริงถึงรายงานได้)
4. พิมพ์ "บันทึกวิชาสอบ" → กดปุ่มเปิด LIFF โหมด Profile → ผ่าน consent gate (UI เฉยๆ) → กรอกรหัสวิชา/อาคาร/เวลาสอบ → ดู/ลบรายการที่บันทึกไว้ (ดู ADR-0003)

ไม่มี: การเก็บชื่อ/เบอร์โทร, ระบบสมาชิก/auth, Community Map, Karma/Gamification, Push Notification เชิงรุก

**หมายเหตุความน่าเชื่อถือสำหรับงานถ่ายทอดสด**: ทั้ง Navigation และ Schedule ถูกออกแบบให้ไม่ต้องพึ่ง Workers AI เป็นจุดเดียว — ถ้า AI timeout จะยัง fallback ไปหา context/flex message ที่ต้องการได้ (ดู `worker/src/ai.js`), ส่วน Schedule intent ข้าม AI ไปเลยทั้งหมด

---

## 2. Architecture

```
[LINE OA] --webhook--> [Cloudflare Worker: worker.js]
                              |
                              ├── Cloudflare KV: CHAT_HISTORY_RAM (มีอยู่แล้ว)
                              ├── Cloudflare KV: BASELINE_DATA (ใหม่) — พิกัดอาคาร/ลานจอด
                              ├── Cloudflare D1: parking_reports — รายงานสถานะสด (เดิมอยู่บน KV ดู ADR 0005)
                              ├── Cloudflare KV: RATE_LIMIT (ใหม่) — กัน spam การรายงาน
                              └── Workers AI (@cf/qwen/qwen3-30b-a3b-fp8) + function calling

[LIFF Webview] --fetch--> [Cloudflare Worker: /api/parking/report, /api/parking/status]
       |
       └── Google Maps Embed API (mode=directions) — วาดเส้นทาง+ระยะ+เวลาให้อัตโนมัติ
```

**ไม่มี**: MCP Server ตาม spec, Redis, Gemini API, Auth token verification (ดูเหตุผลใน `CONTEXT.md` และ `docs/adr/`)

> หมายเหตุ: ฉบับแรกเขียนว่า "ไม่มีฐานข้อมูล SQL" แต่ภายหลังย้าย users/coin_ledger/user_courses มาอยู่บน
> Cloudflare D1 (migration 0001) และย้าย parking_reports ตามมา (migration 0011, ADR 0005) เพราะ KV
> ไม่มี atomic write และ query ไม่ได้ — ดูหัวข้อ "Where data lives" ใน README

---

## 3. Data Model (ข้อมูลอ้างอิงอยู่ใน KV/bundle, ข้อมูลที่ต้อง query อยู่บน D1)

### 3.1 `BASELINE_DATA` (เขียนด้วยมือล่วงหน้า ไม่เปลี่ยนขณะรัน)
Key: `building:{building_id}` เช่น `building:VKB`
```json
{
  "building_id": "VKB",
  "name_th": "อาคารวิศวกรรมศาสตร์",
  "aliases": ["VKB", "ตึกวิศวะ"],
  "lat": 13.753821,
  "lng": 100.617432,
  "nearest_parking_zone_id": "ZONE_VKB"
}
```
Key: `parking_zone:{zone_id}` เช่น `parking_zone:ZONE_VKB`
```json
{
  "zone_id": "ZONE_VKB",
  "zone_name": "ลานจอดข้างตึก VKB",
  "lat": 13.753900,
  "lng": 100.617500,
  "baseline_status": "YELLOW"
}
```

### 3.2 `parking_reports` (D1 — เขียนตอน user รายงานจริง, migration 0011)
หนึ่งแถวต่อหนึ่งรายงาน ไม่ทับกัน (เดิมเป็น KV คีย์เดียวต่อลานแล้วเขียนทับ ดู ADR 0005)
```
id | zone_id    | status | reporter_user_id | reported_at
 1 | ZONE_VKB   | RED    | U1234...         | 2026-09-01T08:40:00Z
```

### 3.3 `RATE_LIMIT`
Key: `ratelimit:{user_id}` → value = ISO timestamp ล่าสุดที่รายงาน, TTL 30 นาที

---

## 4. Function Calling (AI Agent เรียกเอง — ไม่ใช่ MCP Server)

ดู `docs/adr/0001-function-calling-instead-of-mcp-for-mvp.md` สำหรับเหตุผล

| Function | Input | Output |
|---|---|---|
| `getBuildingInfo(query)` | ชื่อ/alias ที่ user พิมพ์ | building object จาก BASELINE_DATA (fuzzy match กับ aliases) |
| `getParkingStatus(zone_id)` | zone_id | สถานะปัจจุบัน (ดู logic ข้อ 5) |

---

## 5. Parking Status Logic (Aggregation Window)

```
1. ดึง reports ทั้งหมดของ zone_id ในช่วง N นาทีล่าสุด (ค่าเริ่มต้น N=30) จากตาราง parking_reports (D1)
2. ให้น้ำหนักแต่ละใบตามอายุแบบเชิงเส้น — เพิ่งรายงาน ≈ 1, ใกล้ครบ N นาที ≈ 0
3. รวมน้ำหนักตามสถานะ แล้วเลือกสถานะที่ได้น้ำหนักรวมมากที่สุด (เสียงเท่ากัน → ใบที่ใหม่กว่าชนะ)
4. ถ้าไม่มี report ในช่วงนั้น → fallback ไปใช้ baseline_status จาก BASELINE_DATA
5. Response ต้องระบุด้วยว่าข้อมูลนี้มาจาก "รายงานสด" หรือ "ค่าประมาณการ" (แสดงความแตกต่างให้ user เห็น)
   พร้อม sample_size (ใช้กี่ใบคิด) และ agreement (สัดส่วนที่เห็นตรงกัน 0-1)
```

เดิมข้อ 3 คือ "ใช้ report ล่าสุดใบเดียว" ซึ่งแปลว่าคนที่กดคนสุดท้ายทับความเห็นของทุกคนก่อนหน้า —
เปลี่ยนเป็นถ่วงน้ำหนักแล้ว ดู `docs/adr/0005-weighted-aggregation-for-parking-reports.md`
(ยังไม่มี reporter reputation ตาม `docs/adr/0002-crowdsourced-parking-checkin-for-mvp.md`)

---

## 6. API Endpoints (สำหรับ LIFF เรียก)

### 6.1 `POST /api/parking/report`
```json
// Request
{ "user_id": "U1234...", "zone_id": "ZONE_VKB", "status": "RED", "user_lat": 13.7539, "user_lng": 100.6175 }
```

**Validation ต้องทำตามลำดับ**:
1. **Rate limit**: เช็ค `RATE_LIMIT:{user_id}` — ถ้ารายงานล่าสุด < 30 นาทีที่แล้ว → reject `429 Too Many Requests`
2. **Geofence**: คำนวณระยะจาก `user_lat/lng` ถึงพิกัด zone (Haversine formula) — ถ้าเกิน 150 เมตร → reject `422 Unprocessable Entity` พร้อมข้อความ "คุณอยู่ไกลจากลานจอดนี้เกินไป"
3. ผ่านทั้งคู่ → เพิ่มแถวใน `parking_reports` (D1), อัปเดต `RATE_LIMIT`

```json
// Response 200
{ "status": "SUCCESS" }
```

> **หมายเหตุ PDPA**: `user_id` ในที่นี้คือ LINE userId ที่ใช้แค่กัน spam/geofence ตอนรายงาน ไม่ผูกกับชื่อ/เบอร์โทรใดๆ — ตรงตามนิยาม "LINE userId (Session Identifier)" ใน `CONTEXT.md` ไม่ต้องมี consent flow เพิ่ม

### 6.2 `GET /api/parking/status?zone_id=ZONE_VKB`
```json
// Response
{ "zone_id": "ZONE_VKB", "status": "RED", "source": "live_report", "as_of": "2026-09-01T08:40:00Z" }
```
(`source` เป็น `"live_report"` หรือ `"baseline_estimate"`)

### 6.2.1 `GET /api/parking/zones`
> ⚠️ **เพิ่มหลังจากฉบับแรก** — คืนทุกลานจอดพร้อมสถานะในคำขอเดียว ไม่เปลี่ยน logic ของ §5 เลย เป็นการยุบ request ล้วนๆ: เดิม LIFF ต้องยิง §6.2/§6.3 ทีละโซน/ทีละอาคารเพื่อประกอบข้อมูลชุดเดียวกันนี้เอง (เปิดแผนที่ 1 ครั้ง = 8+ request) ซึ่งเป็นภาระที่ชัดเจนตอนมีผู้ใช้พร้อมกันจำนวนมาก
```json
{
  "zones": [
    {
      "zone": { "zone_id": "ZONE_VKB", "zone_name": "...", "lat": 13.75, "lng": 100.61, "baseline_status": "YELLOW" },
      "parking_status": { "zone_id": "ZONE_VKB", "status": "RED", "source": "live_report", "as_of": "..." }
    }
  ]
}
```

### 6.3 `GET /api/building?building_id=VKB`
> ⚠️ **เพิ่มหลังจากฉบับแรก** — ไม่ได้อยู่ใน scope ที่คุยกันตอนแรก แต่จำเป็นทางโครงสร้าง: LIFF (browser) อ่าน Cloudflare KV ตรงๆ ไม่ได้ ต้องมี endpoint ให้อ่านพิกัดอาคาร/ลานจอด ไปสร้าง Google Maps Embed URL (nav) และหาพิกัด geofence (parking report) เอง เป็น public read-only ไม่มี PII ไม่กระทบ decision อื่นที่ freeze ไว้
```json
// Response
{
  "building": { "building_id": "VKB", "name_th": "...", "lat": 13.75, "lng": 100.61, "nearest_parking_zone_id": "ZONE_VKB" },
  "parking_zone": { "zone_id": "ZONE_VKB", "zone_name": "...", "lat": 13.75, "lng": 100.61, "baseline_status": "YELLOW" },
  "parking_status": { "zone_id": "ZONE_VKB", "status": "RED", "source": "live_report", "as_of": "..." }
}
```

### 6.4 `GET /api/buildings`
คืนอาคารทั้งหมด — ใช้โดย LIFF dropdown ใน Profile view
```json
{ "buildings": [ { "building_id": "VKB", "name_th": "...", ... } ] }
```

### 6.5 `POST /api/schedule` — บันทึกวิชาสอบ (ไม่มี PII ดู ADR-0003)
```json
// Request
{ "user_id": "U1234...", "course_code": "LAW1001", "building_id": "VKB", "exam_at": "2026-10-15T09:00:00Z" }
// Response 200
{ "status": "SUCCESS", "schedule": { "schedule_id": "...", "course_code": "LAW1001", ... } }
```

### 6.6 `GET /api/schedule?user_id=U1234...` — ลิสต์วิชาสอบที่บันทึกไว้
```json
{ "schedules": [ { "schedule_id": "...", "course_code": "LAW1001", "building_name": "...", "exam_at": "..." } ] }
```

### 6.7 `DELETE /api/schedule?user_id=U1234...&schedule_id=...`
```json
{ "status": "SUCCESS" }
```

---

## 7. LIFF Page

หน้าเดียว ทำ 2 อย่าง:

**Navigation view** (เมื่อมี `?dest_id=` ใน URL):
- ขอ `navigator.geolocation.getCurrentPosition()` จากเครื่อง user
- Embed Google Maps ด้วย mode `directions`: origin=พิกัด user, destination=พิกัดตึกจาก `dest_id`, mode=walking
- ถ้า user ปฏิเสธ permission → แสดงข้อความขอ location ใหม่พร้อมปุ่มลองอีกครั้ง (ไม่มี manual pin fallback ใน MVP — ถ้าจำเป็นค่อยเพิ่ม)

**Parking report view**:
- ปุ่มเลือกสถานะ (ว่าง/ปานกลาง/เต็ม) สำหรับ zone ที่ใกล้ที่สุด (ใช้ geolocation เดียวกันหาลานที่ใกล้สุดจาก BASELINE_DATA)
- กดแล้วยิงไป `POST /api/parking/report`
- แสดงผลลัพธ์ (สำเร็จ / ถูก reject เพราะไกลเกิน / ถูก reject เพราะรายงานถี่เกิน)

**Profile view** (เมื่อมี `?mode=profile` ใน URL — ดู ADR-0003):
- Consent gate เบื้องต้น (localStorage flag, ไม่ใช่ PDPA flow ตามกฎหมาย เพราะไม่มี PII)
- ฟอร์มกรอกรหัสวิชา + เลือกอาคาร (dropdown จาก `/api/buildings`) + วันเวลาสอบ → `POST /api/schedule`
- ลิสต์วิชาที่บันทึกไว้ พร้อมปุ่มลบ → `GET`/`DELETE /api/schedule`

---

## 8. Failure Handling (ขั้นต่ำที่ต้องมี)

| เหตุการณ์ | Fallback |
|---|---|
| Workers AI ตอบช้า/error | ตอบข้อความ static + Quick Reply เมนูหลัก (โค้ด quickReply มีอยู่แล้วใน worker.js) |
| Geolocation ถูกปฏิเสธ | แสดงข้อความขอ permission ใหม่ ไม่ crash หน้า LIFF |
| ไม่มีข้อมูล report สด | Fallback baseline ตามข้อ 5 พร้อมระบุ `source: "baseline_estimate"` ให้ user รู้ว่าไม่ใช่ real-time |
| zone_id/building_id ไม่พบ | ตอบสุภาพว่าไม่มีข้อมูลจุดนี้ อย่า hallucinate ชื่อ/ตำแหน่ง |

---

## 9. Out of Scope (ห้ามทำในรอบนี้ — เป็นของ Full Vision)

- MCP Server ตาม spec จริง, Gemini API
- ระบบ Auth (LINE ID Token verify), RBAC
- SQL Database (D1/Postgres), Redis
- MapLibre / vector tiles / 2.5D isometric engine เขียนเอง
- Karma/Gamification, Community POI + Moderation, Admin Portal
- **ชื่อ-เบอร์โทร-ข้อมูลระบุตัวตนใดๆ**, Push Notification เชิงรุก (Cron alert), PDPA Consent Flow ตามกฎหมายเต็มรูปแบบ (ดู ADR-0003 — Schedule feature มีแค่ lightweight consent gate)
- Weighted density formula ($D_{final}$)

หากมีเวลาเหลือหลังทำครบข้อ 1-8 ค่อยกลับมาคุยเพิ่ม ห้ามเริ่มทำเองโดยไม่ยืนยัน scope ก่อน

---

## 10. Reference

- `CONTEXT.md` — นิยามศัพท์ทั้งหมด
- `docs/adr/0001-function-calling-instead-of-mcp-for-mvp.md`
- `docs/adr/0002-crowdsourced-parking-checkin-for-mvp.md`
- `worker.js` — โค้ด LINE webhook ปัจจุบัน (จุดเริ่มต้นที่ต้องแก้/เพิ่ม)
