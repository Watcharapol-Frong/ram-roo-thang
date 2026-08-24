-- ตารางเรียน (ตารางบรรยาย ม.ร.30) — ข้อมูลอ้างอิงของทั้งมหาวิทยาลัย ไม่ใช่ของรายคน
--
-- อยู่ใน D1 ไม่ใช่ bundle เพราะต้อง join กับ user_courses ตอนสรุปว่า "วันนี้ผู้ใช้คนนี้เรียนอะไร"
-- ถ้า bundle ไว้ต้องดึงทั้งก้อน 3,400 แถวมากรองใน JS ทุกครั้งที่ cron ทำงาน
--
-- วิชาหนึ่งเปิดได้หลายกลุ่ม (SEC.) แต่ละกลุ่มเรียนคนละวันคนละห้อง — 127 วิชาเป็นแบบนี้
-- ระบบรู้แค่รหัสวิชาที่ผู้ใช้บันทึก ยังไม่รู้ว่าเขาอยู่กลุ่มไหน จึงต้องเก็บ section ไว้ให้ครบก่อน
CREATE TABLE IF NOT EXISTS class_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  course_code   TEXT NOT NULL,
  section       INTEGER,                -- NULL = วิชาที่เปิดกลุ่มเดียว ไม่ได้ระบุ SEC.
  day           TEXT NOT NULL,          -- M | TU | W | TH | F | S | SU
  start_time    TEXT NOT NULL,          -- '08:30'
  end_time      TEXT NOT NULL,          -- '11:00'
  room          TEXT,
  building_code TEXT,                   -- แยกจากชื่อห้องไว้ผูกปุ่มนำทาง NULL = นำทางไม่ได้
  term          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_class_sessions_course ON class_sessions (course_code);
CREATE INDEX IF NOT EXISTS idx_class_sessions_day ON class_sessions (day);

-- กลุ่มเรียนที่ผู้ใช้เลือกไว้ต่อวิชา — ว่างไว้ได้ ถ้าไม่เลือกจะถือว่ายังไม่รู้กลุ่ม
ALTER TABLE user_courses ADD COLUMN section INTEGER;
