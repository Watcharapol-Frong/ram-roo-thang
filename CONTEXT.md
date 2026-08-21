# รามรู้ทาง (RAM-ROO-THANG)

แพลตฟอร์มผู้ช่วยสัญจรอัจฉริยะบน LINE OA สำหรับมหาวิทยาลัยรามคำแหง ส่งประกวด RU Innovation 2026 (ผ่านเข้ารอบแล้ว, นำเสนอ/demo วันที่ 1 กันยายน 2569)

## Language

**MVP (Minimum Viable Product)**:
สิ่งที่ทำงานได้จริงและ demo ได้ในวันที่ 1 ก.ย. 2569 เท่านั้น — chatbot ตอบคำถามนำทาง/ที่จอดรถ, LIFF แสดงเส้นทางเดินจริงผ่าน Google Maps Embed (directions mode), ที่จอดรถรับรายงานจริงจาก user ผ่าน GPS (Parking Check-in) โดยมี Baseline Dataset เป็น fallback ยังคง**ไม่เก็บ PII**, ไม่มี MCP Server เต็มสเปก, ไม่มี 2.5D isometric engine ที่เขียนเอง, ไม่มี Karma/Gamification, ไม่มี Community Map/Moderation
_Avoid_: ระบบ, แพลตฟอร์ม (ใช้แทนกันแบบกำกวมกับ Full Vision)

**Full Vision**:
ภาพรวมทั้งหมดตามที่บรรยายในใบสมัคร/โปสเตอร์/Proposal — 4 โซลูชัน (Navigation, Parking, Community Map, Student Profile) พร้อม MCP Server เต็มรูปแบบ, Crowdsourcing, PDPA compliance เต็มระบบ, 2.5D Isometric Engine เอง คือ **แผนพัฒนาต่อ ไม่ใช่สิ่งที่มีอยู่หรือทดสอบแล้ว**
_Avoid_: สถานะปัจจุบัน, สิ่งที่ระบบทำได้ (เมื่อพูดถึง Full Vision ต้องระบุว่าเป็นแผนอนาคตเสมอ)

**MCP-inspired Context Layer**:
สถาปัตยกรรมของ MVP ที่ AI agent เรียก function/API ของตัวเองตรงๆ เพื่อดึงข้อมูลอาคาร/ที่จอดรถ **ไม่ใช่ MCP Server ตาม spec เต็มรูปแบบ** (JSON-RPC, tools/resources) ตามที่ Proposal อ้างไว้
_Avoid_: MCP Server, Model Context Protocol (คำเหล่านี้ใช้ได้เฉพาะตอนพูดถึง Full Vision phase ถัดไป)

**2.5D Isometric Engine**:
คำมาตรฐานสำหรับมุมมองแผนที่ที่วางแผนพัฒนาต่อใน Full Vision (ไม่ใช่ 3D — ใบสมัครเขียนคลาดเคลื่อนไว้ว่า 3D แต่ของจริงที่จะสร้างคือ 2.5D)
_Avoid_: 3D Isometric Engine

**Google Maps Embed (Directions Mode)**:
วิธีแสดงแผนที่ใน MVP — ใช้ Embed API โหมด `directions` (origin=พิกัด user จาก LIFF geolocation, destination=พิกัดตึกเป้าหมาย, mode=walking) เพื่อวาดเส้นทางเดินจริง + ระยะทาง + เวลาโดยประมาณให้อัตโนมัติ **ไม่ได้เขียน routing engine เอง** ยังคงเป็นการเลี่ยงการสร้าง 2.5D Isometric Engine เอง (ของ Full Vision) เหมือนเดิม แค่ใช้ mode ที่ Google คำนวณเส้นทางให้แทน
_Avoid_: 2.5D Map, "แค่หมุดปลายทาง" (scope เปลี่ยนจากหมุดอย่างเดียวเป็นมีเส้นทางแล้ว), Manual Route Calculation (ไม่ได้คำนวณเส้นทางเอง Google ทำให้)

