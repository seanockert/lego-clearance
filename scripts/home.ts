/**
 * Home runner. Big W blocks requests from Cloudflare, so this script fetches Big W from a home connection
 * and sends the result to the Worker at `POST /ingest/bigw`.
 *
 * Needs WORKER_URL and INGEST_TOKEN in `.env`. Add `--dry` to compare without sending alerts or saving.
 * Exits with code 1 if the Worker does not accept the result.
 */
import { fetchBigw } from "../src/retailers/bigw";

/** Wait before the second try of a failed Big W fetch. */
const RETRY_MS = 60_000;

const workerUrl = process.env.WORKER_URL;
const token = process.env.INGEST_TOKEN;
if (!workerUrl || !token) throw new Error("Set WORKER_URL and INGEST_TOKEN in .env");
const endpoint = `${workerUrl.replace(/\/$/, "")}/ingest/bigw`;
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const config = await fetch(endpoint, { headers });
if (!config.ok) throw new Error(`Worker returned ${config.status}: ${await config.text()}`);
const { watchlist } = (await config.json()) as { watchlist: string[] };

async function fetchWithRetry(): Promise<{ items: unknown[] } | { error: string }> {
  for (let attempt = 1; ; attempt++) {
    try {
      return { items: await fetchBigw(watchlist) };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`${new Date().toISOString()} Big W fetch failed (try ${attempt}): ${error}`);
      if (attempt === 2) return { error };
      await Bun.sleep(RETRY_MS);
    }
  }
}

const body = await fetchWithRetry();
const res = await fetch(`${endpoint}${process.argv.includes("--dry") ? "?dry=1" : ""}`, {
  method: "POST",
  headers,
  body: JSON.stringify(body),
});
const text = await res.text();
console.log(`${new Date().toISOString()} ${res.status} ${text}`);
if (!res.ok) process.exit(1);
