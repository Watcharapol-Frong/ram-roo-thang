-- Exam rooms supplied by the students themselves.
--
-- The university does not publish exam rooms as a dataset. They are released close to the exam week
-- and are per-student, through e-Service, so we cannot fetch them ourselves. Students send a photo of
-- their own schedule and a vision model reads it.
ALTER TABLE user_courses ADD COLUMN room TEXT;
ALTER TABLE user_courses ADD COLUMN room_source TEXT;      -- OCR | MANUAL
ALTER TABLE user_courses ADD COLUMN room_updated_at TEXT;

-- OCR results waiting for the student to confirm.
--
-- Never write straight into user_courses. OCR can be wrong, and wrong here means someone walks to
-- the wrong exam room, so the last decision always belongs to a person. This table parks the result
-- while we wait for that tap.
-- LINE caps postback payload length, so the button carries only the draft id, not the whole result.
CREATE TABLE IF NOT EXISTS room_import_drafts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  items      TEXT NOT NULL,          -- JSON: [{course_code, room, exam_date, period}]
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_room_drafts_user ON room_import_drafts (user_id, created_at DESC);
