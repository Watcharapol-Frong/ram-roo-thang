-- คำถามที่ระบบตอบไม่ได้ — เก็บไว้เป็น backlog ว่าควรเติม alias หรือข้อมูลอะไรต่อ
--
-- ตอนนี้เวลามีคนถามแล้วบอทตอบไม่ตรง เราไม่มีทางรู้เลยนอกจากผู้ใช้มาบอกเอง (ซึ่งเคสในแชท
-- เรื่องขั้นตอนใบเช็คเกรดก็รู้ได้เพราะบังเอิญมีคนแคปหน้าจอมาให้ดู) ตารางนี้ทำให้เห็นเองว่า
-- คนถามอะไรแล้วเราตอบไม่ได้บ้าง โดยไม่ต้องรอ feedback
--
-- เขียนเฉพาะตอนที่ "ไม่รู้จะตอบยังไงจริงๆ" เท่านั้น ไม่ใช่ทุกข้อความ ปริมาณจึงน้อยมาก
-- ไม่เก็บ user_id — ไม่มีอะไรในตารางนี้ต้องรู้ว่าใครถาม และข้อความถูกกรอง PII มาก่อนแล้ว
CREATE TABLE IF NOT EXISTS unanswered_queries (
  id         TEXT PRIMARY KEY,
  message    TEXT NOT NULL,
  intent     TEXT,           -- intent ที่จับได้ (ถ้าจับได้) เช่น STEPS/DOCUMENTS
  focus_id   TEXT,           -- เรื่องที่กำลังคุยตอนนั้น (ถ้ามี)
  reason     TEXT NOT NULL,  -- NO_MATCH | INTENT_NO_DATA
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_unanswered_created ON unanswered_queries (created_at DESC);
