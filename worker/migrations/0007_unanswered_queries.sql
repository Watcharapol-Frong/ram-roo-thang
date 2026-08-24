-- Questions the system could not answer, kept as a backlog of aliases or data still worth adding.
--
-- Today, when the bot answers badly, we only find out if a user tells us. The check-grade case was
-- caught only because someone happened to screenshot it. This table surfaces the gaps on its own,
-- without waiting for feedback.
--
-- Only written when we genuinely had no answer, not for every message, so the volume stays tiny.
-- No user_id: nothing here needs to know who asked, and the text has already been PII-scrubbed.
CREATE TABLE IF NOT EXISTS unanswered_queries (
  id         TEXT PRIMARY KEY,
  message    TEXT NOT NULL,
  intent     TEXT,           -- detected intent, if any, e.g. STEPS/DOCUMENTS
  focus_id   TEXT,           -- what the conversation was focused on at the time, if anything
  reason     TEXT NOT NULL,  -- NO_MATCH | INTENT_NO_DATA
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_unanswered_created ON unanswered_queries (created_at DESC);
