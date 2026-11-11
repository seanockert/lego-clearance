import type { Retailer, StoredItem, Item } from "./types";

type ItemRow = {
  retailer: Retailer;
  id: string;
  name: string;
  set_number: string | null;
  price_cents: number;
  was_cents: number | null;
  clearance: number;
  national_stock: number;
  stores: string;
  url: string;
  first_seen: string;
  last_seen: string;
};

export type Health = {
  retailer: Retailer;
  consecutive_failures: number;
  broken_alert_sent: number;
  last_error: string | null;
  last_success: string | null;
  last_run: string;
  item_count: number | null;
};

export async function loadItems(db: D1Database, retailer: Retailer): Promise<Map<string, StoredItem>> {
  const { results } = await db.prepare("SELECT * FROM items WHERE retailer = ?").bind(retailer).all<ItemRow>();
  return new Map(
    results.map((r) => [
      r.id,
      {
        retailer: r.retailer,
        id: r.id,
        name: r.name,
        setNumber: r.set_number,
        priceCents: r.price_cents,
        wasCents: r.was_cents,
        clearance: r.clearance === 1,
        nationalStock: r.national_stock === 1,
        stores: JSON.parse(r.stores) as string[],
        url: r.url,
        firstSeen: r.first_seen,
        lastSeen: r.last_seen,
      },
    ]),
  );
}

export function upsertItem(db: D1Database, item: Item, now: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO items (retailer, id, name, set_number, price_cents, was_cents, clearance, national_stock, stores, url, first_seen, last_seen)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
       ON CONFLICT (retailer, id) DO UPDATE SET
         name = ?3, set_number = ?4, price_cents = ?5, was_cents = ?6, clearance = ?7,
         national_stock = ?8, stores = ?9, url = ?10, last_seen = ?11`,
    )
    .bind(
      item.retailer,
      item.id,
      item.name,
      item.setNumber,
      item.priceCents,
      item.wasCents,
      item.clearance ? 1 : 0,
      item.nationalStock ? 1 : 0,
      JSON.stringify(item.stores),
      item.url,
      now,
    );
}

export function insertPrice(db: D1Database, item: Item, now: string): D1PreparedStatement {
  return db
    .prepare("INSERT INTO price_history (retailer, id, price_cents, was_cents, seen_at) VALUES (?, ?, ?, ?, ?)")
    .bind(item.retailer, item.id, item.priceCents, item.wasCents, now);
}

/** Items that are no longer listed lose their store stock, so a later return counts as back in stock. */
export function clearMissing(db: D1Database, retailer: Retailer, now: string): D1PreparedStatement {
  return db.prepare("UPDATE items SET stores = '[]' WHERE retailer = ? AND last_seen < ?").bind(retailer, now);
}

export async function sentKeys(db: D1Database, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const { results } = await db
    .prepare(`SELECT dedupe_key FROM alerts WHERE dedupe_key IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(keys))
    .all<{ dedupe_key: string }>();
  return new Set(results.map((r) => r.dedupe_key));
}

export function insertAlert(db: D1Database, key: string, item: Item, reason: string, now: string): D1PreparedStatement {
  return db
    .prepare("INSERT OR IGNORE INTO alerts (dedupe_key, retailer, id, reason, sent_at) VALUES (?, ?, ?, ?, ?)")
    .bind(key, item.retailer, item.id, reason, now);
}

export async function loadHealth(db: D1Database): Promise<Map<Retailer, Health>> {
  const { results } = await db.prepare("SELECT * FROM retailer_health").all<Health>();
  return new Map(results.map((h) => [h.retailer, h]));
}

export function saveHealth(db: D1Database, h: Health): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO retailer_health (retailer, consecutive_failures, broken_alert_sent, last_error, last_success, last_run, item_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (retailer) DO UPDATE SET
         consecutive_failures = excluded.consecutive_failures, broken_alert_sent = excluded.broken_alert_sent,
         last_error = excluded.last_error, last_success = excluded.last_success,
         last_run = excluded.last_run, item_count = excluded.item_count`,
    )
    .bind(h.retailer, h.consecutive_failures, h.broken_alert_sent, h.last_error, h.last_success, h.last_run, h.item_count);
}

/** A stored normal price older than this is replaced even by a lower price. */
const REGULAR_PRICE_MAX_AGE_DAYS = 60;

/**
 * Saves the normal price of a product that is not on clearance. Keeps the higher price, so a short
 * sale does not lower it, unless the stored price is old.
 */
export function upsertRegularPrice(db: D1Database, item: Item, now: string): D1PreparedStatement {
  const cutoff = new Date(Date.parse(now) - REGULAR_PRICE_MAX_AGE_DAYS * 86_400_000).toISOString();
  return db
    .prepare(
      `INSERT INTO regular_prices (retailer, id, price_cents, seen_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (retailer, id) DO UPDATE SET price_cents = excluded.price_cents, seen_at = excluded.seen_at
       WHERE excluded.price_cents >= regular_prices.price_cents OR regular_prices.seen_at < ?5`,
    )
    .bind(item.retailer, item.id, item.priceCents, now, cutoff);
}

export async function loadRegularPrices(db: D1Database, retailer: Retailer, ids: string[]): Promise<Map<string, number>> {
  const { results } = await db
    .prepare("SELECT id, price_cents FROM regular_prices WHERE retailer = ? AND id IN (SELECT value FROM json_each(?))")
    .bind(retailer, JSON.stringify(ids))
    .all<{ id: string; price_cents: number }>();
  return new Map(results.map((r) => [r.id, r.price_cents]));
}
