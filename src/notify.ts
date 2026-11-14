import { RETAILER_NAMES, STORES, storeName, type Settings } from "./config";
import type { Health } from "./db";
import { brisbaneDate, isGoodBuy, percentOff } from "./diff";
import type { Alert, AlertReason, Retailer, StoredItem } from "./types";

/** If a run finds more alerts than this, send one digest message. */
const DIGEST_THRESHOLD = 5;
/** Telegram rejects messages over 4096 characters. */
const MAX_TEXT = 4000;

/** `html: true` means `message` is already Telegram HTML and fits the limit. */
export type Message = { title: string; message: string; url?: string; silent?: boolean; html?: boolean };

export type TelegramConfig = { botToken?: string; chatId?: string };

export function telegramConfig(env: { TELEGRAM_BOT_TOKEN?: string; TELEGRAM_CHAT_ID?: string }): TelegramConfig {
  return { botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Builds the Telegram HTML text: bold title, body, then a link. */
export function toTelegramText(msg: Message): string {
  const link = msg.url ? `\n<a href="${escapeHtml(msg.url)}">Open product</a>` : "";
  const head = `<b>${escapeHtml(msg.title)}</b>\n`;
  if (msg.html) return head + msg.message + link;
  const room = MAX_TEXT - head.length - link.length;
  return head + escapeHtml(msg.message.slice(0, room)) + link;
}

export async function sendMessage({ botToken, chatId }: TelegramConfig, msg: Message): Promise<void> {
  if (!botToken || !chatId) throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set");
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: toTelegramText(msg),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      disable_notification: msg.silent ?? false,
    }),
  });
  // The URL holds the bot token, so the error text must not include it.
  if (!res.ok) throw new Error(`Telegram returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const REASON_TEXT: Record<AlertReason, string> = {
  "new-deal": "New deal",
  "price-drop": "Price drop",
  "back-in-stock": "Back in stock",
  watchlist: "Watchlist price hit",
};

const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

function priceLine(alert: Alert): string {
  const { item } = alert;
  const off = percentOff(item);
  return item.wasCents ? `${dollars(item.priceCents)} (was ${dollars(item.wasCents)}, ${Math.round(off)}% off)` : dollars(item.priceCents);
}

function storesLine(alert: Alert): string {
  const { item } = alert;
  if (item.stores.length === 0) return item.nationalStock ? "In stock online only. No watched store has it." : "No stock.";
  return item.stores
    .map((id) => {
      const store = STORES[item.retailer].find((s) => s.id === id);
      const name = storeName(item.retailer, id);
      const tag = alert.newStores.includes(id) ? " (new)" : "";
      return `- ${name}${tag}${store?.phone ? `, ${store.phone}` : ""}`;
    })
    .join("\n");
}

export function formatAlert(alert: Alert): Message {
  const { item } = alert;
  const set = item.setNumber ? ` ${item.setNumber}` : "";
  return {
    title: `${REASON_TEXT[alert.reason]}: ${RETAILER_NAMES[item.retailer]}${set} ${dollars(item.priceCents)}`,
    message: `${item.name}\n${priceLine(alert)}\nStores with stock:\n${storesLine(alert)}`,
    url: item.url,
  };
}

export function formatDigest(alerts: Alert[]): Message {
  const lines = alerts.map((a) => {
    const stores = a.item.stores.map((id) => storeName(a.item.retailer, id)).join(", ") || "online only";
    return `${RETAILER_NAMES[a.item.retailer]}: ${a.item.name}\n${priceLine(a)}\nStores: ${stores}\n${a.item.url}`;
  });
  return { title: `${alerts.length} LEGO deals found`, message: lines.join("\n\n") };
}

/** Sends one message per alert, or one digest when there are many. */
export async function sendAlerts(config: TelegramConfig, alerts: Alert[]): Promise<void> {
  if (alerts.length === 0) return;
  if (alerts.length > DIGEST_THRESHOLD) return sendMessage(config, formatDigest(alerts));
  for (const alert of alerts) await sendMessage(config, formatAlert(alert));
}

/**
 * Builds the daily message: the deals in stock at a watched store now, best first.
 * Shows a retailer problem only when its check fails, because then its list can be old.
 */
export function formatDailySummary(
  itemsByRetailer: Map<Retailer, StoredItem[]>,
  health: Map<Retailer, Health>,
  settings: Settings,
): Message {
  const sections: string[] = [];
  let total = 0;
  let room = MAX_TEXT - 200;

  for (const [retailer, items] of itemsByRetailer) {
    const name = RETAILER_NAMES[retailer];
    const h = health.get(retailer);
    // Items not seen in the last good run are no longer on clearance.
    const deals = items
      .filter((it) => it.lastSeen === h?.last_success && isGoodBuy(it, settings))
      .sort((a, b) => percentOff(b) - percentOff(a));
    total += deals.length;

    const warn = !h
      ? "\n<i>Not checked yet.</i>"
      : h.consecutive_failures > 0
        ? `\n<i>Check failing since ${h.last_success ? brisbaneDate(new Date(h.last_success)) : "start"}. List can be old.</i>`
        : "";

    const lines: string[] = [];
    for (const it of deals) {
      const stores = it.stores.map((id) => storeName(retailer, id)).join(", ") || "online only";
      const line = `• <a href="${escapeHtml(it.url)}">${escapeHtml(it.name)}</a>\n  ${escapeHtml(priceLine({ item: it, reason: "new-deal", newStores: [] }))} at ${escapeHtml(stores)}`;
      if (line.length + 1 > room) {
        lines.push(`…and ${deals.length - lines.length} more`);
        break;
      }
      room -= line.length + 1;
      lines.push(line);
    }
    const body = lines.length ? lines.join("\n") : "No deals in stock.";
    sections.push(`<b>${name}</b> (${deals.length})${warn}\n${body}`);
  }

  const rule = `Deal = ${settings.minPercentOff}%+ off, in stock at a Brisbane store you watch.`;
  return {
    title: total ? `${total} LEGO clearance deal${total === 1 ? "" : "s"} in stock` : "No LEGO clearance deals in stock today",
    message: `${sections.join("\n\n")}\n\n<i>${escapeHtml(rule)}</i>`,
    html: true,
    silent: total === 0,
  };
}
