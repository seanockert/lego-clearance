import { describe, expect, test } from "bun:test";
import national from "./fixtures/bigw-national.json";
import { parseIngest } from "../src/ingest";
import { parseSearch } from "../src/retailers/bigw";

// Items as the home runner sends them: Big W parser output, after a JSON round trip.
const items = JSON.parse(JSON.stringify(parseSearch(national).items.map((it) => ({ ...it, stores: ["0278", "0255"] }))));

describe("parseIngest", () => {
  test("accepts the items the Big W fetcher makes", () => {
    const outcome = parseIngest({ items }, "bigw");
    expect(outcome.ok && outcome.items).toHaveLength(44);
    expect(outcome.ok && outcome.items[0]?.stores).toEqual(["0255", "0278"]);
  });

  test("passes on a fetch error from the home runner", () => {
    expect(parseIngest({ error: "HTTP 520" }, "bigw")).toEqual({ ok: false, error: "HTTP 520" });
  });

  test.each([
    ["an unknown store", { stores: ["9999"] }, "stores"],
    ["another retailer", { retailer: "target" }, "retailer"],
    ["a price that is not whole cents", { priceCents: 12.5 }, "priceCents"],
  ])("rejects an item with %s", (_, patch, field) => {
    expect(() => parseIngest({ items: [{ ...items[0], ...patch }] }, "bigw")).toThrow(`items[0].${field}`);
  });

  test("rejects a body with no items and no error", () => {
    expect(() => parseIngest({}, "bigw")).toThrow("body must be");
  });
});
