#!/usr/bin/env -S tsx
/**
 * Build-time data aggregator.
 *
 * For each manifest source (firmware, builder), enumerates the last N nightly
 * release tags, downloads every `sizes.<plat>.json` asset SERVER-SIDE via the
 * `gh` CLI (CORS is structurally not a question here), and writes the files
 * into `public/data/<source>/<tag>/<plat>.json` plus a small
 * `public/data/<source>/index.json` catalogue.
 *
 * Vite copies `public/` verbatim into `dist/`, so the browser only ever fetches
 * same-origin URLs at runtime.
 *
 * Env switches:
 *   RETENTION=N          number of nightlies to retain (default 90).
 *   LIMIT=N              cap the number of tags processed (debug; default infinite).
 *   SOURCES=firmware     comma-separated subset (default firmware,builder).
 *   FORCE_REFETCH=1      ignore the on-disk cache and re-download every tag.
 *   QUIET=1              suppress per-tag progress output.
 *
 * The script is exported as `runPrebuild()` so unit tests can drive it with
 * mocked `gh` + filesystem hooks. Reaching for `gh` and `node:fs` directly is
 * reserved for the CLI entrypoint at the bottom.
 */

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCES = ["firmware", "builder"] as const;
export type Source = (typeof SOURCES)[number];

export const REPOS: Record<Source, string> = {
  firmware: "OpenIPC/firmware",
  builder: "OpenIPC/builder",
};

export const TAG_RE = /^nightly-\d{8}-[0-9a-f]{7}$/;
export const SIZES_RE = /^sizes\.(.+)\.json$/;

export type GhRelease = {
  tagName: string;
  createdAt: string;
  isPrerelease: boolean;
};

export type GhReleaseDetail = {
  tagName: string;
  createdAt: string;
  body: string;
  assets: Array<{ name: string; size: number }>;
};

export type Asset = { name: string; size: number };

export type BuildEntry = {
  id: string;
  sha: string;
  short: string;
  built_at: string;
  platforms: string[];
};

export type IndexFile = {
  schema: 1;
  source: Source;
  generated_at: string;
  retention: number;
  builds: BuildEntry[];
};

// Hookable shell-out + filesystem so unit tests can inject mocks without
// touching the real `gh` CLI or the actual filesystem.
export type GhFn = (args: string[]) => string;

export type FsHooks = {
  mkdir: (path: string) => void;
  write: (path: string, content: string | Uint8Array) => void;
  exists: (path: string) => boolean;
  copyDir: (from: string, to: string) => void;
  rmDir: (path: string) => void;
  listDir: (path: string) => string[];
};

export const defaultGh: GhFn = (args) =>
  execFileSync("gh", args, {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });

export const defaultFs: FsHooks = {
  mkdir: (p) => mkdirSync(p, { recursive: true }),
  write: (p, c) => writeFileSync(p, c),
  exists: existsSync,
  copyDir: (from, to) => cpSync(from, to, { recursive: true }),
  rmDir: (p) => rmSync(p, { recursive: true, force: true }),
  listDir: (p) => (existsSync(p) ? readdirSync(p) : []),
};

export function parseBody(body: string): {
  sha: string;
  short: string;
  built_at: string;
} {
  let sha = "";
  let short = "";
  let built_at = "";
  for (const line of (body ?? "").split("\n")) {
    if (line.startsWith("sha=")) sha = line.slice(4).trim();
    else if (line.startsWith("short=")) short = line.slice(6).trim();
    else if (line.startsWith("built_at=")) built_at = line.slice(9).trim();
  }
  return { sha, short, built_at };
}

export function platformFromAssetName(name: string): string | null {
  const m = SIZES_RE.exec(name);
  return m ? m[1] : null;
}

export type RunOpts = {
  outDir: string;
  cacheDir?: string;
  gh?: GhFn;
  fs?: FsHooks;
  sources?: readonly Source[];
  retention?: number;
  limit?: number;
  forceRefetch?: boolean;
  log?: (msg: string) => void;
};

