CREATE TABLE IF NOT EXISTS custom_collections (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS custom_collection_games (
  collection_id TEXT NOT NULL REFERENCES custom_collections(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (collection_id, game_id)
);

CREATE INDEX IF NOT EXISTS custom_collection_games_order
  ON custom_collection_games(collection_id, position);

CREATE TABLE IF NOT EXISTS browse_rows (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('all', 'continue', 'favorites', 'recent', 'genres', 'collection')),
  source_value TEXT,
  position INTEGER NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO browse_rows(id, title, source_type, source_value, position, created_at, updated_at) VALUES
  ('continue-playing', 'Continue Playing', 'continue', NULL, 10, '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z'),
  ('favorites', 'Favorites', 'favorites', NULL, 20, '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z'),
  ('recently-played', 'Recently Played', 'recent', NULL, 30, '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z'),
  ('nintendo-entertainment-system', 'Nintendo Entertainment System', 'all', NULL, 40, '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z'),
  ('action-platforming', 'Action & Platforming', 'genres', 'Action|Platformer|Beat ''em up|Arcade', 50, '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z'),
  ('adventures-strategy', 'Adventures & Strategy', 'genres', 'Adventure|RPG|Puzzle|Strategy', 60, '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z'),
  ('sports-competition', 'Sports & Competition', 'genres', 'Sports|Racing|Wrestling|Fighting|Multiplayer', 70, '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z');
