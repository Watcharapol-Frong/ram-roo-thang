# 0001 — ใช้ Function Calling ของ AI agent เอง แทน MCP Server (สำหรับ MVP)

**สถานะ**: Accepted (MVP 1.0, Demo 1 กันยายน 2569)

## บริบท

Full Vision spec (Proposal/SR&TD) ออกแบบให้มี MCP Server กลางที่ tool ต่างๆ (ค้นหาอาคาร, เช็คที่จอดรถ ฯลฯ) ลงทะเบียนผ่าน protocol มาตรฐาน เพื่อให้ AI agent เรียกใช้งานได้อย่างเป็นระบบและขยายได้ในอนาคต

สำหรับ MVP ที่ต้อง demo ภายในกรอบเวลาสั้น มี tool ที่ต้องใช้จริงแค่ 2 ตัว (`getBuildingInfo`, `getParkingStatus`) และข้อมูลทั้งหมดอยู่ใน Cloudflare KV namespace เดียวกับที่ Worker เข้าถึงอยู่แล้ว การตั้ง MCP Server แยกต่างหาก (พร้อม deployment, protocol handling, auth ของตัว MCP เอง) เป็นงานที่หนักเกินความจำเป็นของ scope นี้

## การตัดสินใจ

MVP ใช้ **function calling ที่ Workers AI เรียกเอง** ภายใน Worker เดียวกัน (ดู `worker/src/ai.js`) โดย function ทั้งสองตัวอ่านข้อมูลตรงจาก Cloudflare KV (`BASELINE_DATA`, `PARKING_REPORTS` ผ่าน `worker/src/data.js`) ไม่มี server, protocol, หรือ deployment แยกต่างหาก

## ผลที่ตามมา

- ลด moving parts และเวลาที่ใช้ setup ให้เหลือน้อยที่สุดสำหรับ demo
- ไม่มี tool registry ที่ขยายได้แบบ MCP — ถ้าต้องเพิ่ม tool ใหม่ในอนาคต (Full Vision) จะต้อง migrate มาใช้ MCP Server จริงตาม spec เดิม
- Coupling ระหว่าง AI logic กับ data layer สูงกว่าการมี MCP Server กลาง แต่ยอมรับได้เพราะ scope เล็กและอายุการใช้งานสั้น (MVP demo)
