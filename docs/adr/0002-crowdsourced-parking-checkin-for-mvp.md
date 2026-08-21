# 0002 — Crowdsourced Parking Check-in แบบง่าย แทน Weighted Density Formula (สำหรับ MVP)

**สถานะ**: Accepted (MVP 1.0, Demo 1 กันยายน 2569)

## บริบท

Full Vision spec ออกแบบสถานะลานจอดด้วยสูตรถ่วงน้ำหนัก ($D_{final}$) ที่รวมหลายปัจจัย (เช่น จำนวนรายงาน, ความใหม่ของรายงาน, ความน่าเชื่อถือของผู้รายงาน ฯลฯ) เพื่อให้ได้ค่าความหนาแน่นที่แม่นยำและทนต่อรายงานที่ผิดพลาด/ตั้งใจก่อกวน

สำหรับ MVP ที่เพิ่งเริ่มมี user รายงานจริงเป็นครั้งแรก ข้อมูลยังน้อยเกินกว่าจะ tune weighted formula ให้มีความหมาย และความซับซ้อนของสูตรไม่คุ้มกับเวลาที่มีก่อน demo

## การตัดสินใจ

MVP ใช้ **aggregation window แบบง่าย** (MVP spec §5):

1. ดึง report ทั้งหมดของ zone ในช่วง N นาทีล่าสุด (ค่าเริ่มต้น N=30)
2. ถ้ามี report ในช่วงนั้น ใช้ report ล่าสุดตรงๆ (ไม่ถ่วงน้ำหนัก)
3. ถ้าไม่มี fallback ไปใช้ `baseline_status` ที่กรอกไว้ล่วงหน้า
4. ตอบกลับต้องระบุ `source` ว่ามาจาก `"live_report"` หรือ `"baseline_estimate"` เสมอ เพื่อให้ผู้ใช้ประเมินความน่าเชื่อถือของข้อมูลเอง

ไม่มี rate/quality scoring, ไม่มี weighted formula, ไม่มี reporter reputation ใดๆ ใน MVP

## ผลที่ตามมา

- Logic implement และ debug ได้เร็ว เหมาะกับ timeline สั้นก่อน demo
- ทนต่อรายงานปลอม/ผิดพลาดได้น้อยกว่า — บรรเทาด้วย rate limit (30 นาที/user) และ geofence (150 เมตร) ที่ endpoint `/api/parking/report` แทน ไม่ใช่ที่ตัว aggregation
- ถ้าปริมาณ user รายงานจริงมากพอในอนาคต ควร revisit และพิจารณากลับไปใช้ weighted formula ตาม Full Vision
