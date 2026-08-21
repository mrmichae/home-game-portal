CREATE TABLE IF NOT EXISTS metadata_corrections (
  game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  display_name TEXT,
  release_year INTEGER,
  description TEXT,
  genres_json TEXT,
  series_name TEXT,
  cover_url TEXT,
  updated_at TEXT NOT NULL
);
