import { STORES } from "../config";
import { loadRegularPrices, upsertRegularPrice } from "../db";
import type { Item } from "../types";
import { fetchJson, HttpError, parseSetNumber } from "./http";

/** Target LEGO category. Products are in the page's __NEXT_DATA__ JSON. */
const CATEGORY_URL = "https://www.target.com.au/c/toys/lego/W152974";
const CLEARANCE_URL = `${CATEGORY_URL}?clearance=True`;
const PER_PAGE = 48;
/** Stops a bad product count from using up the subrequest budget. */
const MAX_CLEARANCE_PAGES = 5;
/** The catalogue has 10 pages now. This stops a bad product count from using up the subrequest budget. */
const MAX_CATALOGUE_PAGES = 15;
/** Wait before the second try of a page that Target's bot protection blocked (HTTP 403). */
const BLOCKED_RETRY_MS = 5_000;
/** Constructor.io browse-by-ID takes this many IDs per call. */
const STOCK_BATCH = 20;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

type TargetProduct = {
  id?: string;
  title?: string;
  baseProductUrl?: string;
  price?: { offerPrice?: number; wasPrice?: number };
  labelProps?: { clearance?: boolean };
  variations?: { inStock?: boolean }[];
};

type NextData = {
  props?: { pageProps?: { metadata?: { totalNumProducts?: number; productList?: { products?: TargetProduct[] } } } };
};

type ConstructorResponse = {
  response?: { results?: { data?: { id?: string; instorestockpot?: string; availablestoreqty?: number } }[] };
};

const toCents = (dollars: number) => Math.round(dollars * 100);

/** Parses one Target listing page. Throws if the page has no product data. */
export function parseListing(html: string): { items: Item[]; total: number } {
  const tagStart = html.indexOf('<script id="__NEXT_DATA__"');
  const start = html.indexOf(">", tagStart) + 1;
  const end = html.indexOf("</script>", start);
  if (tagStart < 0 || end < 0) throw new Error("Target: page has no __NEXT_DATA__");
  const metadata = (JSON.parse(html.slice(start, end)) as NextData).props?.pageProps?.metadata;
  const products = metadata?.productList?.products;
  if (!Array.isArray(products) || typeof metadata?.totalNumProducts !== "number") {
    throw new Error("Target: unexpected page data shape");
  }
  const items: Item[] = [];
  for (const p of products) {
    const offer = p.price?.offerPrice;
    if (!p.id || !p.title || !p.baseProductUrl || typeof offer !== "number") continue;
    // Target sends wasPrice 0 on clearance items. The normal price comes from regular_prices instead.
    const was = p.price?.wasPrice;
    items.push({
      retailer: "target",
      id: p.id,
      name: p.title.replace(/®/g, ""),
      setNumber: parseSetNumber(p.title),
      priceCents: toCents(offer),
      wasCents: was ? toCents(was) : null,
      clearance: p.labelProps?.clearance === true,
      nationalStock: (p.variations ?? []).some((v) => v.inStock === true),
      stores: [],
      url: p.baseProductUrl,
    });
  }
  return { items, total: metadata.totalNumProducts };
}

/** Reads the public Constructor.io site key that Target pages send to the browser. */
export function parseConstructorKey(html: string): string {
  const key = html.match(/"NEXT_PUBLIC_CONSTRUCTOR_API_KEY":"(key_[A-Za-z0-9]+)"/)?.[1];
  if (!key) throw new Error("Target: page has no Constructor.io key");
  return key;
}

/**
 * Parses a Constructor.io browse-by-ID response into the watched stores with stock for each product.
 * `instorestockpot` lists the stores that have the product on the shelf. A product with
 * `availablestoreqty` 0 has no store stock, whatever the list says.
 */
export function parseStock(json: unknown): Map<string, string[]> {
  const results = (json as ConstructorResponse)?.response?.results;
  if (!Array.isArray(results)) throw new Error("Target: unexpected Constructor.io response shape");
  const watched = STORES.target.map((s) => s.id);
  const stock = new Map<string, string[]>();
  for (const r of results) {
    const id = r.data?.id;
    if (!id) continue;
    const pots = new Set((r.data?.instorestockpot ?? "").split("|"));
    const hasQty = (r.data?.availablestoreqty ?? 0) > 0;
    stock.set(id, hasQty ? watched.filter((w) => pots.has(w)).sort() : []);
  }
  return stock;
}

/**
 * Fetches a Target page. Target's bot protection sometimes blocks a request with HTTP 403,
 * so a 403 gets one more try after `retryMs`.
 */
export async function fetchHtml(url: string, retryMs = BLOCKED_RETRY_MS): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "text/html" } });
    const html = await res.text();
    if (res.ok) return html;
    if (res.status !== 403 || attempt === 2) throw new HttpError(url, res.status, html.slice(0, 200));
    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }
}

/** Reads pages 2 and up of a listing, and returns the items of all pages. */
async function fetchOtherPages(url: string, first: { items: Item[]; total: number }, maxPages: number): Promise<Item[]> {
  const items = [...first.items];
  const pages = Math.min(Math.ceil(first.total / PER_PAGE), maxPages);
  for (let page = 2; page <= pages; page++) {
    const pageUrl = new URL(url);
    pageUrl.searchParams.set("page", String(page));
    items.push(...parseListing(await fetchHtml(pageUrl.toString())).items);
  }
  return items;
}

async function fetchStock(key: string, ids: string[]): Promise<Map<string, string[]>> {
  const stock = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += STOCK_BATCH) {
    const params = new URLSearchParams({ key, c: "ciojs-client-2.37.2", i: "lego-clearance-monitor", s: "1" });
    params.set("num_results_per_page", String(STOCK_BATCH));
    for (const id of ids.slice(i, i + STOCK_BATCH)) params.append("ids", id);
    const json = await fetchJson(`https://ac.cnstrc.com/browse/items?${params}`);
    for (const [id, stores] of parseStock(json)) stock.set(id, stores);
  }
  return stock;
}

/**
 * Reads Target LEGO clearance items with stock at the watched stores and a was-price.
 * Target shows no was-price on clearance, so the was-price is the last normal price this monitor saw.
 * A clearance item first seen on clearance has no was-price, so it does not alert.
 */
export async function fetchTarget(db: D1Database, now: Date): Promise<Item[]> {
  // 1. Clearance items, and the Constructor.io key from the same page.
  const firstPage = await fetchHtml(CLEARANCE_URL);
  const key = parseConstructorKey(firstPage);
  const items = await fetchOtherPages(CLEARANCE_URL, parseListing(firstPage), MAX_CLEARANCE_PAGES);

  // 2. Learn normal prices from the full catalogue.
  const catalogueFirst = parseListing(await fetchHtml(CATEGORY_URL));
  const catalogue = await fetchOtherPages(CATEGORY_URL, catalogueFirst, MAX_CATALOGUE_PAGES);
  const nowIso = now.toISOString();
  const updates = catalogue.filter((it) => !it.clearance).map((it) => upsertRegularPrice(db, it, nowIso));
  if (updates.length > 0) await db.batch(updates);

  if (items.length === 0) return items;

  // 3. Store stock and was-price for the clearance items.
  const ids = items.map((it) => it.id);
  const [stock, regular] = await Promise.all([fetchStock(key, ids), loadRegularPrices(db, "target", ids)]);
  for (const it of items) {
    it.stores = stock.get(it.id) ?? [];
    const normal = regular.get(it.id);
    if (it.wasCents === null && normal !== undefined && normal > it.priceCents) it.wasCents = normal;
  }
  return items;
}
