CREATE TABLE customers (
  id TEXT PRIMARY KEY,

  name TEXT NOT NULL,

  company TEXT,

  email TEXT,

  phone TEXT,

  active INTEGER
    DEFAULT 1,

  created_at TEXT
);

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,

  customer_id TEXT NOT NULL,

  name TEXT NOT NULL,

  billing_model TEXT NOT NULL,

  cpm REAL,

  fixed_price REAL,

  priority INTEGER
    DEFAULT 1,

  active INTEGER
    DEFAULT 1,

  start_date TEXT,

  end_date TEXT,

  created_at TEXT
);

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,

  customer_id TEXT NOT NULL,

  name TEXT NOT NULL,

  billing_model TEXT NOT NULL,

  cpm REAL,

  fixed_price REAL,

  priority INTEGER
    DEFAULT 1,

  active INTEGER
    DEFAULT 1,

  start_date TEXT,

  end_date TEXT,

  created_at TEXT
);

CREATE TABLE creatives (
  id TEXT PRIMARY KEY,

  campaign_id TEXT NOT NULL,

  title TEXT,

  image_url TEXT NOT NULL,

  target_url TEXT NOT NULL,

  active INTEGER
    DEFAULT 1,

  created_at TEXT
);

CREATE TABLE campaign_crossings (
  id TEXT PRIMARY KEY,

  campaign_id TEXT NOT NULL,

  crossing_id TEXT NOT NULL
);

CREATE TABLE impressions (
  id TEXT PRIMARY KEY,

  campaign_id TEXT NOT NULL,

  creative_id TEXT NOT NULL,

  crossing_id TEXT NOT NULL,

  session_id TEXT,

  created_at TEXT
);

CREATE TABLE clicks (
  id TEXT PRIMARY KEY,

  campaign_id TEXT NOT NULL,

  creative_id TEXT NOT NULL,

  crossing_id TEXT NOT NULL,

  session_id TEXT,

  created_at TEXT
);