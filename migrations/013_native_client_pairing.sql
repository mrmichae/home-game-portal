CREATE TABLE IF NOT EXISTS portal_identity (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  server_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS client_devices (
  id TEXT PRIMARY KEY,
  credential_hash TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  app_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS device_pairing_requests (
  id TEXT PRIMARY KEY,
  poll_secret_hash TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  credential_hash TEXT NOT NULL,
  device_name TEXT NOT NULL,
  app_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'denied', 'expired')),
  device_id TEXT REFERENCES client_devices(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS device_pairing_requests_code
  ON device_pairing_requests(code_hash, state, expires_at);

