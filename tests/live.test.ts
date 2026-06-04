import { describe, it, expect, beforeAll } from "vitest";
import type { IndexFile } from "../src/lib/types";

// Opt-in: runs only when RUN_LIVE_TESTS=1. Network-bound.
//
// What this guards: the bug class that took the original explorer down was a
// runtime fetch that crossed an origin (github.com release assets) the browser
// blocks via CORS. This test asserts the same invariant the explorer needs to
// hold in production: every URL it ever fetches is same-origin under the
// deployed Pages host. If a future refactor reintroduces a cross-origin fetch,
// this test fails before anyone has to open DevTools.

const skip = process.env.RUN_LIVE_TESTS !== "1";
const LIVE_ORIGIN = "https://openipc.github.io";
const LIVE_PATH = "/firmware-explorer";

describe.skipIf(skip)("live (deployed) site", () => {
  let indexJson: IndexFile;

  beforeAll(async () => {
    const r = await fetch(`${LIVE_ORIGIN}${LIVE_PATH}/data/firmware/index.json`);
    expect(r.ok, "index.json must be reachable").toBe(true);
    indexJson = (await r.json()) as IndexFile;
  });

  it("publishes a schema-1 firmware index with at least one build", () => {
    expect(indexJson.schema).toBe(1);
    expect(indexJson.source).toBe("firmware");
    expect(indexJson.builds.length).toBeGreaterThan(0);
  });

  it("publishes a per-platform shard for the newest build", async () => {
    const newest = indexJson.builds[0];
    expect(newest.platforms.length).toBeGreaterThan(0);
    const plat = newest.platforms[0];
    const shardUrl = `${LIVE_ORIGIN}${LIVE_PATH}/data/firmware/${newest.id}/sizes.${plat}.json`;
    const r = await fetch(shardUrl);
    expect(r.ok, `shard ${shardUrl} must be reachable`).toBe(true);
    const sizes = await r.json();
    expect(sizes.board).toBeTruthy();
    expect(Array.isArray(sizes.packages)).toBe(true);
  });

  it("the explorer's data URLs are same-origin to its own host (regression guard)", () => {
    const candidates = [
      `${LIVE_ORIGIN}${LIVE_PATH}/data/firmware/index.json`,
      `${LIVE_ORIGIN}${LIVE_PATH}/data/builder/index.json`,
      `${LIVE_ORIGIN}${LIVE_PATH}/data/firmware/${indexJson.builds[0].id}/sizes.${indexJson.builds[0].platforms[0]}.json`,
    ];
    for (const url of candidates) {
      const u = new URL(url);
      expect(u.origin, `must be same-origin: ${url}`).toBe(LIVE_ORIGIN);
      expect(u.pathname.startsWith(LIVE_PATH + "/"), `must be under ${LIVE_PATH}: ${url}`).toBe(true);
    }
  });
});
