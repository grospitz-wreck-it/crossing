-- ============================================================
-- Crossings – Migration 002
-- User / Crossing / Billing Foundation
-- ============================================================

PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;


-- ============================================================
-- 1. GLOBALE SCHRANKEN
-- ============================================================

CREATE TABLE crossings (
  id TEXT PRIMARY KEY,

  name TEXT NOT NULL,
  eva TEXT NOT NULL,

  observation_evas TEXT NOT NULL,
  required_route_stops TEXT NOT NULL,

  lat REAL NOT NULL,
  lon REAL NOT NULL,

  close_offset_seconds INTEGER NOT NULL,
  open_offset_seconds INTEGER NOT NULL,

  rules TEXT,
  through_rules TEXT,
  diversion_rules TEXT,
  reroute_watch_rules TEXT,

  confidence REAL NOT NULL DEFAULT 0.5,

  source TEXT NOT NULL DEFAULT 'seed'
    CHECK (source IN ('seed', 'submission', 'manual')),

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);


-- ============================================================
-- 2. USERS
-- ============================================================

CREATE TABLE users (
  id TEXT PRIMARY KEY,

  email TEXT UNIQUE,
  display_name TEXT,

  plan TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'plus', 'pro')),

  role TEXT NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'editor', 'admin')),

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'deleted')),

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);


-- ============================================================
-- 3. AUTH ACCOUNTS
--
-- Vorbereitung für OAuth / Auth.js.
--
-- provider:
--   apple
--   google
--
-- E-Mail/Magic-Link bekommt später eine eigene
-- Verification-Token-Struktur und wird NICHT als
-- provider='email' hier hineingepresst.
-- ============================================================

CREATE TABLE auth_accounts (
  id TEXT PRIMARY KEY,

  user_id TEXT NOT NULL,

  type TEXT NOT NULL DEFAULT 'oauth',

  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,

  refresh_token TEXT,
  access_token TEXT,
  expires_at INTEGER,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  session_state TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  UNIQUE(provider, provider_account_id)
);

CREATE INDEX idx_auth_accounts_user_id
  ON auth_accounts(user_id);


-- ============================================================
-- 4. USER SESSIONS
--
-- Noch nicht von Auth.js verwendet.
-- Wird für die spätere Auth-Integration vorbereitet.
-- ============================================================

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,

  session_token TEXT NOT NULL UNIQUE,

  user_id TEXT NOT NULL,

  expires_at TEXT NOT NULL,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);

CREATE INDEX idx_auth_sessions_user_id
  ON auth_sessions(user_id);


-- ============================================================
-- 5. VERIFICATION TOKENS
--
-- Für Magic Link / E-Mail-Login.
-- ============================================================

CREATE TABLE auth_verification_tokens (
  identifier TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,

  PRIMARY KEY (identifier, token)
);


-- ============================================================
-- 6. USER <-> CROSSING
-- ============================================================

CREATE TABLE user_crossings (
  id TEXT PRIMARY KEY,

  user_id TEXT NOT NULL,
  crossing_id TEXT NOT NULL,

  label TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,

  notifications_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (notifications_enabled IN (0, 1)),

  live_activity_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (live_activity_enabled IN (0, 1)),

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  FOREIGN KEY (crossing_id)
    REFERENCES crossings(id)
    ON DELETE CASCADE,

  UNIQUE(user_id, crossing_id)
);

CREATE INDEX idx_user_crossings_user_id
  ON user_crossings(user_id);

CREATE INDEX idx_user_crossings_crossing_id
  ON user_crossings(crossing_id);


-- ============================================================
-- 7. USER SETTINGS
-- ============================================================

CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY,

  notifications_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (notifications_enabled IN (0, 1)),

  default_crossing_id TEXT,

  distance_unit TEXT NOT NULL DEFAULT 'km'
    CHECK (distance_unit IN ('km', 'mi')),

  language TEXT NOT NULL DEFAULT 'de'
    CHECK (language IN ('de', 'en')),

  theme TEXT NOT NULL DEFAULT 'system'
    CHECK (theme IN ('system', 'light', 'dark')),

  live_activity_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (live_activity_enabled IN (0, 1)),

  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  FOREIGN KEY (default_crossing_id)
    REFERENCES crossings(id)
    ON DELETE SET NULL
);


-- ============================================================
-- 8. SUBSCRIPTIONS
-- ============================================================

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,

  user_id TEXT NOT NULL,

  provider TEXT NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe')),

  provider_customer_id TEXT,
  provider_subscription_id TEXT,

  plan TEXT NOT NULL
    CHECK (plan IN ('plus', 'pro')),

  status TEXT NOT NULL
    CHECK (
      status IN (
        'active',
        'past_due',
        'cancelled',
        'expired'
      )
    ),

  started_at TEXT,
  expires_at TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);

CREATE INDEX idx_subscriptions_user_id
  ON subscriptions(user_id);

CREATE UNIQUE INDEX idx_subscriptions_provider_subscription
  ON subscriptions(provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;


-- ============================================================
-- 9. SEED: KIRCHLENGERN
-- ============================================================

INSERT INTO crossings (
  id,
  name,
  eva,
  observation_evas,
  required_route_stops,
  lat,
  lon,
  close_offset_seconds,
  open_offset_seconds,
  rules,
  through_rules,
  diversion_rules,
  reroute_watch_rules,
  confidence,
  source,
  status
)
VALUES (
  'kirchlengern',
  'Kirchlengern',
  '8003288',

  '[
    "8003288",
    "8000059",
    "8000036",
    "8000152",
    "8000294"
  ]',

  '[
    "Osnabrück Hbf",
    "Bünde (Westf)",
    "Hannover Hbf"
  ]',

  52.196944,
  8.642139,

  80,
  20,

  '[
    {
      "platform": "2",
      "stopping": true,
      "openOffsetSeconds": 110
    },
    {
      "platform": "1",
      "stopping": true,
      "openOffsetSeconds": 0
    }
  ]',

  '[
    {
      "observationEva": "8000294",
      "observationStation": "Osnabrück Hbf",
      "categories": ["ICE"],
      "fallbackOffsetSeconds": 1500,
      "trackDistanceMeters": 0,
      "direction": "westbound"
    },
    {
      "observationEva": "8000059",
      "observationStation": "Bünde (Westf)",
      "categories": ["ICE"],
      "fallbackOffsetSeconds": 300,
      "trackDistanceMeters": 0,
      "direction": "westbound"
    },
    {
      "observationEva": "8000152",
      "observationStation": "Hannover Hbf",
      "categories": ["ICE"],
      "fallbackOffsetSeconds": 2400,
      "trackDistanceMeters": 0,
      "direction": "eastbound"
    }
  ]',

  '[
    {
      "observationEva": "8000036",
      "observationStation": "Bielefeld Hbf",
      "categories": ["ICE"],
      "anchorRouteStops": [
        "Osnabrück Hbf",
        "Hannover Hbf"
      ],
      "excludedRouteStop": "Bünde (Westf)"
    }
  ]',

  '[
    {
      "observationEva": "8000036",
      "observationStation": "Bielefeld Hbf",
      "categories": [
        "ICE",
        "IC",
        "RE"
      ],
      "crossingRouteNames": [
        "Kirchlengern"
      ],
      "fallbackOffsetSeconds": 1200,
      "direction": "unknown"
    }
  ]',

  0.85,
  'seed',
  'active'
);


COMMIT;