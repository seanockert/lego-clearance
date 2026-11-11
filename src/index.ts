import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { loadHealth } from "./db";
import { telegramConfig, sendMessage } from "./notify";
import { runOnce, sendHeartbeat } from "./run";
import type { Env } from "./types";

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
