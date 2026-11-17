import { STORES } from "./config";
import type { Item, Retailer } from "./types";

/** Result of one fetch: the items, or the error that stopped the fetch. */
export type FetchOutcome = { ok: true; items: Item[] } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCents = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

function parseItem(v: unknown, retailer: Retailer, i: number): Item {
  const fail = (field: string) => new Error(`items[${i}].${field} is not valid`);
  if (!isObj(v)) throw fail("(item)");
  if (v.retailer !== retailer) throw fail("retailer");
  if (typeof v.id !== "string" || !v.id) throw fail("id");
  if (typeof v.name !== "string" || !v.name) throw fail("name");
  if (v.setNumber !== null && typeof v.setNumber !== "string") throw fail("setNumber");
  if (!isCents(v.priceCents)) throw fail("priceCents");
  if (v.wasCents !== null && !isCents(v.wasCents)) throw fail("wasCents");
  if (typeof v.clearance !== "boolean") throw fail("clearance");
  if (typeof v.nationalStock !== "boolean") throw fail("nationalStock");
  const storeIds = new Set(STORES[retailer].map((s) => s.id));
  if (!Array.isArray(v.stores) || !v.stores.every((s) => typeof s === "string" && storeIds.has(s))) throw fail("stores");
  if (typeof v.url !== "string" || !v.url.startsWith("https://")) throw fail("url");
  return {
    retailer,
    id: v.id,
    name: v.name,
    setNumber: v.setNumber,
    priceCents: v.priceCents,
    wasCents: v.wasCents,
    clearance: v.clearance,
    nationalStock: v.nationalStock,
    stores: [...(v.stores as string[])].sort(),
    url: v.url,
  };
}

/**
 * Reads the body a home runner sends: `{ items: Item[] }` after a good fetch, or `{ error: string }` after a failed one.
 * Throws if the body is not valid.
 */
export function parseIngest(body: unknown, retailer: Retailer): FetchOutcome {
  if (isObj(body) && typeof body.error === "string" && body.error) return { ok: false, error: body.error };
  if (!isObj(body) || !Array.isArray(body.items)) throw new Error("body must be { items: [...] } or { error: string }");
  return { ok: true, items: body.items.map((v, i) => parseItem(v, retailer, i)) };
}
