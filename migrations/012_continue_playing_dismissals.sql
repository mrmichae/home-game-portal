CREATE TABLE IF NOT EXISTS continue_playing_dismissals (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_key TEXT NOT NULL REFERENCES player_profiles(profile_key) ON DELETE CASCADE,
  dismissed_at TEXT NOT NULL,
  PRIMARY KEY (game_id, player_key)
);
