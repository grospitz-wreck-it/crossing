-- ============================================================
-- Crossings – Migration 004
-- Anonymous prediction quality feedback
-- ============================================================

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS prediction_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prediction_id TEXT NOT NULL,
  crossing_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prediction_feedback_prediction
  ON prediction_feedback(prediction_id);

CREATE INDEX IF NOT EXISTS idx_prediction_feedback_crossing_created
  ON prediction_feedback(crossing_id, created_at);

COMMIT;
