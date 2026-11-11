import { RETAILER_NAMES, STORES, storeName } from "./config";
import { percentOff } from "./diff";
import type { Alert, AlertReason } from "./types";

/** If a run finds more alerts than this, send one digest message. */
const DIGEST_THRESHOLD = 5;
/** Telegram rejects messages over 4096 characters. */
const MAX_TEXT = 4000;

export type Message = { title: string; message: string; url?: string; silent?: boolean };

export type TelegramConfig = { botToken?: string; chatId?: string };

export function telegramConfig(env: { TELEGRAM_BOT_TOKEN?: string; TELEGRAM_CHAT_ID?: string }): TelegramConfig {
  return { botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Builds the Telegram HTML text: bold title, body, then a link. */
export function toTelegramText(msg: Message): string {
  const link = msg.url ? `\n<a href="${escapeHtml(msg.url)}">Open product</a>` : "";
  const head = `<b>${escapeHtml(msg.title)}</b>\n`;
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
