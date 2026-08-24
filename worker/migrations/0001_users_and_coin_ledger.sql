-- Users and their coin balance (replaces the old USER_PROFILES KV namespace).
--
-- The ledger is the source of truth for the balance; users.coins is a materialized total so we
-- don't SUM the whole ledger every time someone opens their profile. If the two ever disagree,
-- trust the ledger and recalculate.

CREATE TABLE IF NOT EXISTS users (
  user_id     TEXT PRIMARY KEY,          -- LINE userId only, no other PII
  coins       INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coin_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(user_id),
  delta       INTEGER NOT NULL,          -- positive = earned, negative = spent
  reason      TEXT NOT NULL,             -- PARKING_REPORT | FEEDBACK | SAVE_CAR | SHOP_REDEEM
  ref_id      TEXT NOT NULL,             -- double-claim guard (see the UNIQUE index below)
  balance_after INTEGER NOT NULL,        -- balance after this entry, so a drift can be traced back
  created_at  TEXT NOT NULL
);

-- This is what prevents double claims: the database rejects them, rather than an if-statement in
-- application code that we hope covers every entry point.
--   FEEDBACK       ref_id = 'once'         -> claimable once, ever
--   SAVE_CAR       ref_id = '2026-08-23'   -> once per day (Bangkok date)
--   PARKING_REPORT ref_id = report id      -> one report, one grant
--   SHOP_REDEEM    ref_id = redemption id  -> tapping repeatedly still deducts once
CREATE UNIQUE INDEX IF NOT EXISTS idx_coin_ledger_dedupe
  ON coin_ledger (user_id, reason, ref_id);

CREATE INDEX IF NOT EXISTS idx_coin_ledger_user_time
  ON coin_ledger (user_id, created_at DESC);

-- Courses the student saved (replaces the old STUDENT_SCHEDULES KV namespace).
-- The UNIQUE constraint prevents duplicate courses, which KV could not do because every key was a
-- freshly generated uuid.
CREATE TABLE IF NOT EXISTS user_courses (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(user_id),
  course_code  TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (user_id, course_code)
);

CREATE INDEX IF NOT EXISTS idx_user_courses_user ON user_courses (user_id);
