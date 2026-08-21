# 0003 — Student Exam Schedule แบบไม่มี PII + Lightweight Consent Gate (สำหรับ MVP)

**สถานะ**: Accepted (MVP 1.0, Demo 1 กันยายน 2569)

## บริบท

Full Vision spec มี "User & Student Profile" ที่เก็บข้อมูลส่วนตัวผู้ใช้เต็มรูปแบบ (ชื่อ, เบอร์โทร ฯลฯ) พร้อม Push Notification เชิงรุก (cron alert) และต้องมี PDPA consent flow ตามกฎหมายเต็มรูปแบบก่อนเก็บข้อมูล

MVP ต้องการฟีเจอร์ "บันทึกวิชาสอบ" เพื่อ demo (MVP-SPEC-for-Dev.md §1.4) แต่ timeline สั้นเกินกว่าจะสร้างระบบ auth/PII/consent flow เต็มรูปแบบ และ scope เดิมของ MVP (ทุกฟีเจอร์อื่น) ไม่มี PII อยู่แล้ว การเพิ่มฟีเจอร์นี้จึงต้องไม่ทำลายคุณสมบัติ "ไม่เก็บ PII" ของทั้งระบบ

## การตัดสินใจ

MVP ทำ **Student Exam Schedule (No-PII)** (MVP-SPEC-for-Dev.md §6.5-6.7):

- บันทึกเฉพาะ รหัสวิชา (`course_code`), อาคารสอบ (`building_id`), เวลาสอบ (`exam_at`) ผูกกับ LINE userId (Session Identifier) เท่านั้น — ดู `worker/src/data.js` (`STUDENT_SCHEDULES`, key `schedule:{user_id}:{schedule_id}`)
- ไม่เก็บชื่อ-เบอร์โทร หรือข้อมูลระบุตัวตนอื่นใด
- ไม่มี Push Notification เชิงรุก — user ต้องเปิดดูเองผ่าน LIFF (บันทึก/ดู/ลบเท่านั้น ไม่มี proactive alert)
- ก่อนใช้งานฟีเจอร์นี้ครั้งแรก แสดง **Consent Gate (Lightweight)**: เป็นแค่ UI acknowledgment (เก็บ flag ใน localStorage ฝั่ง client — ดู `liff/app.js`) ไม่ใช่ PDPA consent flow ตามกฎหมาย เพราะไม่มี PII ให้ขอความยินยอมตามกฎหมายอยู่แล้ว

## ผลที่ตามมา

- ฟีเจอร์ implement ได้เร็วโดยไม่ต้องสร้างระบบ auth/PII handling เต็มรูปแบบ
- ถ้า user เปลี่ยนเครื่อง/ล้าง LINE app ข้อมูลอาจหาย เพราะผูกกับ userId ที่ไม่มี recovery mechanism ใดๆ — ยอมรับได้สำหรับ MVP demo
- ถ้าต้องการ Push Notification หรือเก็บ PII จริงในอนาคต (Full Vision "User & Student Profile") ต้อง revisit เรื่อง auth และ PDPA consent flow ตามกฎหมายใหม่ทั้งหมด — Consent Gate เบาๆ นี้ใช้แทนกันไม่ได้
