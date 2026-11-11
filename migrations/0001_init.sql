-- Latest known state of each item.
CREATE TABLE items (
  retailer TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  set_number TEXT,
  price_cents INTEGER NOT NULL,
  was_cents INTEGER,
  clearance INTEGER NOT NULL,
  national_stock INTEGER NOT NULL,
  -- JSON array of watched store IDs with stock.
  stores TEXT NOT NULL,
  url TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (retailer, id)
);

-- One row each time the price of an item changes.
CREATE TABLE price_history (
  retailer TEXT NOT NULL,
  id TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  was_cents INTEGER,
  seen_at TEXT NOT NULL
);
CREATE INDEX price_history_item ON price_history (retailer, id, seen_at);

-- Alerts sent. The key stops a repeat alert on the same day.
CREATE TABLE alerts (
  dedupe_key TEXT PRIMARY KEY,
  retailer TEXT NOT NULL,
  id TEXT NOT NULL,
  reason TEXT NOT NULL,
  sent_at TEXT NOT NULL
);

-- Health of each retailer fetch.
CREATE TABLE retailer_health (
  retailer TEXT PRIMARY KEY,
  consecutive_failures INTEGER NOT NULL,
  broken_alert_sent INTEGER NOT NULL,
  last_error TEXT,
  last_success TEXT,
  last_run TEXT NOT NULL,
  item_count INTEGER
);
