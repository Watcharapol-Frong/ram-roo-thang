-- ผู้ใช้ + บัญชีเหรียญ (แทนที่ USER_PROFILES KV เดิม)
--
-- ledger คือความจริงของยอดเหรียญ ส่วน users.coins เป็นยอดสรุปที่คำนวณไว้ล่วงหน้าเพื่อไม่ต้อง
-- SUM ทุกครั้งที่เปิดหน้าโปรไฟล์ ถ้าสองอันไม่ตรงกันเมื่อไรให้เชื่อ ledger แล้วคำนวณใหม่

CREATE TABLE IF NOT EXISTS users (
  user_id     TEXT PRIMARY KEY,          -- LINE userId เท่านั้น ไม่เก็บ PII อื่น
  coins       INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coin_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(user_id),
  delta       INTEGER NOT NULL,          -- บวก = ได้รับ, ลบ = ใช้ไป
  reason      TEXT NOT NULL,             -- PARKING_REPORT | FEEDBACK | SAVE_CAR | SHOP_REDEEM
  ref_id      TEXT NOT NULL,             -- ตัวกันรับซ้ำ (ดู UNIQUE ข้างล่าง)
  balance_after INTEGER NOT NULL,        -- ยอดหลังรายการนี้ ไว้ตรวจย้อนหลังว่ายอดเพี้ยนตรงไหน
  created_at  TEXT NOT NULL
);

-- หัวใจของการกันรับซ้ำ — ให้ฐานข้อมูลปฏิเสธเอง ไม่ต้องเขียน if ในโค้ดแล้วหวังว่าจะครบทุกทาง
--   FEEDBACK       ref_id = 'once'        -> ครั้งเดียวตลอดชีพ
--   SAVE_CAR       ref_id = '2026-08-23'  -> วันละครั้ง (วันที่ตามเวลาไทย)
--   PARKING_REPORT ref_id = id ของรายงาน  -> 1 รายงาน 1 ครั้ง
--   SHOP_REDEEM    ref_id = id การแลก     -> กดรัวก็หักครั้งเดียว
CREATE UNIQUE INDEX IF NOT EXISTS idx_coin_ledger_dedupe
  ON coin_ledger (user_id, reason, ref_id);

CREATE INDEX IF NOT EXISTS idx_coin_ledger_user_time
  ON coin_ledger (user_id, created_at DESC);

-- ตารางสอบที่ผู้ใช้บันทึกไว้ (แทนที่ STUDENT_SCHEDULES KV เดิม)
-- UNIQUE กันเพิ่มวิชาซ้ำ ซึ่งของเดิมบน KV ทำไม่ได้เพราะ key เป็น uuid สุ่มทุกครั้ง
CREATE TABLE IF NOT EXISTS user_courses (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(user_id),
  course_code  TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (user_id, course_code)
);

CREATE INDEX IF NOT EXISTS idx_user_courses_user ON user_courses (user_id);
