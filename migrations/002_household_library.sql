CREATE TABLE IF NOT EXISTS player_profiles (
  profile_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  is_administrator INTEGER NOT NULL DEFAULT 0 CHECK (is_administrator IN (0, 1)),
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO player_profiles(profile_key, display_name, is_administrator, created_at)
VALUES ('household', 'Household', 1, '2026-08-16T00:00:00.000Z');

CREATE TABLE IF NOT EXISTS favorites (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_key TEXT NOT NULL REFERENCES player_profiles(profile_key) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (game_id, player_key)
);

CREATE TABLE IF NOT EXISTS play_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  player_key TEXT NOT NULL REFERENCES player_profiles(profile_key) ON DELETE CASCADE,
  started_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS play_sessions_player_started
  ON play_sessions(player_key, started_at DESC);
