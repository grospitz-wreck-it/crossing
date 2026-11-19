-- Per-crossing train data source selection.
-- Existing crossings keep the legacy Mobilithek behavior by default.
ALTER TABLE crossings
  ADD COLUMN train_source_mode TEXT NOT NULL DEFAULT 'mobilithek'
  CHECK (train_source_mode IN ('openboards', 'mobilithek', 'hybrid'));
