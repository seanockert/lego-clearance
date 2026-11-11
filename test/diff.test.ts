import { describe, expect, test } from "bun:test";
import type { Settings } from "../src/config";
import { readSettings } from "../src/config";
import { brisbaneDate, dedupeKey, detect } from "../src/diff";
import type { Item, StoredItem } from "../src/types";

const settings: Settings = { minPercentOff: 50, watchlist: new Map([["77078", 10000]]) };

const item = (over: Partial<Item> = {}): Item => ({
  retailer: "bigw",
  id: "1",
  name: "LEGO Test 12345",
  setNumber: "12345",
  priceCents: 5000,
  wasCents: 12000,
  clearance: true,
  nationalStock: true,
  stores: ["0255"],
  url: "https://example.test/1",
  ...over,
});
const stored = (over: Partial<Item> = {}): StoredItem => ({ ...item(over), firstSeen: "x", lastSeen: "x" });

describe("detect", () => {
  test("new item over the threshold with store stock is a new deal", () => {
    expect(detect(undefined, item(), settings)?.reason).toBe("new-deal");
  });

  test("deal with no watched store stock is not an alert", () => {
    expect(detect(undefined, item({ stores: [] }), settings)).toBeNull();
  });

  test("markdown under the threshold is not an alert", () => {
    expect(detect(undefined, item({ priceCents: 7000 }), settings)).toBeNull();
  });

  test("no change gives no alert", () => {
    expect(detect(stored(), item(), settings)).toBeNull();
  });

  test("lower price on a known deal is a price drop", () => {
    expect(detect(stored(), item({ priceCents: 4000 }), settings)?.reason).toBe("price-drop");
  });

  test("a new watched store with stock is back in stock and names the store", () => {
    const alert = detect(stored(), item({ stores: ["0255", "0278"] }), settings);
    expect(alert).toMatchObject({ reason: "back-in-stock", newStores: ["0278"] });
  });

  test("a known item that crosses the threshold is a new deal", () => {
    expect(detect(stored({ priceCents: 8000 }), item(), settings)?.reason).toBe("new-deal");
  });

  test("a sold-out deal that gets stock again is a new deal", () => {
    expect(detect(stored({ stores: [] }), item(), settings)?.reason).toBe("new-deal");
  });

  test("watchlist set at or under target price alerts with national stock only", () => {
    const watched = item({ setNumber: "77078", priceCents: 9900, wasCents: 12000, stores: [] });
    expect(detect(undefined, watched, settings)?.reason).toBe("watchlist");
  });

  test("watchlist set above target price does not alert", () => {
    const watched = item({ setNumber: "77078", priceCents: 16100, wasCents: 26900, stores: [] });
    expect(detect(undefined, watched, settings)).toBeNull();
  });
});

describe("dedupeKey", () => {
  test("uses the Brisbane date", () => {
    // 15:00 UTC is 01:00 the next day in Brisbane.
    expect(brisbaneDate(new Date("2026-11-10T15:00:00Z"))).toBe("2026-11-11");
  });

  test("changes when the store set changes", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    const a = dedupeKey({ item: item(), reason: "new-deal", newStores: [] }, now);
    const b = dedupeKey({ item: item({ stores: ["0255", "0278"] }), reason: "back-in-stock", newStores: [] }, now);
    expect(a).not.toBe(b);
  });
});

describe("readSettings", () => {
  test("parses the watchlist into cents", () => {
    const s = readSettings({ MIN_PERCENT_OFF: "40", WATCHLIST: '{"77078": 99.5}' });
    expect(s.minPercentOff).toBe(40);
    expect(s.watchlist.get("77078")).toBe(9950);
  });

  test("rejects a bad threshold", () => {
    expect(() => readSettings({ MIN_PERCENT_OFF: "abc", WATCHLIST: "{}" })).toThrow("MIN_PERCENT_OFF");
  });
});
