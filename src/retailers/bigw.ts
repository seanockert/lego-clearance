import { STORES } from "../config";
import type { Item } from "../types";
import { fetchJson, parseSetNumber, slugify } from "./http";

const SEARCH_URL = "https://api.bigw.com.au/search/v1/search";
const PER_PAGE = 48;
/** Stops a bad page count from using up the subrequest budget. */
const MAX_PAGES = 5;

type BigwPrice = {
  clearance?: boolean;
  price?: { cents?: number };
  wasPrice?: { cents?: number };
};

type BigwResult = {
  identifiers?: { articleId?: string };
  information?: { name?: string; brand?: { name?: string } };
  prices?: Record<string, BigwPrice | undefined>;
  stock?: boolean;
};

type BigwResponse = {
  organic?: { results?: BigwResult[]; pageCount?: number; resultsCount?: number };
};

type Query = { text: string; filter: Record<string, unknown>; storeId?: string };

function body(query: Query, page: number) {
  return {
    format: "1",
    clientId: "web",
    sessionId: "lego-clearance-monitor",
    page,
    perPage: PER_PAGE,
    sort: "relevance",
    text: query.text,
    filter: query.filter,
    ...(query.storeId ? { storeId: query.storeId, state: "QLD", zone: "QLD" } : {}),
    include: {
      facets: false,
      suggestions: false,
      sponsored: false,
      // Store calls only need the ID and `stock`. Fewer fields make the response smaller and faster to parse.
      productAttributes: query.storeId ? ["identifiers"] : ["information.name", "prices.NAT", "prices.QLD", "identifiers"],
    },
  };
}

function organicOf(json: unknown) {
  const organic = (json as BigwResponse)?.organic;
  if (!organic || !Array.isArray(organic.results) || typeof organic.pageCount !== "number") {
    throw new Error("Big W: unexpected search response shape");
  }
  return { results: organic.results, pageCount: organic.pageCount };
}

/** Parses one Big W search response into items. Throws if the shape is not as expected. */
export function parseSearch(json: unknown): { items: Item[]; pageCount: number } {
  const { results, pageCount } = organicOf(json);
  const items: Item[] = [];
  for (const r of results) {
    const id = r.identifiers?.articleId;
    const name = r.information?.name;
    // QLD price applies to Brisbane stores. NAT is the fallback.
    const price = r.prices?.QLD ?? r.prices?.NAT;
    const cents = price?.price?.cents;
    if (!id || !name || typeof cents !== "number") continue;
    items.push({
      retailer: "bigw",
      id,
      name,
      setNumber: parseSetNumber(name),
      priceCents: cents,
      wasCents: price?.wasPrice?.cents ?? null,
      clearance: price?.clearance === true,
      nationalStock: r.stock === true,
      stores: [],
      url: `https://www.bigw.com.au/product/${slugify(name)}/p/${id}`,
    });
  }
  return { items, pageCount };
}

/** Parses one store search response into the IDs in stock at that store. */
export function parseStock(json: unknown): { inStock: string[]; pageCount: number } {
  const { results, pageCount } = organicOf(json);
  const inStock = results.filter((r) => r.stock === true).map((r) => r.identifiers?.articleId).filter((id): id is string => !!id);
  return { inStock, pageCount };
}

/** Fetches every page of a search and parses each page with `parse`. */
async function searchAll<T extends { pageCount: number }>(query: Query, parse: (json: unknown) => T): Promise<T[]> {
  const pages: T[] = [];
  let pageCount = 1;
  for (let page = 0; page < Math.min(pageCount, MAX_PAGES); page++) {
    const json = await fetchJson(SEARCH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://www.bigw.com.au" },
      body: JSON.stringify(body(query, page)),
    });
    const parsed = parse(json);
    pageCount = parsed.pageCount;
    pages.push(parsed);
  }
  return pages;
}

const CLEARANCE_FILTER = { brand: ["LEGO"], deal: ["Clearance"] };

/**
 * Reads all LEGO clearance items nationally, then the stock at each watched store.
 * With a storeId, Big W search sets `stock` to the stock at that store.
 * Watchlist sets get one text search each, so a set that is not on clearance is still seen.
 */
export async function fetchBigw(watchlist: Iterable<string>): Promise<Item[]> {
  const national = await searchAll({ text: "lego", filter: CLEARANCE_FILTER }, parseSearch);
  const byId = new Map(national.flatMap((p) => p.items).map((it) => [it.id, it]));

  for (const setNumber of watchlist) {
    const found = await searchAll({ text: `lego ${setNumber}`, filter: { brand: ["LEGO"] } }, parseSearch);
    for (const it of found.flatMap((p) => p.items)) {
      if (it.setNumber === setNumber && !byId.has(it.id)) byId.set(it.id, it);
    }
  }

  for (const store of STORES.bigw) {
    const pages = await searchAll({ text: "lego", filter: CLEARANCE_FILTER, storeId: store.id }, parseStock);
    for (const id of pages.flatMap((p) => p.inStock)) byId.get(id)?.stores.push(store.id);
  }

  for (const it of byId.values()) it.stores.sort();
  return [...byId.values()];
}
