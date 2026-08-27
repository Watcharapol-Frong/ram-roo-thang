-- Store user feedback responses on D1
CREATE TABLE IF NOT EXISTS user_feedback (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  device_os    TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_user ON user_feedback (user_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_created ON user_feedback (created_at DESC);
