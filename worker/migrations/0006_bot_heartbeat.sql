-- Evidence that the bot actually did work recently, which is a different question from whether the
-- worker answers HTTP.
--
-- The incident that made this necessary: the secrets vanished from the worker, so every webhook was
-- answered 401/500. The worker itself looked perfectly healthy while the bot was completely silent.
-- A plain ping cannot catch that; you have to know when a LINE event was last processed end to end.
--
-- One row per event kind (webhook / cron / webhook_error), not one row per occurrence, because we
-- only need "when did this last happen". Appending every event would mean writing to D1 for every
-- message anyone sends, for data we never read back.
CREATE TABLE IF NOT EXISTS bot_heartbeat (
  kind    TEXT PRIMARY KEY,
  last_at TEXT NOT NULL,
  detail  TEXT
);
