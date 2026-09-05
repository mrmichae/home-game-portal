-- migrate-with-foreign-keys-off
-- SQLite cannot widen a CHECK constraint in place. Rebuild only the Editions
-- table while foreign-key enforcement is temporarily disabled by the runner;
-- all child references continue to target the replacement table by name.
CREATE TABLE editions_v2 (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  platform_key TEXT NOT NULL CHECK (platform_key IN ('nes', 'snes')),
  preferred INTEGER NOT NULL DEFAULT 1 CHECK (preferred IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

INSERT INTO editions_v2(id, game_id, platform_key, preferred, active)
SELECT id, game_id, platform_key, preferred, active FROM editions;

DROP TABLE editions;
ALTER TABLE editions_v2 RENAME TO editions;

UPDATE library_sources SET name = 'Game Library' WHERE id = 1;

UPDATE browse_rows
SET title = 'All Games', updated_at = '2026-09-04T00:00:00.000Z'
WHERE id = 'nintendo-entertainment-system'
  AND title = 'Nintendo Entertainment System'
  AND source_type = 'all';

UPDATE emulator_profiles
SET enabled = 1,
    web_adapter_key = 'emulatorjs',
    web_core_key = 'snes9x',
    updated_at = '2026-09-04T00:00:00.000Z'
WHERE platform_key = 'snes';
