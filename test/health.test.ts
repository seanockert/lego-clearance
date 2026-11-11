import { describe, expect, test } from "bun:test";
import type { Health } from "../src/db";
import { nextHealth } from "../src/health";

const fail = { ok: false as const, error: "HTTP 403" };

describe("nextHealth", () => {
  test("sends one broken alert after 3 failures, not again after 4", () => {
    let h: Health | undefined;
    const notes: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      const r = nextHealth("bigw", h, fail, `t${i}`);
      h = r.health;
      notes.push(r.notify);
    }
    expect(notes).toEqual([null, null, "broken", null]);
    expect(h?.consecutive_failures).toBe(4);
  });

  test("sends recovered after a broken alert, and resets the counter", () => {
    let h = nextHealth("bigw", undefined, fail, "t0").health;
    h = nextHealth("bigw", h, fail, "t1").health;
    h = nextHealth("bigw", h, fail, "t2").health;
    const r = nextHealth("bigw", h, { ok: true, count: 10 }, "t3");
    expect(r.notify).toBe("recovered");
    expect(r.health).toMatchObject({ consecutive_failures: 0, broken_alert_sent: 0, item_count: 10 });
  });

  test("one failure then success sends nothing", () => {
    const h = nextHealth("bigw", undefined, fail, "t0").health;
    expect(nextHealth("bigw", h, { ok: true, count: 1 }, "t1").notify).toBeNull();
  });
});
