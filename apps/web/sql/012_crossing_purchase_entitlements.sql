-- One-time purchase entitlements for additional saved crossings.
-- The offer stays hidden until premium_enabled is explicitly enabled in production.

CREATE TABLE IF NOT EXISTS subscription_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  free_crossing_limit INTEGER NOT NULL DEFAULT 3 CHECK (free_crossing_limit > 0),
  premium_package_slots INTEGER NOT NULL DEFAULT 10 CHECK (premium_package_slots > 0),
  premium_package_price_cents INTEGER NOT NULL DEFAULT 500 CHECK (premium_package_price_cents > 0),
  premium_package_currency TEXT NOT NULL DEFAULT 'EUR',
  premium_package_duration_days INTEGER NOT NULL DEFAULT 365 CHECK (premium_package_duration_days > 0),
  premium_enabled INTEGER NOT NULL DEFAULT 0 CHECK (premium_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO subscription_config (
  id,
  free_crossing_limit,
  premium_package_slots,
  premium_package_price_cents,
  premium_package_currency,
  premium_package_duration_days,
  premium_enabled
) VALUES (1, 3, 10, 500, 'EUR', 365, 0);

CREATE TABLE IF NOT EXISTS user_crossing_purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  package_slots INTEGER NOT NULL CHECK (package_slots > 0),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  purchased_at TEXT,
  valid_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_crossing_purchases_active
  ON user_crossing_purchases (user_id, status, valid_until);

CREATE INDEX IF NOT EXISTS idx_user_crossing_purchases_session
  ON user_crossing_purchases (stripe_checkout_session_id);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  checkout_session_id TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_session
  ON stripe_webhook_events (checkout_session_id);
