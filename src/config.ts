import type { Env, Retailer, Store } from "./types";

export const STORES: Record<Retailer, Store[]> = {
  bigw: [
    { id: "0278", name: "Macarthur Central (CBD)", phone: "07 3012 3313" },
    { id: "0255", name: "Carindale", phone: "1300 411 875" },
    { id: "0270", name: "Mt Ommaney", phone: "1300 411 875" },
    { id: "0272", name: "Upper Mt Gravatt", phone: "1300 411 875" },
  ],
  // Target IDs are Constructor.io "in-store stockpot" names. The stockpot for a postcode comes from
  // https://api.target.com.au/lz3inventory/delivery/<postcode>?mode=HD.
  target: [
    { id: "QLD-BrisbaneCity", name: "Brisbane CBD" },
    { id: "QLD-Indooroopilly", name: "Indooroopilly" },
    { id: "QLD-Carindale", name: "Carindale" },
    { id: "QLD-MtOmmaney", name: "Mt Ommaney" },
    { id: "QLD-MtGravatt", name: "Garden City (Upper Mt Gravatt)" },
    { id: "QLD-Buranda", name: "Buranda" },
  ],
};

export const RETAILER_NAMES: Record<Retailer, string> = { bigw: "Big W", target: "Target" };

export function storeName(retailer: Retailer, id: string): string {
  return STORES[retailer].find((s) => s.id === id)?.name ?? id;
}

export type Settings = { minPercentOff: number; watchlist: Map<string, number> };

/** Reads settings from Worker vars. The watchlist maps set number to target price in cents. */
export function readSettings(env: Pick<Env, "MIN_PERCENT_OFF" | "WATCHLIST">): Settings {
  const minPercentOff = Number(env.MIN_PERCENT_OFF);
  if (!Number.isFinite(minPercentOff) || minPercentOff < 0 || minPercentOff > 100) {
    throw new Error(`MIN_PERCENT_OFF must be 0-100, got "${env.MIN_PERCENT_OFF}"`);
  }
  const raw: unknown = JSON.parse(env.WATCHLIST || "{}");
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("WATCHLIST must be a JSON object of set number to dollars");
  }
  const watchlist = new Map<string, number>();
  for (const [setNumber, dollars] of Object.entries(raw)) {
    if (typeof dollars !== "number" || dollars <= 0) {
      throw new Error(`WATCHLIST price for ${setNumber} must be a positive number`);
    }
    watchlist.set(setNumber, Math.round(dollars * 100));
  }
  return { minPercentOff, watchlist };
}
