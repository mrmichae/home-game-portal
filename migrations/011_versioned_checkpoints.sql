CREATE TABLE IF NOT EXISTS save_checkpoints (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  player_key TEXT NOT NULL REFERENCES player_profiles(profile_key) ON DELETE CASCADE,
  adapter_key TEXT NOT NULL,
  core_key TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  rom_content_hash TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation > 0),
  status TEXT NOT NULL CHECK (status IN ('candidate', 'verified', 'failed', 'superseded')),
  relative_path TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  state_sha256 TEXT NOT NULL,
  captured_frame INTEGER NOT NULL CHECK (captured_frame >= 0),
  created_at TEXT NOT NULL,
  verified_at TEXT,
  failed_at TEXT,
  failure_reason TEXT,
  UNIQUE (edition_id, player_key, adapter_key, core_key, runtime_version, generation)
);

CREATE INDEX IF NOT EXISTS save_checkpoints_resume
  ON save_checkpoints(
    edition_id, player_key, adapter_key, core_key, runtime_version,
    status, generation DESC
  );
