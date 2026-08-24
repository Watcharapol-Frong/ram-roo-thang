-- จำกัดจำนวนครั้งที่แลกได้ต่อคน
--
-- สติกเกอร์ตั้งไว้ 1 เพราะเป็นของจริงที่มีต้นทุนต่อชิ้น ปล่อยให้แลกซ้ำได้คือเปิดช่องให้คนเดียว
-- กวาดของไปหมด NULL = ไม่จำกัด สำหรับของที่แจกได้เรื่อยๆ ในอนาคต
ALTER TABLE shop_items ADD COLUMN max_per_user INTEGER;

UPDATE shop_items SET max_per_user = 1, updated_at = '2026-08-24T00:00:00.000Z'
 WHERE id = 'STICKER_LINE_01';

-- ข้อมูลที่ต้องส่งให้ผู้ใช้ตอนจัดของเสร็จ (เช่นลิงก์รับสติกเกอร์)
-- เก็บแยกจาก item เพราะเป็นค่าเฉพาะรายการแลก ไม่ใช่ค่าของสินค้า
ALTER TABLE redemptions ADD COLUMN fulfillment_note TEXT;
