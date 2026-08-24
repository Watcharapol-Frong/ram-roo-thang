-- Record of exam alerts already sent.
--
-- Cloudflare crons are not exactly-once, and we can also fire the job by hand from the admin
-- endpoint. Without this guard a student would get the same message twice, which is annoying and
-- burns the LINE Official Account's limited message quota for nothing.
-- Same approach as coin_ledger: let UNIQUE reject the duplicate instead of checking in code.
CREATE TABLE IF NOT EXISTS exam_alerts_sent (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  exam_date  TEXT NOT NULL,          -- the exam date being announced (YYYY-MM-DD)
  kind       TEXT NOT NULL,          -- DAY_BEFORE
  courses    TEXT NOT NULL,          -- comma-separated course codes in the message, for auditing
  sent_at    TEXT NOT NULL,
  UNIQUE (user_id, exam_date, kind)
);

CREATE INDEX IF NOT EXISTS idx_exam_alerts_date ON exam_alerts_sent (exam_date);
