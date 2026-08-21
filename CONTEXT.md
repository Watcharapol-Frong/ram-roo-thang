# CONTEXT.md — นิยามศัพท์

> ร่างเริ่มต้น สร้างจากสิ่งที่ระบุไว้ใน `MVP Spec` (ยังไม่มี `CONTEXT.md` ต้นฉบับอยู่ในโปรเจกต์) — ทีมควรช่วยตรวจ/เพิ่มเติมให้ครบ

## LINE userId (Session Identifier)

`userId` ที่ LINE ส่งมาใน webhook event (`event.source.userId`) ถูกใช้ในระบบนี้เป็น **ตัวระบุ session ชั่วคราว** เท่านั้น เพื่อ:

- ผูกประวัติแชทใน `CHAT_HISTORY_RAM` (TTL 1 ชั่วโมง)
- กัน spam การรายงานสถานะลานจอดใน `RATE_LIMIT` (TTL 30 นาที)
- ตรวจ geofence ตอนรายงานสถานะใน `PARKING_REPORTS`

`userId` **ไม่ถูกผูก**กับชื่อ, เบอร์โทร, หรือข้อมูลระบุตัวตนอื่นใดของผู้ใช้ในระบบนี้ ระบบไม่มีหน้าจอเก็บข้อมูลส่วนบุคคล ไม่มีระบบสมาชิก จึงถือว่าอยู่นอกขอบเขตที่ต้องมี consent flow ตาม PDPA สำหรับ MVP รอบนี้ (ดู MVP spec §6.1, §9)

## Baseline data vs. Live report

- **Baseline data** (`BASELINE_DATA`): ข้อมูลอาคาร/ลานจอดที่ทีมกรอกไว้ล่วงหน้าด้วยมือ ไม่เปลี่ยนขณะระบบทำงาน ใช้เป็นค่าประมาณการเมื่อไม่มีรายงานสด
- **Live report** (`PARKING_REPORTS`): ข้อมูลที่ผู้ใช้จริงกดรายงานผ่าน LIFF ณ ขณะนั้น มีอายุจำกัดตาม aggregation window (ค่าเริ่มต้น N=30 นาที ดู MVP spec §5)
- ทุก response ที่ตอบสถานะลานจอดต้องระบุ `source` เป็น `"live_report"` หรือ `"baseline_estimate"` ให้ผู้ใช้เห็นความต่างเสมอ ห้ามปนกันโดยไม่บอก

## MVP vs. Full Vision

เอกสารนี้ (และโค้ดในโปรเจกต์ ณ ตอนนี้) ครอบคลุมเฉพาะ **MVP scope สำหรับ Demo 1 กันยายน 2569** เท่านั้น ฟีเจอร์อื่นที่เคยปรากฏใน Proposal/โปสเตอร์/SR&TD v1.1-v2.0 (เช่น MCP Server, Auth, SQL DB, Karma/Gamification, Community Map ฯลฯ) อยู่นอกขอบเขตนี้โดยตั้งใจ ห้ามเริ่มทำเพิ่มโดยไม่ยืนยัน scope ก่อน — ดู MVP spec §9 "Out of Scope"
