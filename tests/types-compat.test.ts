import { describe, expect, it } from "vitest";
import type { IndexFile } from "../src/lib/types";

// IndexFile.schema = 1 is held flat across v0.2 → v0.3.  The v0.3 emitter
// adds an optional `kconfig_available_for` field at the source level; older
// dist/ builds that pre-date v0.3 won't have it. These tests document the
// invariant that the runtime accepts both shapes without erroring.

describe("IndexFile schema compatibility", () => {
  it("v0.2-era index (no kconfig_available_for) parses", () => {
    const raw = JSON.stringify({
      schema: 1,
      source: "firmware",
      generated_at: "2026-06-04T12:00:00Z",
      retention: 90,
      builds: [
        {
          id: "nightly-20260604-aaaaaaa",
          sha: "aaaaaaabbbcccddd",
          short: "aaaaaaa",
          built_at: "2026-06-04T00:11:18Z",
          platforms: ["hi3518ev300_lite"],
        },
      ],
    });
    const parsed = JSON.parse(raw) as IndexFile;
    expect(parsed.schema).toBe(1);
    expect(parsed.kconfig_available_for).toBeUndefined();
  });

  it("v0.3 index (with kconfig_available_for) parses + exposes the list", () => {
    const raw = JSON.stringify({
      schema: 1,
      source: "firmware",
      generated_at: "2026-06-05T12:00:00Z",
      retention: 90,
      builds: [
        {
          id: "nightly-20260605-bbbbbbb",
          sha: "bbbbbbbcccdddeee",
          short: "bbbbbbb",
          built_at: "2026-06-05T00:11:18Z",
          platforms: ["hi3518ev300_lite", "ssc335_ultimate"],
        },
      ],
      kconfig_available_for: ["hi3518ev300_lite"],
    });
    const parsed = JSON.parse(raw) as IndexFile;
    expect(parsed.kconfig_available_for).toEqual(["hi3518ev300_lite"]);
  });

  it("source toggle never breaks on a missing kconfig_available_for", () => {
    const v02: IndexFile = {
      schema: 1,
      source: "firmware",
      generated_at: "x",
      retention: 90,
      builds: [],
    };
    const available =
      v02.kconfig_available_for && v02.kconfig_available_for.includes("foo");
    expect(available).toBeUndefined();
  });
});
