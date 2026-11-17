# LEGO Clearance Monitor

A Cloudflare Worker that sends a Telegram alert when a LEGO set is marked down at Big W or Target and is in stock at a watched Brisbane store.
It also sends an alert for each new LEGO deal on OzBargain, from any shop.

## How it works

At 7am and 1pm Brisbane time, for each retailer:

1. The monitor reads all LEGO clearance items.
2. It reads which watched stores have each item in stock.
3. It compares the result with the last state in D1.
4. It sends a Telegram alert for a new deal (40% or more off, in stock at a watched store), a price drop, or new stock at a watched store.

Big W blocks requests from Cloudflare.
Thus a home runner (`scripts/home.ts`) on a Mac reads Big W and sends the result to the Worker at `POST /ingest/bigw`.
The Worker reads Target itself.

The Worker runs again 20 and 40 minutes later in each window.
These runs are backups for when Target blocks a run.
They send only alerts that the earlier runs did not send.
If the Worker has no good Big W data for 24 hours, each Worker run counts as a failed Big W run.

Each Worker run also reads the OzBargain LEGO feed and sends an alert for each new post that has not ended.
On the first run, it saves the current posts and sends no alerts.

Each day at 8am Brisbane time, it sends a list of the deals in stock now at a watched store, best first.
It is silent when there are no deals. It shows a warning for a retailer whose check fails.
After 3 failed runs in a row for a retailer or OzBargain, it sends a "monitor broken" alert.

## Data sources

- **Big W** (read by the home runner): `POST https://api.bigw.com.au/search/v1/search` with `filter: {brand: ["LEGO"], deal: ["Clearance"]}`.
  With a `storeId`, the `stock` field gives the stock at that store.
  Big W does not show quantities.
  Big W blocks Cloudflare IPs (HTTP 520) and requests with no browser user agent.
- **Target**:
  - Clearance items: the public page `https://www.target.com.au/c/toys/lego/W152974?clearance=True`.
    The products are in the page's `__NEXT_DATA__` JSON.
  - Target's bot protection (Akamai) sometimes blocks requests from Cloudflare with HTTP 403 "Access Denied".
    A blocked page gets one more try after 5 seconds.
  - Store stock: the Constructor.io search API that Target's pages use, with the public site key from the same page.
    The `instorestockpot` field lists the stores that have the item.
    In tests, this data matched the in-store check on Target's product page, but it may be "any stock in the area" more than exact shelf stock.
  - Was-price: Target shows none on clearance items.
    Each run reads the full LEGO catalogue (about 10 pages) and saves the normal price of each set in `regular_prices`.
    A clearance item is compared with its last normal price.
    An item that was already on clearance when the monitor first saw it has no was-price, so it does not alert.

- **OzBargain**: the RSS feed `https://www.ozbargain.com.au/brand/lego/feed` (the last 10 LEGO posts).
  OzBargain blocks a browser user agent from a non-browser client, so the Worker sends a plain feed reader user agent.

## Settings

Vars in `wrangler.jsonc`:

- `MIN_PERCENT_OFF`: minimum % off the was-price for an alert. Default `40`.
- `WATCHLIST`: JSON object of set number to target price in dollars, for example `{"77078": 100}`.

Secrets (set with `bunx wrangler secret put <NAME>`):

- `TELEGRAM_BOT_TOKEN`: token of the bot that sends alerts. Get it from @BotFather.
- `TELEGRAM_CHAT_ID`: your chat ID with the bot. Send the bot a message, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `chat.id`.
- `ADMIN_TOKEN`: bearer token for the `/debug` routes.
- `INGEST_TOKEN`: bearer token for the `/ingest` routes. The home runner uses it.

## Home runner

The home runner runs on a Mac that stays on, at 7:00 and 13:00 Mac local time.
If the Mac is asleep at that time, it runs when the Mac wakes.

1. Make `.env` in the repo root:

   ```sh
   WORKER_URL=https://<your worker>.workers.dev
   INGEST_TOKEN=<same value as the Worker secret>
   ```

2. Test it: `bun run home --dry`.
3. Install the launchd job: `bun run home:install`.
   The log is `~/Library/Logs/lego-clearance-home.log`.

## Commands

```sh
bun install
bun test
bun run typecheck
bun run dev       # local Worker with local D1. Put secrets in .dev.vars.
bun run deploy    # applies D1 migrations, then deploys
```

## Routes

- `GET /`: health of each retailer.
- `GET /ingest/bigw`: the watchlist set numbers, for the home runner.
- `POST /ingest/bigw`: takes `{ "items": [...] }` or `{ "error": "..." }` from the home runner. Add `?dry=1` to compare, but not send or save.
- `POST /debug/run`: runs one poll now. Add `?dry=1` to fetch and compare, but not send or save.
- `POST /debug/test-alert`: sends a test Telegram message.
- `GET /debug/items`: all stored items.

The `/debug` routes need `Authorization: Bearer <ADMIN_TOKEN>`.
The `/ingest` routes need `Authorization: Bearer <INGEST_TOKEN>`.
