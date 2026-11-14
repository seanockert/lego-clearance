import { RETAILER_NAMES, readSettings } from "./config";
import { clearMissing, insertAlert, insertPrice, loadHealth, loadItems, saveHealth, sentKeys, upsertItem } from "./db";
import { dedupeKey, detect } from "./diff";
import { nextHealth } from "./health";
import { formatDailySummary, telegramConfig, sendAlerts, sendMessage } from "./notify";
import { fetchBigw } from "./retailers/bigw";
import { fetchTarget } from "./retailers/target";
import type { Alert, Env, Item, Retailer, StoredItem } from "./types";

type Fetcher = (env: Env, watchlist: string[]) => Promise<Item[]>;

/** Retailers that run on each poll. */
export const FETCHERS: Partial<Record<Retailer, Fetcher>> = {
  bigw: (_env, watchlist) => fetchBigw(watchlist),
  target: (env) => fetchTarget(env.DB, new Date()),
};

export type RunSummary = {
  at: string;
  retailers: Record<string, { ok: boolean; items?: number; error?: string }>;
  alerts: { reason: string; retailer: Retailer; name: string; priceCents: number; stores: string[] }[];
  dryRun: boolean;
};

/**
 * Runs one poll: fetch each retailer, compare with stored state, send alerts, save state.
 * A dry run fetches and compares but does not send or save.
 */
export async function runOnce(env: Env, opts: { dryRun?: boolean } = {}): Promise<RunSummary> {
  const dryRun = opts.dryRun ?? false;
  const settings = readSettings(env);
  const now = new Date();
  const nowIso = now.toISOString();
  const health = await loadHealth(env.DB);
  const summary: RunSummary = { at: nowIso, retailers: {}, alerts: [], dryRun };
  const allAlerts: Alert[] = [];

  for (const [retailer, fetcher] of Object.entries(FETCHERS) as [Retailer, Fetcher][]) {
    let items: Item[];
    try {
      // Zero items is valid: a retailer can have no LEGO on clearance. A changed page shape throws.
      items = await fetcher(env, [...settings.watchlist.keys()]);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`${retailer} fetch failed: ${error}`);
      summary.retailers[retailer] = { ok: false, error };
      if (!dryRun) await recordHealth(env, retailer, health, { ok: false, error }, nowIso);
      continue;
    }

    const prev = await loadItems(env.DB, retailer);
    const alerts = items.map((it) => detect(prev.get(it.id), it, settings)).filter((a): a is Alert => a !== null);
    const keys = alerts.map((a) => dedupeKey(a, now));
    const already = await sentKeys(env.DB, keys);
    const fresh = alerts.filter((_, i) => !already.has(keys[i]!));

    summary.retailers[retailer] = { ok: true, items: items.length };
    allAlerts.push(...fresh);
    if (dryRun) continue;

    const stmts: D1PreparedStatement[] = [];
    for (const it of items) {
      stmts.push(upsertItem(env.DB, it, nowIso));
      const old = prev.get(it.id);
      if (!old || old.priceCents !== it.priceCents || old.wasCents !== it.wasCents) stmts.push(insertPrice(env.DB, it, nowIso));
    }
    stmts.push(clearMissing(env.DB, retailer, nowIso));
    fresh.forEach((a) => stmts.push(insertAlert(env.DB, dedupeKey(a, now), a.item, a.reason, nowIso)));
    // Send before saving. If sending fails, state is not saved, so the next run tries the same alerts again.
    try {
      await sendAlerts(telegramConfig(env), fresh);
    } catch (err) {
      const error = `alerts not sent: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`${retailer} ${error}`);
      summary.retailers[retailer] = { ok: false, items: items.length, error };
      continue;
    }
    await env.DB.batch(stmts);
    await recordHealth(env, retailer, health, { ok: true, count: items.length }, nowIso);
  }

  summary.alerts = allAlerts.map((a) => ({
    reason: a.reason,
    retailer: a.item.retailer,
    name: a.item.name,
    priceCents: a.item.priceCents,
    stores: a.item.stores,
  }));
  return summary;
}

async function recordHealth(
  env: Env,
  retailer: Retailer,
  health: Awaited<ReturnType<typeof loadHealth>>,
  result: Parameters<typeof nextHealth>[2],
  now: string,
): Promise<void> {
  const { health: h, notify } = nextHealth(retailer, health.get(retailer), result, now);
  await saveHealth(env.DB, h).run();
  const name = RETAILER_NAMES[retailer];
  if (notify === "broken") {
    await sendMessage(telegramConfig(env), {
      title: `LEGO monitor broken: ${name}`,
      message: `${h.consecutive_failures} failed runs in a row.\nLast error: ${h.last_error}`,
    });
  } else if (notify === "recovered") {
    await sendMessage(telegramConfig(env), { title: `LEGO monitor recovered: ${name}`, message: "Checks work again." });
  }
}

/** Sends the daily message: the deals in stock now at each retailer. */
export async function sendHeartbeat(env: Env): Promise<void> {
  const settings = readSettings(env);
  const health = await loadHealth(env.DB);
  const itemsByRetailer = new Map<Retailer, StoredItem[]>();
  for (const r of Object.keys(FETCHERS) as Retailer[]) {
    itemsByRetailer.set(r, [...(await loadItems(env.DB, r)).values()]);
  }
  await sendMessage(telegramConfig(env), formatDailySummary(itemsByRetailer, health, settings));
}
