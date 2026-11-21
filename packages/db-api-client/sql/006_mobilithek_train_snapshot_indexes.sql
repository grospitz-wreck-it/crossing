-- Performance indexes for the demand-driven Mobilithek snapshot reader.
-- The status endpoint filters and sorts by actual_time on every request.
-- Without this index SQLite/Turso can scan and sort the whole snapshot table.
CREATE INDEX IF NOT EXISTS idx_mobilithek_train_snapshot_actual_time
  ON mobilithek_train_snapshot(actual_time);
