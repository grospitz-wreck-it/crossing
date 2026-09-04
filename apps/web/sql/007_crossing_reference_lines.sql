-- Crossings – Migration 007
-- Cheap, explicit reference lines for train-to-crossing matching.
ALTER TABLE crossings ADD COLUMN reference_lines TEXT NOT NULL DEFAULT '[]';
