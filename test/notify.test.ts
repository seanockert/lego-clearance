import { describe, expect, test } from "bun:test";
import { formatAlert, formatDailySummary, toTelegramText } from "../src/notify";
import type { Item, StoredItem } from "../src/types";

const item: Item = {
  retailer: "bigw",
  id: "6061831",
  name: "LEGO Editions <Jersey> & Co 43033",
  setNumber: "43033",
  priceCents: 900,
  wasCents: 3900,
  clearance: true,
  nationalStock: true,
  stores: ["0255", "0278"],
  url: "https://www.bigw.com.au/product/x/p/6061831?a=1&b=2",
};

describe("Telegram alert text", () => {
  test("shows price, % off, stores with phone and new tag, and escapes HTML", () => {
    const text = toTelegramText(formatAlert({ item, reason: "back-in-stock", newStores: ["0278"] }));
    expect(text).toStartWith("<b>Back in stock: Big W 43033 $9</b>\n");
    expect(text).toContain("LEGO Editions &lt;Jersey&gt; &amp; Co 43033");
    expect(text).toContain("$9 (was $39, 77% off)");
    expect(text).toContain("- Carindale, 1300 411 875");
    expect(text).toContain("- Macarthur Central (CBD) (new), 07 3012 3313");
    expect(text).toEndWith('<a href="https://www.bigw.com.au/product/x/p/6061831?a=1&amp;b=2">Open product</a>');
  });

  test("stays under the Telegram limit", () => {
    expect(toTelegramText({ title: "t", message: "x".repeat(10_000), url: "https://e.test" }).length).toBeLessThanOrEqual(4096);
  });
});

describe("daily summary", () => {
  const settings = { minPercentOff: 40, watchlist: new Map<string, number>() };
  const now = "2026-11-13T21:40:31.349Z";
  const ok = (retailer: "bigw" | "target") => ({
    retailer,
    consecutive_failures: 0,
    broken_alert_sent: 0,
    last_error: null,
    last_success: now,
    last_run: now,
    item_count: 1,
  });
  const stored = (over: Partial<StoredItem>) => ({ ...item, firstSeen: now, lastSeen: now, ...over });

  test("lists only deals in stock now, best first, and skips the rest", () => {
    const items = new Map([
      [
        "bigw" as const,
        [
          stored({ id: "a", name: "Deal A", priceCents: 2000, wasCents: 4000 }),
          stored({ id: "b", name: "Deal B" }),
          stored({ id: "c", name: "Small markdown", priceCents: 3500, wasCents: 3900 }),
          stored({ id: "d", name: "No stock", stores: [] }),
          stored({ id: "e", name: "Gone", lastSeen: "2026-11-01T00:00:00.000Z" }),
        ],
      ],
      ["target" as const, []],
    ]);
    const msg = formatDailySummary(items, new Map([["bigw", ok("bigw")], ["target", ok("target")]]), settings);
    const text = toTelegramText(msg);
    expect(msg.title).toBe("2 LEGO clearance deals in stock");
    expect(msg.silent).toBe(false);
    expect(text.indexOf("Deal B")).toBeLessThan(text.indexOf("Deal A"));
    expect(text).toContain("$9 (was $39, 77% off) at Carindale, Macarthur Central (CBD)");
    expect(text).not.toContain("Small markdown");
    expect(text).not.toContain("No stock<");
    expect(text).not.toContain("Gone");
    expect(text).toContain("<b>Target</b> (0)\nNo deals in stock.");
  });

  test("no deals is silent and warns when a check fails", () => {
    const failing = { ...ok("target"), consecutive_failures: 2, last_error: "HTTP 403" };
    const msg = formatDailySummary(new Map([["target", []]]), new Map([["target", failing]]), settings);
    expect(msg.title).toBe("No LEGO clearance deals in stock today");
    expect(msg.silent).toBe(true);
    expect(msg.message).toContain("Check failing since 2026-11-14. List can be old.");
  });
});
