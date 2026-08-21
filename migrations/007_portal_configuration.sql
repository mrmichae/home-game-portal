UPDATE library_sources SET root_path = '/roms' WHERE root_path = '/library';

CREATE TABLE IF NOT EXISTS emulator_profiles (
  platform_key TEXT PRIMARY KEY,
  platform_name TEXT NOT NULL,
  capability_key TEXT NOT NULL,
  policy_key TEXT NOT NULL CHECK (policy_key = 'platform-default'),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  web_adapter_key TEXT,
  web_core_key TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO emulator_profiles(
  platform_key, platform_name, capability_key, policy_key,
  enabled, web_adapter_key, web_core_key, updated_at
) VALUES
  ('nes', 'Nintendo Entertainment System', 'nes', 'platform-default', 1, 'emulatorjs', 'fceumm', '2026-08-18T00:00:00.000Z'),
  ('snes', 'Super Nintendo Entertainment System', 'snes', 'platform-default', 0, NULL, NULL, '2026-08-18T00:00:00.000Z'),
  ('atari2600', 'Atari 2600', 'atari2600', 'platform-default', 0, NULL, NULL, '2026-08-18T00:00:00.000Z');
