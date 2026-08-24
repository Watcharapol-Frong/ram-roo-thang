-- ห้องสอบที่ผู้ใช้ส่งเข้ามาเอง
--
-- มหาวิทยาลัยไม่ประกาศห้องสอบล่วงหน้าเป็นชุดข้อมูล — ประกาศใกล้สัปดาห์สอบและเป็นรายบุคคล
-- ผ่าน e-Service เราจึงดึงเองไม่ได้ ต้องให้ผู้ใช้ส่งรูปตารางสอบของตัวเองมาแล้วอ่านด้วย vision model
ALTER TABLE user_courses ADD COLUMN room TEXT;
ALTER TABLE user_courses ADD COLUMN room_source TEXT;      -- OCR | MANUAL
ALTER TABLE user_courses ADD COLUMN room_updated_at TEXT;

-- ผลอ่านรูปที่รอผู้ใช้ยืนยัน
--
-- ไม่บันทึกลง user_courses ทันทีเด็ดขาด — OCR ผิดได้ และผิดแปลว่าคนไปผิดห้องสอบ
-- ต้องให้คนตัดสินใจครั้งสุดท้ายเสมอ ตารางนี้พักผลไว้ระหว่างรอกดยืนยัน
-- postback ของ LINE จำกัดความยาว จึงส่งแค่ id ของ draft ไม่ได้ยัดข้อมูลทั้งก้อนไป
CREATE TABLE IF NOT EXISTS room_import_drafts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  items      TEXT NOT NULL,          -- JSON: [{course_code, room, exam_date, period}]
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_room_drafts_user ON room_import_drafts (user_id, created_at DESC);