**Parking Check-in (Crowdsourced Report)**:
ข้อมูลสถานะลานจอดใน MVP ที่มาจาก **user รายงานจริงผ่าน GPS เป็นแหล่งหลัก** ไม่ใช่ static dataset อย่างเดียวอีกต่อไป (เปลี่ยนจากการตัดสินใจเดิม) ต้องผ่าน Geofence Validation ก่อนรับรายงาน และมี Rate Limit กันสแปม
_Avoid_: Static-only Parking Status (คำนี้ไม่ใช้แล้วหลังเปลี่ยน scope)

**Geofence Validation**:
การเช็คว่า user ที่ส่งรายงานสถานะลานจอดอยู่ในรัศมี ~100-150 เมตรจากลานจอดนั้นจริง ก่อนรับรายงานเข้าระบบ ใช้สูตรคำนวณระยะทางเดียวกับที่ใช้ทำ Navigation
_Avoid_: ไม่มีการเช็คระยะ (จะทำให้ข้อมูลไม่น่าเชื่อถือ)

**Aggregation Window**:
กติกาการสรุปสถานะปัจจุบันของลานจอดใน MVP — ใช้รายงานล่าสุดภายใน N นาทีที่ผ่านมา ถ้าไม่มีรายงานในช่วงนั้นให้ fallback ไปใช้ Baseline Dataset แทน (ไม่ใช้สูตรถ่วงน้ำหนักซับซ้อนแบบ Full Vision)
_Avoid_: Density Formula ถ่วงน้ำหนัก (เป็นของ Full Vision v2.0)

**Baseline Dataset** (แก้ไขนิยาม):
ข้อมูลพิกัดอาคาร/ลานจอดรถที่กรอกด้วยมือไว้ล่วงหน้า ใน MVP ทำหน้าที่เป็น **fallback** เมื่อไม่มี Parking Check-in ล่าสุด ไม่ใช่แหล่งข้อมูลหลักอีกต่อไป
_Avoid_: Crowdsourced Data, Real-time Data (เมื่อพูดถึง MVP)

**LINE userId (Session Identifier)**:
ตัวระบุตัวตนเดียวที่ MVP เก็บ ใช้แค่สำหรับ chat history ชั่วคราวใน Cloudflare KV ไม่ใช่ PII ตามคำนิยามในโปรเจกต์นี้
_Avoid_: ข้อมูลส่วนตัวผู้ใช้, PII (ห้ามใช้เรียก LINE userId เดี่ยวๆ)

**PII (Personally Identifiable Information) — ในบริบทโปรเจกต์นี้**:
ชื่อ-นามสกุล, เบอร์โทรศัพท์ หรือข้อมูลที่ระบุตัวตนได้จริง **ไม่อยู่ใน scope ของ MVP** — เป็นของ "User & Student Profile" ใน Full Vision phase ถัดไปเท่านั้น
_Avoid_: ข้อมูลผู้ใช้ (คำกำกวมที่ทำให้ปนกับ LINE userId)

**Student Exam Schedule (No-PII)**:
ฟีเจอร์ใน MVP ที่ให้ user บันทึกรหัสวิชา/อาคารสอบ/วันเวลาสอบ ผูกกับ LINE userId เท่านั้น **ไม่เก็บชื่อ-เบอร์โทร** ต่างจาก "User & Student Profile" ใน Full Vision ที่มี Push Notification อัตโนมัติและข้อมูลส่วนตัวเต็มรูปแบบ — MVP มีแค่บันทึก/ดู/ลบ ไม่มี proactive alert
_Avoid_: User & Student Profile (คำนี้ใช้เฉพาะ Full Vision ที่มี PII+cron alert), ตารางสอบส่วนบุคคล (กำกวมกับ Full Vision)

**Consent Gate (Lightweight)**:
หน้าจอยืนยันความเข้าใจก่อนใช้ Student Exam Schedule ใน MVP — เป็นแค่ UI acknowledgment (เก็บ flag ใน localStorage ฝั่ง client) **ไม่ใช่ PDPA consent flow ตามกฎหมายเต็มรูปแบบ** เพราะไม่มี PII ให้ขอความยินยอมตามกฎหมายอยู่แล้ว ต่างจาก "Consent Management Flow" ใน Full Vision ที่ผูกกับการเก็บ PII จริง
_Avoid_: Consent Management Flow, PDPA Consent (คำเหล่านี้สื่อถึงกระบวนการทางกฎหมายเต็มรูปแบบซึ่งไม่มีใน MVP)
