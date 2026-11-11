import type { Settings } from "./config";
import type { Alert, Item, StoredItem } from "./types";

export function percentOff(item: Pick<Item, "priceCents" | "wasCents">): number {
  if (!item.wasCents || item.wasCents <= item.priceCents) return 0;
  return ((item.wasCents - item.priceCents) / item.wasCents) * 100;
}

/** A deal is a markdown at or above the threshold, in stock at a watched store. No was-price means no deal. */
function isDeal(item: Item, settings: Settings): boolean {
  return item.stores.length > 0 && percentOff(item) >= settings.minPercentOff;
}

/** A watchlist hit is a watched set at or below its target price, in stock somewhere. */
function isWatchlistHit(item: Item, settings: Settings): boolean {
  const target = item.setNumber ? settings.watchlist.get(item.setNumber) : undefined;
  return target !== undefined && item.priceCents <= target && (item.stores.length > 0 || item.nationalStock);
}

/**
 * Compares the new state of an item with the stored state and returns the alert to send, if any.
 * Alerts only on a change: a new deal, a lower price, or stock at a watched store that had none.
 */
export function detect(prev: StoredItem | undefined, item: Item, settings: Settings): Alert | null {
  const deal = isDeal(item, settings);
  const watch = isWatchlistHit(item, settings);
  if (!deal && !watch) return null;

  const newStores = item.stores.filter((s) => !prev?.stores.includes(s));
  const prevQualified = prev !== undefined && (isDeal(prev, settings) || isWatchlistHit(prev, settings));

  if (!prevQualified) return { item, reason: deal ? "new-deal" : "watchlist", newStores };
  if (item.priceCents < prev.priceCents) return { item, reason: "price-drop", newStores };
  if (newStores.length > 0) return { item, reason: "back-in-stock", newStores };
  return null;
}

/** Date in Brisbane (UTC+10, no daylight saving) as YYYY-MM-DD. */
export function brisbaneDate(now: Date): string {
  return new Date(now.getTime() + 10 * 3600_000).toISOString().slice(0, 10);
}

/** Key that stops the same alert going out twice on one day. */
export function dedupeKey(alert: Alert, now: Date): string {
  const { item } = alert;
  return [item.retailer, item.id, item.priceCents, item.stores.join(","), brisbaneDate(now)].join(":");
}
