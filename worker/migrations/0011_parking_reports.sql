-- Crowdsourced parking reports, moved off KV.
--
-- KV held one key per zone (`latest:{zone_id}`) and every new report overwrote it, so the stored
-- status was always "whatever the last person to tap said". That has three problems the README
-- already documents for user data (see "Why user data is on D1 and not KV"), and they apply here
-- word for word:
--   1. A write is read-modify-write, so two people reporting the same lot at the same moment
--      silently lose one of the two reports.
--   2. KV cannot be queried, so there is no way to look at several reports and work out what most
--      people actually saw — only the newest one is reachable.
--   3. Reading more than the newest one would need `list`, which is the quota that took production
--      down on Aug 24, 2026. One row per report on D1 costs a query, not a list.
--
-- Rows are kept well past the aggregation window on purpose. Only recent ones decide the live
-- status, but the history is what a future time-of-day baseline would be built from, and throwing
-- it away every 30 minutes would make that impossible to add later.
--
-- No FOREIGN KEY to users: a report is written before the reporter has any coin activity, so the
-- user row may not exist yet, and a report stays meaningful even if the user row is later removed.
CREATE TABLE IF NOT EXISTS parking_reports (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id          TEXT NOT NULL,
  status           TEXT NOT NULL,          -- GREEN | YELLOW | RED (crowd density, not free/full)
  reporter_user_id TEXT NOT NULL,          -- LINE userId only, same as everywhere else
  reported_at      TEXT NOT NULL           -- ISO 8601 UTC
);

-- Serves the single-zone lookup (chat answers, one building's nearest lot).
CREATE INDEX IF NOT EXISTS idx_parking_reports_zone_time
  ON parking_reports (zone_id, reported_at DESC);

-- Serves the all-zones map load, which reads every zone's recent reports in one query rather than
-- one query per zone.
CREATE INDEX IF NOT EXISTS idx_parking_reports_time
  ON parking_reports (reported_at DESC);
