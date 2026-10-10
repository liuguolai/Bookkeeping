CREATE TABLE IF NOT EXISTS sync_vaults (
  id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  payload TEXT,
  updated_at INTEGER NOT NULL
);
