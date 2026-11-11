-- Normal (not clearance) price of each product, from the retailer's full catalogue.
-- Gives the "was" price for a retailer that does not show one on clearance items.
CREATE TABLE regular_prices (
  retailer TEXT NOT NULL,
  id TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (retailer, id)
);
