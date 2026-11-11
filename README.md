# LEGO Clearance Monitor

A Cloudflare Worker that sends a Telegram alert when a LEGO set is marked down at Big W or Target and is in stock at a watched Brisbane store.

## How it works

Every 15 minutes, the Worker:

1. Reads all LEGO clearance items from each retailer.
2. Reads which watched stores have each item in stock.
3. Compares the result with the last state in D1.
4. Sends a Telegram alert for a new deal (40% or more off, in stock at a watched store), a price drop, or new stock at a watched store.

Each day at 8am Brisbane time, it sends a status message.
After 3 failed runs in a row for a retailer, it sends a "monitor broken" alert.

## Data sources

- **Big W**: `POST https://api.bigw.com.au/search/v1/search` with `filter: {brand: ["LEGO"], deal: ["Clearance"]}`.
  With a `storeId`, the `stock` field gives the stock at that store.
  Big W does not show quantities.
- **Target**:
  - Clearance items: the public page `https://www.target.com.au/c/toys/lego/W152974?clearance=True`.
    The products are in the page's `__NEXT_DATA__` JSON.
  - Store stock: the Constructor.io search API that Target's pages use, with the public site key from the same page.
    The `instorestockpot` field lists the stores that have the item.
    In tests, this data matched the in-store check on Target's product page, but it may be "any stock in the area" more than exact shelf stock.
  - Was-price: Target shows none on clearance items.
    Each run reads one page of the full LEGO catalogue (all pages every 3 hours) and saves the normal price of each set in `regular_prices`.
    A clearance item is compared with its last normal price.
    An item that was already on clearance when the monitor first saw it has no was-price, so it does not alert.

## Settings

Vars in `wrangler.jsonc`:

- `MIN_PERCENT_OFF`: minimum % off the was-price for an alert. Default `40`.
- `WATCHLIST`: JSON object of set number to target price in dollars, for example `{"77078": 100}`.

Secrets (set with `bunx wrangler secret put <NAME>`):

- `TELEGRAM_BOT_TOKEN`: token of the bot that sends alerts. Get it from @BotFather.
- `TELEGRAM_CHAT_ID`: your chat ID with the bot. Send the bot a message, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `chat.id`.
- `ADMIN_TOKEN`: bearer token for the `/debug` routes.

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
- `POST /debug/run`: runs one poll now. Add `?dry=1` to fetch and compare, but not send or save.
- `POST /debug/test-alert`: sends a test Telegram message.
- `GET /debug/items`: all stored items.

The `/debug` routes need `Authorization: Bearer <ADMIN_TOKEN>`.
