-- Prevents sending the daily digest twice, same idea as exam_alerts_sent.
-- Cloudflare crons are not exactly-once, and we can also fire the job by hand from the admin
-- endpoint.
CREATE TABLE IF NOT EXISTS daily_digest_sent (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  digest_date TEXT NOT NULL,        -- Bangkok date (YYYY-MM-DD)
  items      INTEGER NOT NULL,      -- how many items the message listed, for auditing
  sent_at    TEXT NOT NULL,
  UNIQUE (user_id, digest_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_digest_date ON daily_digest_sent (digest_date);
