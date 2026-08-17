-- Run once in the Turso database.
-- Context EVAs are nearby major rail hubs (e.g. Hbf/ICE nodes) used as
-- additional context for the existing through-train/prediction pipeline.
ALTER TABLE crossings ADD COLUMN context_evas TEXT NOT NULL DEFAULT '[]';
