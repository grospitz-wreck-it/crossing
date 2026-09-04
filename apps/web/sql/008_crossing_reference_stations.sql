-- Crossings – Migration 008
-- Explicit reference stations selected for a reference line.
-- Values are DB station EVAs stored as JSON for compatibility with the existing crossing model.
ALTER TABLE crossings ADD COLUMN reference_stations TEXT NOT NULL DEFAULT '[]';
