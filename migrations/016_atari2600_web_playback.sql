-- migrate-with-foreign-keys-off
-- SQLite cannot widen a CHECK constraint in place. Rebuild Editions while
-- foreign-key enforcement is temporarily disabled by the migration runner.
CREATE TABLE editions_v3 (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  platform_key TEXT NOT NULL CHECK (platform_key IN ('nes', 'snes', 'atari2600')),
  preferred INTEGER NOT NULL DEFAULT 1 CHECK (preferred IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

INSERT INTO editions_v3(id, game_id, platform_key, preferred, active)
SELECT id, game_id, platform_key, preferred, active FROM editions;

DROP TABLE editions;
ALTER TABLE editions_v3 RENAME TO editions;

UPDATE emulator_profiles
SET enabled = 1,
    web_adapter_key = 'emulatorjs',
    web_core_key = 'stella2014',
    updated_at = '2026-09-11T00:00:00.000Z'
WHERE platform_key = 'atari2600';
