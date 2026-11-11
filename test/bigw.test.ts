import { describe, expect, test } from "bun:test";
import national from "./fixtures/bigw-national.json";
import store0278 from "./fixtures/bigw-store-0278.json";
import { parseSearch, parseStock } from "../src/retailers/bigw";
import { parseSetNumber } from "../src/retailers/http";

describe("Big W search parsing", () => {
  test("reads clearance items with QLD price, was-price and set number", () => {
    const { items, pageCount } = parseSearch(national);
    expect(pageCount).toBe(1);
    expect(items).toHaveLength(44);
    const messi = items.find((i) => i.setNumber === "43018");
    expect(messi).toMatchObject({
      retailer: "bigw",
      priceCents: 6000,
      wasCents: 23900,
      clearance: true,
      nationalStock: true,
      stores: [],
    });
    expect(messi?.url).toStartWith("https://www.bigw.com.au/product/lego-editions-football-lionel-messi");
  });

  test("store search gives the IDs in stock at that store", () => {
    const nationalStock = parseSearch(national).items.filter((i) => i.nationalStock).length;
    const storeStock = parseStock(store0278).inStock;
    expect(storeStock).toHaveLength(5);
    expect(storeStock).toContain("6061878");
    expect(storeStock.length).toBeLessThan(nationalStock);
  });

  test("throws on an unexpected shape", () => {
    expect(() => parseSearch({ error: "blocked" })).toThrow("unexpected search response shape");
  });
});

describe("parseSetNumber", () => {
  test.each([
    ["LEGO Fortnite Mecha Team Leader 77078", "77078"],
    ["LEGO DUPLO Bluey: Blueys Family House 10459", "10459"],
    ["LEGO City No Limits Floor Puzzle (50 Pieces)", null],
    ["LEGO Icons Titanic 10294 - 9090 pieces", "9090"],
  ])("%s -> %s", (name, expected) => {
    expect(parseSetNumber(name)).toBe(expected);
  });
});
