-- Class timetable (the ม.ร.30 lecture schedule). Reference data for the whole university, not
-- per student.
--
-- Lives in D1 rather than the worker bundle because it has to join against user_courses to answer
-- "what does this student have today". Bundled, we would pull all 3,400 rows into JS and filter
-- them on every cron run.
--
-- A course can open several sections (SEC.), each meeting on different days in different rooms —
-- 127 courses are like this. We only know which course the student saved, not which section, so the
-- section is stored here for when we do.
CREATE TABLE IF NOT EXISTS class_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  course_code   TEXT NOT NULL,
  section       INTEGER,                -- NULL = single-section course, no SEC. printed
  day           TEXT NOT NULL,          -- M | TU | W | TH | F | S | SU
  start_time    TEXT NOT NULL,          -- '08:30'
  end_time      TEXT NOT NULL,          -- '11:00'
  room          TEXT,
  building_code TEXT,                   -- split out of the room name for the Go button; NULL = not navigable
  term          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_class_sessions_course ON class_sessions (course_code);
CREATE INDEX IF NOT EXISTS idx_class_sessions_day ON class_sessions (day);

-- The section the student picked for a course. May stay NULL, which means we don't know it yet.
ALTER TABLE user_courses ADD COLUMN section INTEGER;
