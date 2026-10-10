CREATE TABLE IF NOT EXISTS sync_accounts (
  username TEXT PRIMARY KEY NOT NULL,
  vault_id TEXT UNIQUE NOT NULL REFERENCES sync_vaults(id),
  salt TEXT NOT NULL,
  verifier TEXT NOT NULL,
  wrapped_key TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at INTEGER NOT NULL
);
