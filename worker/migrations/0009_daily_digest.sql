-- กันส่งสรุปประจำวันซ้ำ — หลักการเดียวกับ exam_alerts_sent
-- cron ของ Cloudflare ไม่รับประกัน exactly-once และเรายิงมือได้จาก endpoint แอดมินด้วย
CREATE TABLE IF NOT EXISTS daily_digest_sent (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  digest_date TEXT NOT NULL,        -- วันที่ตามเวลาไทย (YYYY-MM-DD)
  items      INTEGER NOT NULL,      -- จำนวนรายการในข้อความ ไว้ตรวจย้อนหลัง
  sent_at    TEXT NOT NULL,
  UNIQUE (user_id, digest_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_digest_date ON daily_digest_sent (digest_date);
