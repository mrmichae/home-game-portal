CREATE TABLE IF NOT EXISTS checkpoint_lineages (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  player_key TEXT NOT NULL REFERENCES player_profiles(profile_key) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  archived_at TEXT,
  retain_until TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS checkpoint_lineages_active
  ON checkpoint_lineages(edition_id, player_key) WHERE state = 'active';

INSERT OR IGNORE INTO checkpoint_lineages(id, edition_id, player_key, state, created_at)
SELECT 'legacy:' || edition_id || ':' || player_key,
       edition_id,
       player_key,
       'active',
       MIN(created_at)
FROM save_checkpoints
GROUP BY edition_id, player_key;

CREATE TABLE save_checkpoints_v2 (
  id TEXT PRIMARY KEY,
  lineage_id TEXT NOT NULL REFERENCES checkpoint_lineages(id) ON DELETE CASCADE,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  player_key TEXT NOT NULL REFERENCES player_profiles(profile_key) ON DELETE CASCADE,
  format_key TEXT NOT NULL,
  origin_adapter_key TEXT NOT NULL,
  origin_client_version TEXT NOT NULL,
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
  UNIQUE (lineage_id, format_key, generation)
);

INSERT INTO save_checkpoints_v2(
  id, lineage_id, edition_id, player_key, format_key, origin_adapter_key,
  origin_client_version, rom_content_hash, generation, status, relative_path,
  byte_size, state_sha256, captured_frame, created_at, verified_at, failed_at,
  failure_reason
)
SELECT id,
       'legacy:' || edition_id || ':' || player_key,
       edition_id,
       player_key,
       adapter_key || ':' || core_key || ':' || runtime_version,
       adapter_key,
       runtime_version,
       rom_content_hash,
       generation,
       status,
       relative_path,
       byte_size,
       state_sha256,
       captured_frame,
       created_at,
       verified_at,
       failed_at,
       failure_reason
FROM save_checkpoints;

DROP TABLE save_checkpoints;
ALTER TABLE save_checkpoints_v2 RENAME TO save_checkpoints;

CREATE INDEX save_checkpoints_resume_v2
  ON save_checkpoints(
    edition_id, player_key, format_key, status, generation DESC
  );

CREATE TABLE IF NOT EXISTS checkpoint_restore_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checkpoint_id TEXT NOT NULL REFERENCES save_checkpoints(id) ON DELETE CASCADE,
  device_id TEXT REFERENCES client_devices(id) ON DELETE SET NULL,
  client_version TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('verified', 'failed')),
  observed_frame INTEGER,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playback_leases (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  player_key TEXT NOT NULL REFERENCES player_profiles(profile_key) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES client_devices(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('active', 'released', 'revoked', 'expired')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  started_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS playback_leases_active
  ON playback_leases(game_id, player_key) WHERE state = 'active';

CREATE INDEX IF NOT EXISTS playback_leases_device
  ON playback_leases(device_id, state, expires_at);

