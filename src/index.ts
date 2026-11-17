import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { readSettings } from "./config";
import { loadHealth } from "./db";
import { parseIngest } from "./ingest";
import { telegramConfig, sendMessage } from "./notify";
import { applyOutcome, makeCtx, PUSHED, runOnce, sendHeartbeat, summarizeAlerts } from "./run";
import type { Env, Retailer } from "./types";

const HEARTBEAT_CRON = "0 22 * * *";

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
  const health = await loadHealth(c.env.DB);
  return c.json({ name: "lego-clearance", retailers: Object.fromEntries(health) });
});

app.use(
  "/debug/*",
  bearerAuth<{ Bindings: Env }>({ verifyToken: (token, c) => !!c.env.ADMIN_TOKEN && token === c.env.ADMIN_TOKEN }),
);

/** Runs one poll now. Add ?dry=1 to fetch and compare without sending or saving. */
app.post("/debug/run", async (c) => c.json(await runOnce(c.env, { dryRun: c.req.query("dry") === "1" })));

app.post("/debug/test-alert", async (c) => {
  await sendMessage(telegramConfig(c.env), { title: "LEGO monitor test", message: "Alerts reach this device." });
  return c.json({ sent: true });
});

app.use(
  "/ingest/*",
  bearerAuth<{ Bindings: Env }>({ verifyToken: (token, c) => !!c.env.INGEST_TOKEN && token === c.env.INGEST_TOKEN }),
);

const pushedRetailer = (name: string): Retailer | null => PUSHED.find((r) => r === name) ?? null;

/** Gives a home runner what it needs to fetch: the watchlist set numbers. */
app.get("/ingest/:retailer", (c) => {
  if (!pushedRetailer(c.req.param("retailer"))) return c.json({ error: "unknown retailer" }, 404);
  return c.json({ watchlist: [...readSettings(c.env).watchlist.keys()] });
});

/** Takes the result of a home runner fetch. Add ?dry=1 to compare without sending or saving. */
app.post("/ingest/:retailer", async (c) => {
  const retailer = pushedRetailer(c.req.param("retailer"));
  if (!retailer) return c.json({ error: "unknown retailer" }, 404);
  let outcome;
  try {
    outcome = parseIngest(await c.req.json(), retailer);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
  const { status, alerts } = await applyOutcome(await makeCtx(c.env, c.req.query("dry") === "1"), retailer, outcome);
  return c.json({ ...status, alerts: summarizeAlerts(alerts) });
});

app.get("/debug/items", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM items ORDER BY retailer, price_cents").all();
  return c.json(results);
});

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    if (event.cron === HEARTBEAT_CRON) {
      ctx.waitUntil(sendHeartbeat(env));
      return;
    }
    ctx.waitUntil(runOnce(env).then((s) => console.log(JSON.stringify(s))));
  },
} satisfies ExportedHandler<Env>;
