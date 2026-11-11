const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    snippet: string,
  ) {
    super(`HTTP ${status} from ${new URL(url).host}: ${snippet}`);
  }
}

/** Fetches JSON. Throws HttpError on a non-2xx status and Error on a body that is not JSON. */
export async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { "user-agent": USER_AGENT, accept: "application/json", ...init.headers },
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(url, res.status, text.slice(0, 200));
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Response from ${new URL(url).host} is not JSON: ${text.slice(0, 200)}`);
  }
}

/** Returns the LEGO set number in a product name: the last 4 to 6 digit number. */
export function parseSetNumber(name: string): string | null {
  const matches = name.match(/(?<![\d.$])\d{4,6}(?![\d.])/g);
  return matches?.at(-1) ?? null;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
