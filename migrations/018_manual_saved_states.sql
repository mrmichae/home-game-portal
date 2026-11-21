CREATE TABLE IF NOT EXISTS manual_saved_states (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  player_key TEXT NOT NULL REFERENCES player_profiles(profile_key) ON DELETE CASCADE,
  format_key TEXT NOT NULL,
  rom_content_hash TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  state_sha256 TEXT NOT NULL,
  captured_frame INTEGER NOT NULL CHECK (captured_frame >= 0),
  label TEXT,
  thumbnail_relative_path TEXT,
  thumbnail_content_type TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS manual_saved_states_game_profile
  ON manual_saved_states(edition_id, player_key, created_at DESC);
