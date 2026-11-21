-- Switch every existing crossing to OpenBoards-first operation.
-- Mobilithek remains the fallback in the live status pipeline.
-- This intentionally normalizes all previous per-crossing modes, including
-- records that were still set to the legacy 'mobilithek' default.
UPDATE crossings
SET train_source_mode = 'hybrid';
