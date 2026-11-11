import type { Health } from "./db";
import type { Retailer } from "./types";

/** Failed runs in a row before the "monitor broken" alert. */
export const FAILURE_THRESHOLD = 3;

export type FetchResult = { ok: true; count: number } | { ok: false; error: string };

/** Returns the new health of a retailer and the status alert to send, if any. */
export function nextHealth(
  retailer: Retailer,
  prev: Health | undefined,
  result: FetchResult,
  now: string,
): { health: Health; notify: "broken" | "recovered" | null } {
  if (result.ok) {
    return {
      health: {
        retailer,
        consecutive_failures: 0,
        broken_alert_sent: 0,
        last_error: null,
        last_success: now,
        last_run: now,
        item_count: result.count,
      },
      notify: prev?.broken_alert_sent ? "recovered" : null,
    };
  }
  const failures = (prev?.consecutive_failures ?? 0) + 1;
  const sendBroken = failures >= FAILURE_THRESHOLD && !prev?.broken_alert_sent;
  return {
    health: {
      retailer,
      consecutive_failures: failures,
      broken_alert_sent: sendBroken || prev?.broken_alert_sent ? 1 : 0,
      last_error: result.error.slice(0, 500),
      last_success: prev?.last_success ?? null,
      last_run: now,
      item_count: prev?.item_count ?? null,
    },
    notify: sendBroken ? "broken" : null,
  };
}
