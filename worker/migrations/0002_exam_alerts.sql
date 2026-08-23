-- บันทึกว่าเคยส่งแจ้งเตือนสอบไปแล้ว
--
-- Cron อาจถูกเรียกซ้ำ (Cloudflare ไม่รับประกัน exactly-once) และเรายิงเองได้จาก endpoint ทดสอบด้วย
-- ถ้าไม่กันไว้ผู้ใช้จะโดนข้อความเดิมซ้ำ ซึ่งนอกจากน่ารำคาญแล้วยังกิน quota ข้อความของ LINE OA ฟรีๆ
-- ใช้วิธีเดียวกับ coin_ledger คือให้ UNIQUE ปฏิเสธเอง ไม่ต้องเขียน if เช็ค
CREATE TABLE IF NOT EXISTS exam_alerts_sent (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  exam_date  TEXT NOT NULL,          -- วันสอบที่เตือนถึง (YYYY-MM-DD)
  kind       TEXT NOT NULL,          -- DAY_BEFORE
  courses    TEXT NOT NULL,          -- รหัสวิชาที่อยู่ในข้อความ คั่นด้วย , ไว้ตรวจย้อนหลัง
  sent_at    TEXT NOT NULL,
  UNIQUE (user_id, exam_date, kind)
);

CREATE INDEX IF NOT EXISTS idx_exam_alerts_date ON exam_alerts_sent (exam_date);
