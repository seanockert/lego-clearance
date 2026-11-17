import { brisbaneDate } from "./diff";
import { sendMessage, type Message, type TelegramConfig } from "./notify";
import { fetchText } from "./retailers/http";

const FEED_URL = "https://www.ozbargain.com.au/brand/lego/feed";
/** OzBargain blocks a browser user agent from a non-browser client, but allows a plain feed reader. */
const FEED_USER_AGENT = "lego-clearance-monitor/1.0 (RSS reader)";

export type OzbPost = {
  id: string;
  title: string;
  url: string;
  votesPos: number;
  votesNeg: number;
  /** ISO time the deal starts, if it starts later. */
  starts: string | null;
  /** ISO time the deal ends, if known. */
  expires: string | null;
};

function decodeXml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | null {
  const v = tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
  return v === undefined ? null : decodeXml(v);
}

function isoOrNull(s: string | null): string | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Parses the OzBargain RSS feed. Throws if the feed shape is not as expected. */
export function parseFeed(xml: string): OzbPost[] {
  if (!xml.includes("<channel>")) throw new Error("OzBargain: no <channel> in feed");
  const posts: OzbPost[] = [];
  for (const [, block = ""] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const url = block.match(/<link>([^<]*)<\/link>/)?.[1]?.trim();
    const id = url?.match(/\/node\/(\d+)/)?.[1];
    const title = block.match(/<title>([^<]*)<\/title>/)?.[1];
    if (!url || !id || !title) continue;
    const meta = block.match(/<ozb:meta\b[^>]*>/)?.[0] ?? "";
    posts.push({
      id,
      title: decodeXml(title).trim(),
      url,
      votesPos: Number(attr(meta, "votes-pos") ?? 0),
      votesNeg: Number(attr(meta, "votes-neg") ?? 0),
      starts: isoOrNull(attr(meta, "starting")),
      expires: isoOrNull(attr(meta, "expiry")),
    });
  }
  return posts;
}

/** Posts that have not ended. */
export function livePosts(posts: OzbPost[], now: Date): OzbPost[] {
  return posts.filter((p) => !p.expires || Date.parse(p.expires) > now.getTime());
}

export function formatPost(post: OzbPost, now: Date): Message {
  const lines = [post.title, `+${post.votesPos} / -${post.votesNeg} votes`];
  if (post.starts && Date.parse(post.starts) > now.getTime()) lines.push(`Starts ${brisbaneDate(new Date(post.starts))}`);
  if (post.expires) lines.push(`Ends ${brisbaneDate(new Date(post.expires))}`);
  return { title: "OzBargain LEGO deal", message: lines.join("\n"), url: post.url, linkText: "Open on OzBargain" };
}

export type OzbResult = { posts: number; fresh: OzbPost[]; firstRun: boolean };

/**
 * Reads the OzBargain LEGO feed and sends an alert for each live post not seen before.
 * On the first run (no posts stored), it saves the current posts without alerts.
 * A dry run reads and compares but does not send or save.
 */
export async function checkOzbargain(
  db: D1Database,
  telegram: TelegramConfig,
  now: Date,
  dryRun: boolean,
): Promise<OzbResult> {
  const posts = livePosts(parseFeed(await fetchText(FEED_URL, { headers: { "user-agent": FEED_USER_AGENT } })), now);
  const { results } = await db
    .prepare("SELECT id FROM ozb_posts WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(posts.map((p) => p.id)))
    .all<{ id: string }>();
  const seen = new Set(results.map((r) => r.id));
  const fresh = posts.filter((p) => !seen.has(p.id));
  const firstRun = (await db.prepare("SELECT 1 FROM ozb_posts LIMIT 1").first()) === null;
  if (dryRun || fresh.length === 0) return { posts: posts.length, fresh, firstRun };

  const nowIso = now.toISOString();
  for (const post of fresh) {
    // Save each post after its alert is sent, so a send failure gives a retry on the next run.
    if (!firstRun) await sendMessage(telegram, formatPost(post, now));
    await db.prepare("INSERT OR IGNORE INTO ozb_posts (id, title, seen_at) VALUES (?, ?, ?)").bind(post.id, post.title, nowIso).run();
  }
  return { posts: posts.length, fresh, firstRun };
}
