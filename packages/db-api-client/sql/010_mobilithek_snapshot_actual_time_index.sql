-- Supports the bounded time-window reads used by primary and through
-- snapshot consumers. Safe to apply repeatedly.
CREATE INDEX IF NOT EXISTS idx_mobilithek_train_snapshot_actual_time
  ON mobilithek_train_snapshot(actual_time);