export async function runPrebuild(opts: RunOpts): Promise<{
  builds: Record<Source, BuildEntry[]>;
}> {
  const gh = opts.gh ?? defaultGh;
  const fs = opts.fs ?? defaultFs;
  const sources = opts.sources ?? SOURCES;
  const retention = opts.retention ?? 90;
  const limit = opts.limit ?? Infinity;
  const forceRefetch = opts.forceRefetch ?? false;
  const log = opts.log ?? ((m: string) => console.log(m));
  const cacheDir = opts.cacheDir ?? join(tmpdir(), "firmware-explorer-prebuild");

  fs.mkdir(cacheDir);

  const out: Record<Source, BuildEntry[]> = { firmware: [], builder: [] };

  for (const source of sources) {
    const repo = REPOS[source];
    log(`[${source}] listing releases from ${repo}`);
    const releaseListRaw = gh([
      "release",
      "list",
      "--repo",
      repo,
      "--limit",
      "200",
      "--json",
      "tagName,createdAt,isPrerelease",
    ]);
    const allReleases = JSON.parse(releaseListRaw) as GhRelease[];
    const nightlies = allReleases
      .filter((r) => TAG_RE.test(r.tagName))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, retention);

    const tags = nightlies.slice(0, Math.min(limit, nightlies.length));
    log(`[${source}] processing ${tags.length} nightlies (retention=${retention}, limit=${limit})`);

    const sourceOut = join(opts.outDir, source);
    fs.mkdir(sourceOut);

    const builds: BuildEntry[] = [];

    for (const r of tags) {
      const tag = r.tagName;
      const tagOut = join(sourceOut, tag);
      const tagCache = join(cacheDir, source, tag);

      const cached =
        !forceRefetch &&
        fs.exists(tagCache) &&
        fs.listDir(tagCache).some((n) => n.endsWith(".json"));

      if (!cached) {
        log(`[${source}] ${tag} downloading sizes.*.json`);
        fs.rmDir(tagCache);
        fs.mkdir(tagCache);
        try {
          gh([
            "release",
            "download",
            tag,
            "--repo",
            repo,
            "--pattern",
            "sizes.*.json",
            "--dir",
            tagCache,
            "--skip-existing",
          ]);
        } catch (e) {
          log(`[${source}] ${tag} download failed: ${(e as Error).message}`);
          continue;
        }
      } else {
        log(`[${source}] ${tag} using cache`);
      }

      const downloaded = fs
        .listDir(tagCache)
        .filter((n) => SIZES_RE.test(n))
        .sort();

      if (downloaded.length === 0) {
        // No sizes.json assets on this release — skip.
        continue;
      }

      // Fetch release metadata (sha/short/built_at from the body).
      let detail: GhReleaseDetail;
      try {
        const raw = gh([
          "release",
          "view",
          tag,
          "--repo",
          repo,
          "--json",
          "tagName,createdAt,body,assets",
        ]);
        detail = JSON.parse(raw) as GhReleaseDetail;
      } catch (e) {
        log(`[${source}] ${tag} metadata fetch failed: ${(e as Error).message}`);
        continue;
      }

      const { sha, short, built_at } = parseBody(detail.body ?? "");

      fs.rmDir(tagOut);
      fs.mkdir(tagOut);
      fs.copyDir(tagCache, tagOut);

      const platforms = downloaded
        .map(platformFromAssetName)
        .filter((p): p is string => p !== null)
        .sort();

      builds.push({
        id: tag,
        sha,
        short,
        built_at: built_at || detail.createdAt,
        platforms,
      });
    }

    // Sort newest first for the index (matches manifest.json convention).
    builds.sort((a, b) => b.built_at.localeCompare(a.built_at));

    const index: IndexFile = {
      schema: 1,
      source,
      generated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      retention,
      builds,
    };
    fs.write(join(sourceOut, "index.json"), JSON.stringify(index, null, 2) + "\n");

    out[source] = builds;
    log(`[${source}] wrote index.json with ${builds.length} builds`);
  }

  return { builds: out };
}

// --- CLI entrypoint ---------------------------------------------------------

const isMain =
  import.meta.url.startsWith("file:") &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const outDir = "public/data";

  const retention = parseInt(process.env.RETENTION ?? "90", 10);
  const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;
  const sourcesEnv = process.env.SOURCES;
  const sources = sourcesEnv
    ? (sourcesEnv.split(",").map((s) => s.trim()) as Source[])
    : SOURCES;
  const forceRefetch = process.env.FORCE_REFETCH === "1";
  const quiet = process.env.QUIET === "1";

  defaultFs.mkdir(outDir);

  await runPrebuild({
    outDir,
    sources,
    retention,
    limit,
    forceRefetch,
    log: quiet ? () => {} : (m) => process.stderr.write(m + "\n"),
  });
}
