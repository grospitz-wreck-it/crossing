-- ============================================================
-- Crossings – Migration 003
-- Auth.js / Drizzle Adapter Schema
-- ============================================================

BEGIN TRANSACTION;

-- ------------------------------------------------------------
-- Users um Auth.js-relevante Felder erweitern
-- ------------------------------------------------------------

ALTER TABLE users ADD COLUMN name TEXT;
ALTER TABLE users ADD COLUMN email_verified TEXT;
ALTER TABLE users ADD COLUMN image TEXT;


-- ------------------------------------------------------------
-- Auth Accounts
-- ------------------------------------------------------------

DROP TABLE IF EXISTS auth_accounts;

CREATE TABLE auth_accounts (
  id TEXT PRIMARY KEY,

  user_id TEXT NOT NULL,

  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,

  refresh_token TEXT,
  access_token TEXT,
  expires_at INTEGER,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  session_state TEXT,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  UNIQUE(provider, provider_account_id)
);

CREATE INDEX idx_auth_accounts_user_id
  ON auth_accounts(user_id);


-- ------------------------------------------------------------
-- Sessions
-- ------------------------------------------------------------

DROP TABLE IF EXISTS auth_sessions;

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,

  session_token TEXT NOT NULL UNIQUE,

  user_id TEXT NOT NULL,

  expires_at TEXT NOT NULL,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);

CREATE INDEX idx_auth_sessions_user_id
  ON auth_sessions(user_id);


-- ------------------------------------------------------------
-- Verification Tokens
-- ------------------------------------------------------------

DROP TABLE IF EXISTS auth_verification_tokens;

CREATE TABLE auth_verification_tokens (
  identifier TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,

  PRIMARY KEY (identifier, token)
);

COMMIT;