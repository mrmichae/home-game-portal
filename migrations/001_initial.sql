CREATE TABLE IF NOT EXISTS library_sources (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  platform_key TEXT NOT NULL CHECK (platform_key = 'nes'),
  last_scanned_at TEXT
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  added_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS editions (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  platform_key TEXT NOT NULL CHECK (platform_key = 'nes'),
  preferred INTEGER NOT NULL DEFAULT 1 CHECK (preferred IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS game_files (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  library_source_id INTEGER NOT NULL REFERENCES library_sources(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  modified_at_ms INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  UNIQUE(library_source_id, relative_path)
);

CREATE INDEX IF NOT EXISTS game_files_active_edition
  ON game_files(active, edition_id);

CREATE TABLE IF NOT EXISTS saves (
  edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  player_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('state')),
  relative_path TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (edition_id, player_key, kind)
);
