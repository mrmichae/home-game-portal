CREATE TABLE IF NOT EXISTS metadata_matches (
  game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  provider_key TEXT NOT NULL,
  provider_game_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  release_year INTEGER NOT NULL,
  description TEXT NOT NULL,
  genres_json TEXT NOT NULL,
  series_name TEXT,
  cover_url TEXT,
  matched_at TEXT NOT NULL
);
