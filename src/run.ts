import { RETAILER_NAMES, readSettings, type Settings } from "./config";
import { clearMissing, insertAlert, insertPrice, loadHealth, loadItems, saveHealth, sentKeys, upsertItem, type Health } from "./db";
import { brisbaneDate, dedupeKey, detect } from "./diff";
import { nextHealth } from "./health";
import type { FetchOutcome } from "./ingest";
import { formatDailySummary, telegramConfig, sendAlerts, sendMessage } from "./notify";
import { checkOzbargain } from "./ozbargain";
import { fetchTarget } from "./retailers/target";
import type { Alert, Env, Item, Retailer, Source, StoredItem } from "./types";

type Fetcher = (env: Env, watchlist: string[]) => Promise<Item[]>;

/** Retailers that the Worker fetches on each poll. */
export const FETCHERS: Partial<Record<Retailer, Fetcher>> = {
  target: (env) => fetchTarget(env.DB, new Date()),
};

/**
 * Retailers that a home runner fetches and sends to `POST /ingest/<retailer>`, because they block Cloudflare.
 * See scripts/home.ts.
 */
export const PUSHED: Retailer[] = ["bigw"];

/** All retailers, in the order of the daily message. */
export const RETAILERS: Retailer[] = ["bigw", "target"];

/** A pushed retailer with no good data for this long counts as failing on each poll. */
const PUSH_MAX_AGE_MS = 24 * 3600_000;

type Status = { ok: boolean; items?: number; error?: string };

export type RunSummary = {
  at: string;
  retailers: Record<string, Status>;
  alerts: { reason: string; retailer: Retailer; name: string; priceCents: number; stores: string[] }[];
  ozbargain?: { ok: boolean; posts?: number; fresh?: string[]; firstRun?: boolean; error?: string };
  dryRun: boolean;
};

type Ctx = { env: Env; settings: Settings; now: Date; health: Map<Source, Health>; dryRun: boolean };

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Compares the fetched items of one retailer with stored state, sends alerts, and saves state and health.
 * A dry run compares but does not send or save.
 */
export async function applyOutcome(ctx: Ctx, retailer: Retailer, outcome: FetchOutcome): Promise<{ status: Status; alerts: Alert[] }> {
  const { env, settings, now, dryRun } = ctx;
  const nowIso = now.toISOString();
  if (!outcome.ok) {
    console.error(`${retailer} fetch failed: ${outcome.error}`);
    if (!dryRun) await recordHealth(ctx, retailer, { ok: false, error: outcome.error });
    return { status: { ok: false, error: outcome.error }, alerts: [] };
  }

  const { items } = outcome;
  const prev = await loadItems(env.DB, retailer);
  const alerts = items.map((it) => detect(prev.get(it.id), it, settings)).filter((a): a is Alert => a !== null);
  const keys = alerts.map((a) => dedupeKey(a, now));
  const already = await sentKeys(env.DB, keys);
  const fresh = alerts.filter((_, i) => !already.has(keys[i]!));
  if (dryRun) return { status: { ok: true, items: items.length }, alerts: fresh };

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
    const error = `alerts not sent: ${errorText(err)}`;
    console.error(`${retailer} ${error}`);
    return { status: { ok: false, items: items.length, error }, alerts: fresh };
  }
  await env.DB.batch(stmts);
  await recordHealth(ctx, retailer, { ok: true, count: items.length });
  return { status: { ok: true, items: items.length }, alerts: fresh };
}

export async function makeCtx(env: Env, dryRun: boolean): Promise<Ctx> {
  return { env, settings: readSettings(env), now: new Date(), health: await loadHealth(env.DB), dryRun };
}

export function summarizeAlerts(alerts: Alert[]): RunSummary["alerts"] {
  return alerts.map((a) => ({
    reason: a.reason,
    retailer: a.item.retailer,
    name: a.item.name,
    priceCents: a.item.priceCents,
    stores: a.item.stores,
  }));
}

/**
 * Runs one poll: fetch each Worker-fetched retailer, check that pushed retailers are fresh, and check OzBargain.
 * A dry run fetches and compares but does not send or save.
 */
export async function runOnce(env: Env, opts: { dryRun?: boolean } = {}): Promise<RunSummary> {
  const ctx = await makeCtx(env, opts.dryRun ?? false);
  const summary: RunSummary = { at: ctx.now.toISOString(), retailers: {}, alerts: [], dryRun: ctx.dryRun };
  const allAlerts: Alert[] = [];

  for (const [retailer, fetcher] of Object.entries(FETCHERS) as [Retailer, Fetcher][]) {
    let outcome: FetchOutcome;
    try {
      // Zero items is valid: a retailer can have no LEGO on clearance. A changed page shape throws.
      outcome = { ok: true, items: await fetcher(env, [...ctx.settings.watchlist.keys()]) };
    } catch (err) {
      outcome = { ok: false, error: errorText(err) };
    }
    const { status, alerts } = await applyOutcome(ctx, retailer, outcome);
    summary.retailers[retailer] = status;
    allAlerts.push(...alerts);
  }

  for (const retailer of PUSHED) {
    const h = ctx.health.get(retailer);
    if (!h || (h.last_success && ctx.now.getTime() - Date.parse(h.last_success) <= PUSH_MAX_AGE_MS)) continue;
    const since = h.last_success ? brisbaneDate(new Date(h.last_success)) : "start";
    const { status } = await applyOutcome(ctx, retailer, { ok: false, error: `No data from the home runner since ${since}` });
    summary.retailers[retailer] = status;
  }

  try {
    const r = await checkOzbargain(env.DB, telegramConfig(env), ctx.now, ctx.dryRun);
    summary.ozbargain = { ok: true, posts: r.posts, fresh: r.fresh.map((p) => p.title), firstRun: r.firstRun };
    if (!ctx.dryRun) await recordHealth(ctx, "ozbargain", { ok: true, count: r.posts });
  } catch (err) {
    const error = errorText(err);
    console.error(`ozbargain check failed: ${error}`);
    summary.ozbargain = { ok: false, error };
    if (!ctx.dryRun) await recordHealth(ctx, "ozbargain", { ok: false, error });
  }

  summary.alerts = summarizeAlerts(allAlerts);
  return summary;
}

async function recordHealth(ctx: Ctx, source: Source, result: Parameters<typeof nextHealth>[2]): Promise<void> {
  const { env, health, now } = ctx;
  const { health: h, notify } = nextHealth(source, health.get(source), result, now.toISOString());
  await saveHealth(env.DB, h).run();
  health.set(source, h);
  const name = RETAILER_NAMES[source];
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
  for (const r of RETAILERS) {
    itemsByRetailer.set(r, [...(await loadItems(env.DB, r)).values()]);
  }
  await sendMessage(telegramConfig(env), formatDailySummary(itemsByRetailer, health, settings));
}
