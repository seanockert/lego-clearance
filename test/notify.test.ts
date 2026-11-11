import { describe, expect, test } from "bun:test";
import { formatAlert, toTelegramText } from "../src/notify";
import type { Item } from "../src/types";

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
