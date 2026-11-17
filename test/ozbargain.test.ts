import { describe, expect, test } from "bun:test";
import { livePosts, parseFeed } from "../src/ozbargain";

const xml = await Bun.file(new URL("./fixtures/ozbargain-lego.xml", import.meta.url)).text();

describe("OzBargain feed parsing", () => {
  test("reads each post with decoded title, votes, start and end times", () => {
    const posts = parseFeed(xml);
    expect(posts).toHaveLength(10);
    expect(posts[1]).toEqual({
      id: "983542",
      title: "LEGO Star Wars Grogu's Homestead 75443 $3 + Delivery ($0 with OnePass/ $65 Order) @ Kmart",
      url: "https://www.ozbargain.com.au/node/983542",
      votesPos: 12,
      votesNeg: 0,
      starts: "2026-11-25T09:00:00.000Z",
      expires: "2026-11-16T23:47:30.000Z",
    });
  });

  test("throws on a page that is not the feed, so a block is not read as zero posts", () => {
    expect(() => parseFeed("<html>Access denied</html>")).toThrow("no <channel>");
  });

  test("drops posts that have ended", () => {
    const live = livePosts(parseFeed(xml), new Date("2026-11-17T00:00:00Z"));
    expect(live.map((p) => p.id)).not.toContain("983542");
    expect(live.length).toBeLessThan(10);
  });
});
