import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Bundle smell tests — run `npm run build` (or `RUN_LIVE_TESTS=1 ...`) before
// invoking these. Skipped automatically when `dist/` is absent.

const skip = !existsSync("./dist/assets");

describe.skipIf(skip)("dist/ bundle invariants", () => {
  const distDir = "./dist";
  const assetsDir = join(distDir, "assets");
  const jsFiles = existsSync(assetsDir)
    ? readdirSync(assetsDir).filter((f) => f.endsWith(".js"))
    : [];

  it("dist top-level files match expected set (no surprises)", () => {
    const top = readdirSync(distDir)
      .filter((f) => !f.startsWith("."))
      .sort();
    // Allow `data` to be present (per-platform shards) or absent (clean build).
    const expected = ["assets", "favicon.svg", "index.html"];
    for (const must of expected) {
      expect(top).toContain(must);
    }
    const unexpected = top.filter((f) => ![...expected, "data"].includes(f));
    expect(unexpected, `unexpected entries: ${unexpected.join(", ")}`).toEqual(
      [],
    );
  });

  it("ships at least one JS chunk", () => {
    expect(jsFiles.length).toBeGreaterThan(0);
  });

  it.each(jsFiles)(
    "%s does not embed a release-asset URL (no runtime cross-origin fetch)",
    (f) => {
      const content = readFileSync(join(assetsDir, f), "utf-8");
      // The bug class to keep dead: any literal pointing at the CORS-blocked
      // Azure backing store, or any release-download URL the explorer might
      // be tempted to fetch().
      expect(content).not.toMatch(/release-assets\.githubusercontent\.com/);
      expect(content).not.toMatch(/api\.github\.com\/repos\/.+\/releases\/assets/);
      expect(content).not.toMatch(/releases\/download\/[^"'`]+\.json/);
    },
  );

  it("index.html references a hashed JS asset under /firmware-explorer/", () => {
    const html = readFileSync(join(distDir, "index.html"), "utf-8");
    expect(html).toMatch(/\/firmware-explorer\/assets\/index-[^"]+\.js/);
  });

  it("JS bundle stays under 250 KB raw (perf budget)", () => {
    const main = jsFiles.find((f) => f.startsWith("index-"));
    expect(main, "expected an index-*.js chunk").toBeDefined();
    const size = statSync(join(assetsDir, main!)).size;
    expect(size, `bundle is ${(size / 1024).toFixed(0)} KB`).toBeLessThan(
      250 * 1024,
    );
  });
});
