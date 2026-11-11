export type Retailer = "bigw" | "target";

export type Env = {
  DB: D1Database;
  MIN_PERCENT_OFF: string;
  WATCHLIST: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  ADMIN_TOKEN?: string;
};

export type Store = { id: string; name: string; phone?: string };

/** One product as read from a retailer, in a shape common to all retailers. */
export type Item = {
  retailer: Retailer;
  id: string;
  name: string;
  setNumber: string | null;
  priceCents: number;
  wasCents: number | null;
  clearance: boolean;
  nationalStock: boolean;
  /** IDs of watched stores that have the item in stock, sorted. */
  stores: string[];
  url: string;
};

export type StoredItem = Item & { firstSeen: string; lastSeen: string };

export type AlertReason = "new-deal" | "price-drop" | "back-in-stock" | "watchlist";

export type Alert = { item: Item; reason: AlertReason; newStores: string[] };
