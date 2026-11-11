import { afterEach, describe, expect, test } from "bun:test";
import items from "./fixtures/target-items.json";
import { detect } from "../src/diff";
import { formatAlert, toTelegramText } from "../src/notify";
import { fetchHtml, parseConstructorKey, parseListing, parseStock } from "../src/retailers/target";

const html = await Bun.file(new URL("./fixtures/target-clearance.html", import.meta.url)).text();
const settings = { minPercentOff: 40, watchlist: new Map<string, number>() };

describe("Target listing parsing", () => {
  test("reads clearance items with price, no was-price, and set number", () => {
    const { items, total } = parseListing(html);
    expect(total).toBe(5);
    expect(items).toHaveLength(5);
    expect(items[0]).toMatchObject({
      retailer: "target",
      id: "P71499055",
      name: "LEGO Jurassic World Baby Dinosaur Dolores: Aquilops 76970",
      setNumber: "76970",
      priceCents: 3400,
      wasCents: null,
      clearance: true,
      stores: [],
    });
  });

  test("throws on a page with no product data", () => {
    expect(() => parseListing("<html>blocked</html>")).toThrow("no __NEXT_DATA__");
  });

  test("reads the Constructor.io key, and throws when it is missing", () => {
    expect(parseConstructorKey('x,"NEXT_PUBLIC_CONSTRUCTOR_API_KEY":"key_Abc123",y')).toBe("key_Abc123");
    expect(() => parseConstructorKey("<html></html>")).toThrow("no Constructor.io key");
  });
});

describe("Target store stock", () => {
  test("gives the watched stores in the in-store stockpot list", () => {
    const stock = parseStock(items);
    expect(stock.get("P71499055")).toEqual([
      "QLD-BrisbaneCity",
      "QLD-Buranda",
      "QLD-Carindale",
      "QLD-Indooroopilly",
      "QLD-MtGravatt",
      "QLD-MtOmmaney",
    ]);
  });

  test("gives no stores when the store quantity is 0", () => {
    expect(parseStock(items).get("P71498492")).toEqual([]);
  });

  test("throws on an unexpected shape", () => {
    expect(() => parseStock({ error: "x" })).toThrow("unexpected Constructor.io response shape");
  });
});

describe("Target alerts", () => {
  const base = parseListing(html).items[0]!;
  const inStock = { ...base, stores: ["QLD-Carindale"] };

  test("no known normal price means no alert", () => {
    expect(detect(undefined, inStock, settings)).toBeNull();
  });

  test("40% or more below the normal price, with store stock, is a deal", () => {
    expect(detect(undefined, { ...inStock, wasCents: 6000 }, settings)?.reason).toBe("new-deal");
  });

  test("less than 40% off is not a deal", () => {
    expect(detect(undefined, { ...inStock, wasCents: 5000 }, settings)).toBeNull();
  });

  test("the alert names the Target store", () => {
    const text = toTelegramText(formatAlert({ item: { ...inStock, wasCents: 6000 }, reason: "new-deal", newStores: [] }));
    expect(text).toContain("<b>New deal: Target 76970 $34</b>");
    expect(text).toContain("$34 (was $60, 43% off)");
    expect(text).toContain("- Carindale");
  });
});

describe("Target page fetch", () => {
  const realFetch = globalThis.fetch;
  const respond = (statuses: number[]) => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      calls.push(url);
      const status = statuses[calls.length - 1] ?? 200;
      return new Response(status === 200 ? "<html>ok</html>" : "Access Denied", { status });
    }) as typeof fetch;
    return calls;
  };
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("tries a blocked page again and returns the second response", async () => {
    const calls = respond([403, 200]);
    expect(await fetchHtml("https://www.target.com.au/x", 0)).toBe("<html>ok</html>");
    expect(calls).toHaveLength(2);
  });

  test("throws when the page is blocked twice", async () => {
    const calls = respond([403, 403]);
    await expect(fetchHtml("https://www.target.com.au/x", 0)).rejects.toThrow("HTTP 403 from www.target.com.au");
    expect(calls).toHaveLength(2);
  });

  test("does not try again on other errors", async () => {
    const calls = respond([500]);
    await expect(fetchHtml("https://www.target.com.au/x", 0)).rejects.toThrow("HTTP 500");
    expect(calls).toHaveLength(1);
  });
});
