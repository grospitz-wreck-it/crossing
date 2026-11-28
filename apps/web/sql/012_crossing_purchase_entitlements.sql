-- One-time purchase entitlements for additional saved crossings.
-- The offer stays hidden until premium_enabled is explicitly enabled in production.
--
-- IMPORTANT:
-- "users.status" remains the technical account state (active/suspended/deleted).
-- "users.plan" is an older free/plus/pro field and is intentionally not reused.
-- The effective crossing tier (free/premium) is exposed by the summary view below.
-- Each purchase keeps its own expiry and its own three reminder records.

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

-- One queue row per reminder and purchase.
-- The mail/notification worker must send pending rows whose scheduled_at <= now.
CREATE TABLE IF NOT EXISTS user_crossing_purchase_reminders (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  reminder_type TEXT NOT NULL
    CHECK (reminder_type IN ('one_month', 'one_week', 'one_day')),
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  sent_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (purchase_id) REFERENCES user_crossing_purchases(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (purchase_id, reminder_type)
);

CREATE INDEX IF NOT EXISTS idx_crossing_purchase_reminders_due
  ON user_crossing_purchase_reminders (status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_crossing_purchase_reminders_user
  ON user_crossing_purchase_reminders (user_id, status);

-- When Stripe confirms payment, create the three reminder jobs automatically.
-- "One month" uses a calendar-month offset; the other offsets are seven and one day.
CREATE TRIGGER IF NOT EXISTS trg_crossing_purchase_schedule_reminders
AFTER UPDATE OF status, valid_until ON user_crossing_purchases
WHEN NEW.status = 'paid'
  AND NEW.valid_until IS NOT NULL
  AND (
    OLD.status <> 'paid'
    OR COALESCE(OLD.valid_until, '') <> COALESCE(NEW.valid_until, '')
  )
BEGIN
  INSERT OR IGNORE INTO user_crossing_purchase_reminders (
    id, purchase_id, user_id, reminder_type, scheduled_at
  ) VALUES (
    lower(hex(randomblob(16))),
    NEW.id,
    NEW.user_id,
    'one_month',
    datetime(NEW.valid_until, '-1 month')
  );

  INSERT OR IGNORE INTO user_crossing_purchase_reminders (
    id, purchase_id, user_id, reminder_type, scheduled_at
  ) VALUES (
    lower(hex(randomblob(16))),
    NEW.id,
    NEW.user_id,
    'one_week',
    datetime(NEW.valid_until, '-7 days')
  );

  INSERT OR IGNORE INTO user_crossing_purchase_reminders (
    id, purchase_id, user_id, reminder_type, scheduled_at
  ) VALUES (
    lower(hex(randomblob(16))),
    NEW.id,
    NEW.user_id,
    'one_day',
    datetime(NEW.valid_until, '-1 day')
  );
END;

-- If a paid purchase is subsequently refunded, unsent reminders are cancelled.
CREATE TRIGGER IF NOT EXISTS trg_crossing_purchase_cancel_reminders
AFTER UPDATE OF status ON user_crossing_purchases
WHEN NEW.status IN ('refunded', 'failed')
BEGIN
  UPDATE user_crossing_purchase_reminders
  SET status = 'cancelled',
      updated_at = datetime('now')
  WHERE purchase_id = NEW.id
    AND status = 'pending';
END;

-- Backfill reminder jobs for purchases which may already have been paid
-- before this migration was applied. INSERT OR IGNORE keeps the script rerunnable.
INSERT OR IGNORE INTO user_crossing_purchase_reminders (
  id, purchase_id, user_id, reminder_type, scheduled_at
)
SELECT lower(hex(randomblob(16))), id, user_id, 'one_month', datetime(valid_until, '-1 month')
FROM user_crossing_purchases
WHERE status = 'paid' AND valid_until IS NOT NULL
UNION ALL
SELECT lower(hex(randomblob(16))), id, user_id, 'one_week', datetime(valid_until, '-7 days')
FROM user_crossing_purchases
WHERE status = 'paid' AND valid_until IS NOT NULL
UNION ALL
SELECT lower(hex(randomblob(16))), id, user_id, 'one_day', datetime(valid_until, '-1 day')
FROM user_crossing_purchases
WHERE status = 'paid' AND valid_until IS NOT NULL;

-- Live, derived account tier and active slot balance.
-- Expired packages automatically stop contributing slots without a daily status job.
CREATE VIEW IF NOT EXISTS user_crossing_entitlement_summary AS
SELECT
  u.id AS user_id,
  CASE
    WHEN COALESCE((
      SELECT SUM(p.package_slots)
      FROM user_crossing_purchases p
      WHERE p.user_id = u.id
        AND p.status = 'paid'
        AND p.valid_until IS NOT NULL
        AND julianday(p.valid_until) > julianday('now')
    ), 0) > 0 THEN 'premium'
    ELSE 'free'
  END AS account_tier,
  COALESCE((
    SELECT SUM(p.package_slots)
    FROM user_crossing_purchases p
    WHERE p.user_id = u.id
      AND p.status = 'paid'
      AND p.valid_until IS NOT NULL
      AND julianday(p.valid_until) > julianday('now')
  ), 0) AS purchased_slots,
  sc.free_crossing_limit AS free_crossing_limit,
  sc.free_crossing_limit + COALESCE((
    SELECT SUM(p.package_slots)
    FROM user_crossing_purchases p
    WHERE p.user_id = u.id
      AND p.status = 'paid'
      AND p.valid_until IS NOT NULL
      AND julianday(p.valid_until) > julianday('now')
  ), 0) AS max_crossings,
  (
    SELECT MIN(p.valid_until)
    FROM user_crossing_purchases p
    WHERE p.user_id = u.id
      AND p.status = 'paid'
      AND p.valid_until IS NOT NULL
      AND julianday(p.valid_until) > julianday('now')
  ) AS next_expiration_at,
  (
    SELECT MAX(p.valid_until)
    FROM user_crossing_purchases p
    WHERE p.user_id = u.id
      AND p.status = 'paid'
      AND p.valid_until IS NOT NULL
      AND julianday(p.valid_until) > julianday('now')
  ) AS latest_expiration_at
FROM users u
LEFT JOIN subscription_config sc ON sc.id = 1;
