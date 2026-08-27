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
  readFileSync,
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
// Completion marker the upstream publish job uploads to the dated release LAST,
// once every other asset has landed. Its presence is the single source of truth
// that the release finished publishing; a dated release missing it was either
// truncated mid-upload (GitHub secondary rate limit) or is still in flight. See
// hasCompletionMarker() and the boundary gate in runPrebuild().
export const MANIFEST_ASSET = "_manifest.json";
export const KCONFIG_GRAPH_RE = /^kconfig-graph\.(.+)\.json$/;
export const KCONFIG_HELP_RE = /^kconfig-help\.(.+)\.json$/;

export type GhRelease = {
  tagName: string;
  createdAt: string;
  isPrerelease: boolean;
};

export type GhReleaseDetail = {
  tagName: string;
  createdAt: string;
  body: string;
  assets: Array<{ name: string; size: number; downloadUrl?: string }>;
};

/**
 * Raw shape of `GET /repos/:owner/:repo/releases` — we consume this and
 * reshape into GhReleaseDetail. Named to match the API field casing so the
 * translation site is obvious.
 */
type ReleaseApiRow = {
  tag_name: string;
  created_at: string;
  prerelease: boolean;
  body: string | null;
  assets: Array<{
    name: string;
    size: number;
    browser_download_url: string;
  }>;
};

/**
 * Page sizes tried in order by fetchReleases, largest first. See its doc
 * comment for why the API's `per_page=100` cap is off the table.
 */
export const RELEASE_PAGE_SIZES = [20, 10, 5] as const;

/** Upper bound on releases enumerated per source, independent of page size. */
export const MAX_RELEASES = 500;

/**
 * Paginated `gh api /repos/:owner/:repo/releases`. Returns every release with
 * its full metadata + asset list + download URLs in one place, replacing the
 * old `gh release list` + per-tag `gh release view` pattern that cost ~91
 * API calls per source.
 *
 * We deliberately do NOT use the API's `per_page=100` cap. This endpoint
 * embeds each release's *entire* asset array inline, and OpenIPC nightlies
 * carry ~400 assets apiece — so a 100-release page is ~40k asset objects and
 * >50 MB of JSON, which GitHub's gateway cannot render inside its ~10s budget.
 * It answers HTTP 504, or begins streaming and then resets the HTTP/2 stream
 * mid-body (`stream error: stream ID 1; CANCEL; received from peer`), leaving
 * a truncated payload and a non-zero exit. That is a *deterministic* failure,
 * not a transient one, so the `defaultGh` retry ladder cannot clear it — it
 * broke run 33087500142 on both sources. Measured against OpenIPC/firmware:
 * per_page=100 → 504 · 50 → 11.0s/29 MB · 30 → 7.7s/20 MB · 20 → 4.7s/13 MB.
 *
 * So we page at 20 (roughly 2x headroom) and, because asset counts keep
 * creeping up, degrade to smaller pages if a rung ever times out anyway.
 * A page size change shifts every page boundary, so a lower rung restarts the
 * enumeration from page 1 rather than trying to resume mid-stream.
 */
export function fetchReleases(
  gh: GhFn,
  repo: string,
  pageSizes: readonly number[] = RELEASE_PAGE_SIZES,
): { list: GhRelease[]; detail: Map<string, GhReleaseDetail> } {
  let lastErr: unknown;
  for (const perPage of pageSizes) {
    try {
      return enumerateReleases(gh, repo, perPage);
    } catch (err) {
      lastErr = err;
      console.error(
        `[${repo}] /releases?per_page=${perPage} failed (${(err as Error).message?.split("\n")[0]}); ` +
          `retrying enumeration at a smaller page size`,
      );
    }
  }
  throw lastErr;
}

/**
 * One full enumeration pass at a fixed page size. Stops early on the first
 * partial page (< perPage rows) since GitHub returns releases in strict
 * newest-first order.
 */
function enumerateReleases(
  gh: GhFn,
  repo: string,
  perPage: number,
): { list: GhRelease[]; detail: Map<string, GhReleaseDetail> } {
  const maxPages = Math.ceil(MAX_RELEASES / perPage);
  const list: GhRelease[] = [];
  const detail = new Map<string, GhReleaseDetail>();
  for (let page = 1; page <= maxPages; page++) {
    const raw = gh([
      "api",
      "-H",
      "Accept: application/vnd.github+json",
      `/repos/${repo}/releases?per_page=${perPage}&page=${page}`,
    ]);
    const rows = JSON.parse(raw) as ReleaseApiRow[];
    for (const row of rows) {
      list.push({
        tagName: row.tag_name,
        createdAt: row.created_at,
        isPrerelease: row.prerelease,
      });
      detail.set(row.tag_name, {
        tagName: row.tag_name,
        createdAt: row.created_at,
        body: row.body ?? "",
        assets: row.assets.map((a) => ({
          name: a.name,
          size: a.size,
          downloadUrl: a.browser_download_url,
        })),
      });
    }
    if (rows.length < perPage) break;
  }
  return { list, detail };
}

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
  // v0.3 addition: which platforms have kconfig-graph data available under
  // ./data/<source>/kconfig/. Per-source (not per-build) — the configurator
  // ships the latest graph snapshot only, because Kconfig dep relations
  // evolve too slowly for per-build to be worth the storage hit.
  // Older clients ignore this field (forward-compatible).
  kconfig_available_for?: string[];
};

// Hookable shell-out + filesystem so unit tests can inject mocks without
// touching the real `gh` CLI or the actual filesystem.
export type GhFn = (args: string[]) => string;

export type FsHooks = {
  mkdir: (path: string) => void;
  write: (path: string, content: string | Uint8Array) => void;
  read: (path: string) => string;
  exists: (path: string) => boolean;
  copyDir: (from: string, to: string) => void;
  rmDir: (path: string) => void;
  listDir: (path: string) => string[];
};

export const defaultGh: GhFn = (args) => {
  const delays = [5000, 15000, 30000];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return execFileSync("gh", args, {
        encoding: "utf-8",
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (err) {
      lastErr = err;
      if (attempt < delays.length) {
        const delay = delays[attempt];
        console.error(
          `gh api failed (attempt ${attempt + 1}/${delays.length + 1}), retrying in ${delay / 1000}s: ${(err as Error).message?.split("\n")[0]}`,
        );
        // Synchronous sleep via Atomics — no async plumbing needed here.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
      }
    }
  }
  throw lastErr;
};

/**
 * Asset-byte fetcher, split off `GhFn` so the runtime can bypass the
 * GitHub API entirely for asset downloads. `browser_download_url` on
 * public releases is served anonymously by github.com (302 to a signed
 * CDN URL) and consumes zero of the installation's API rate-limit
 * bucket — the ~9000-call/day nightly cost is the root of the
 * consecutive-cron failures (runs 28646280479 / 28698970626 /
 * 28733698722).
 *
 * `curl --retry 5 --retry-delay 5 --retry-connrefused` handles genuine
 * transient network failures (timeouts, DNS blips, CDN 5xx) natively
 * so we don't need our own retry loop layered on top.
 */
export type HttpFn = (url: string, target: string) => void;
export const defaultHttp: HttpFn = (url, target) =>
  execFileSync(
    "curl",
    [
      "-fsSL",
      "--retry",
      "5",
      "--retry-delay",
      "5",
      "--retry-all-errors",
      "-o",
      target,
      url,
    ],
    { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
  );

export const defaultFs: FsHooks = {
  mkdir: (p) => mkdirSync(p, { recursive: true }),
  write: (p, c) => writeFileSync(p, c),
  read: (p) => readFileSync(p, "utf-8"),
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

export function platformFromKconfigGraphName(name: string): string | null {
  const m = KCONFIG_GRAPH_RE.exec(name);
  return m ? m[1] : null;
}

/**
 * True when the release carries the completion marker (`_manifest.json`),
 * i.e. the upstream publish job finished uploading every asset. Used to keep
 * partially-published / in-flight dated releases out of the catalogue.
 */
export function hasCompletionMarker(
  detail: GhReleaseDetail | undefined,
): boolean {
  return !!detail?.assets?.some((a) => a.name === MANIFEST_ASSET);
}

export type RunOpts = {
  outDir: string;
  cacheDir?: string;
  gh?: GhFn;
  http?: HttpFn;
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
  const http = opts.http ?? defaultHttp;
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
    log(`[${source}] enumerating releases from ${repo}`);
    // One paginated `gh api /releases` walk yields every release with its
    // metadata + asset URLs. Replaces the old `release list` (1 call) plus
    // per-tag `release view` (~retention calls) — cuts enumeration cost from
    // ~91 to a handful of API calls per source. See fetchReleases for why the
    // page size is well below the API's per_page=100 cap.
    const { list, detail: details } = fetchReleases(gh, repo);
    const nightlies = list
      .filter((r) => TAG_RE.test(r.tagName))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, retention);

    const tags = nightlies.slice(0, Math.min(limit, nightlies.length));
    log(`[${source}] processing ${tags.length} nightlies (retention=${retention}, limit=${limit})`);

    const sourceOut = join(opts.outDir, source);
    fs.mkdir(sourceOut);

    const builds: BuildEntry[] = [];

    // Completeness boundary. Upstream's publish job uploads the `_manifest.json`
    // marker LAST, so a build NEWER than the newest marked build that lacks its
    // own marker is a publish still in flight (or one that died on the GitHub
    // secondary rate limit mid-upload) — it must not enter the catalogue as a
    // complete build. Builds at or older than the newest marker that lack one
    // are legacy (pre-marker) history and are trusted as-is, preserving the
    // historical window. When no retained tag carries a marker (pre-rollout of
    // the upstream fix), newestMarkerIdx is -1 and this gate is fully inert —
    // every build is ingested exactly as before.
    const newestMarkerIdx = tags.findIndex((r) =>
      hasCompletionMarker(details.get(r.tagName)),
    );
    const inMarkerEra = newestMarkerIdx !== -1;

    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i].tagName;
      const tagOut = join(sourceOut, tag);
      const tagCache = join(cacheDir, source, tag);

      const detail = details.get(tag);
      if (!detail) continue; // metadata unavailable — cannot assess; skip.

      if (inMarkerEra && i < newestMarkerIdx && !hasCompletionMarker(detail)) {
        log(
          `[${source}] ${tag} no completion marker and newer than newest published build — skipping (publish likely in flight)`,
        );
        continue;
      }

      // The release advertises every asset it holds, so the count of `sizes.*`
      // assets is the authoritative expected shard count. A cache holding fewer
      // shards than that is a partial download from an earlier rate-limited run
      // and must be re-fetched rather than served as final.
      const expectedSizes = detail.assets.filter((a) =>
        SIZES_RE.test(a.name),
      ).length;
      const cachedShards = fs
        .listDir(tagCache)
        .filter((n) => SIZES_RE.test(n)).length;
      const cached =
        !forceRefetch && expectedSizes > 0 && cachedShards >= expectedSizes;

      if (!cached) {
        log(`[${source}] ${tag} downloading sizes.*.json`);
        fs.rmDir(tagCache);
        fs.mkdir(tagCache);
        // Anonymous HTTPS to browser_download_url — bypasses the API bucket
        // entirely. This is the single biggest saving vs the old `gh release
        // download` path, which internally makes one API call per asset (~97
        // calls per tag × 90 tags = ~8700 API calls per source per run).
        try {
          for (const asset of detail.assets) {
            if (!SIZES_RE.test(asset.name)) continue;
            if (!asset.downloadUrl) {
              throw new Error(`no browser_download_url on ${asset.name}`);
            }
            http(asset.downloadUrl, join(tagCache, asset.name));
          }
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

    // v0.3: pull Kconfig graph from the newest tag only. The graph evolves
    // slowly relative to nightly cadence; per-build kconfig storage was
    // measured at ~3 GB raw across the retention window for negligible UX
    // gain. The newest snapshot is good enough for "what can I disable on
    // this board?". Help text ships per-platform alongside (small).
    const kconfigAvailableFor = await downloadKconfig({
      builds,
      source,
      details,
      sourceOut,
      cacheDir,
      forceRefetch,
      http,
      fs,
      log,
    });

    // v0.4: aggregate every (build × platform) sizes shard into a per-platform
    // time-series file so the explorer can render historical drift charts
    // without fetching 90+ shards client-side. Computed in-runner; cheap
    // because we already have the shards on disk.
    emitTrends({
      builds,
      source,
      sourceOut,
      fs,
      log,
    });

    const index: IndexFile = {
      schema: 1,
      source,
      generated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      retention,
      builds,
      ...(kconfigAvailableFor.length > 0
        ? { kconfig_available_for: kconfigAvailableFor }
        : {}),
    };
    fs.write(join(sourceOut, "index.json"), JSON.stringify(index, null, 2) + "\n");

    out[source] = builds;
    log(`[${source}] wrote index.json with ${builds.length} builds`);
  }

  return { builds: out };
}

// ---------------------------------------------------------------------------
// Trends aggregation (v0.4)
// ---------------------------------------------------------------------------

type SeriesPoint = {
  build_id: string;
  built_at: string;
  bytes: number;
};

type HeadroomPoint = {
  build_id: string;
  built_at: string;
  used_kb: number;
  cap_kb: number;
  headroom_kb: number | null;
};

type PlatformAccumulator = {
  packages: Record<string, SeriesPoint[]>;
  modules: Record<string, SeriesPoint[]>;
  headroom_rootfs: HeadroomPoint[];
  headroom_kernel: HeadroomPoint[];
};

/**
 * Walk every (build × platform) sizes shard on disk and emit per-platform
 * time-series files at `<sourceOut>/trends/trends.<platform>.json`. The shape
 * matches `src/lib/timeseries.ts`'s `TrendsFile` exactly so the runtime can
 * fetch and consume without a remap step.
 *
 * Memory note: per-platform aggregation only allocates while a single
 * platform's shards are being read; entries land in `acc` keyed by platform
 * but each shard's JSON is dropped after extraction.
 */
function emitTrends(opts: {
  builds: BuildEntry[];
  source: Source;
  sourceOut: string;
  fs: FsHooks;
  log: (msg: string) => void;
}): void {
  const { builds, source, sourceOut, fs, log } = opts;
  const trendsOut = join(sourceOut, "trends");

  const acc = new Map<string, PlatformAccumulator>();
  const bucket = (plat: string): PlatformAccumulator => {
    let b = acc.get(plat);
    if (!b) {
      b = { packages: {}, modules: {}, headroom_rootfs: [], headroom_kernel: [] };
      acc.set(plat, b);
    }
    return b;
  };

  for (const build of builds) {
    for (const plat of build.platforms) {
      const shardPath = join(sourceOut, build.id, `sizes.${plat}.json`);
      if (!fs.exists(shardPath)) continue;

      let sizes: {
        packages?: Array<{ name: string; uncompressed_bytes: number }>;
        linux_components?: { modules?: Array<{ name: string; bytes: number }> };
        headroom?: {
          rootfs?: { used_kb: number; cap_kb: number; headroom_kb: number | null };
          kernel?: { used_kb: number; cap_kb: number; headroom_kb: number | null };
        };
      };
      try {
        sizes = JSON.parse(fs.read(shardPath));
      } catch (e) {
        log(`[${source}] ${build.id}/${plat} shard parse failed: ${(e as Error).message}`);
        continue;
      }

      const b = bucket(plat);
      const stamp = {
        build_id: build.id,
        built_at: build.built_at,
      };

      for (const p of sizes.packages ?? []) {
        (b.packages[p.name] ??= []).push({ ...stamp, bytes: p.uncompressed_bytes });
      }
      for (const m of sizes.linux_components?.modules ?? []) {
        (b.modules[m.name] ??= []).push({ ...stamp, bytes: m.bytes });
      }
      if (sizes.headroom?.rootfs) {
        b.headroom_rootfs.push({ ...stamp, ...sizes.headroom.rootfs });
      }
      if (sizes.headroom?.kernel) {
        b.headroom_kernel.push({ ...stamp, ...sizes.headroom.kernel });
      }
    }
  }

  fs.rmDir(trendsOut);
  fs.mkdir(trendsOut);

  let written = 0;
  for (const [plat, b] of acc) {
    // Sort series ascending by built_at so consumers don't have to.
    const sortPoints = (a: SeriesPoint, c: SeriesPoint) =>
      a.built_at.localeCompare(c.built_at);
    const sortHead = (a: HeadroomPoint, c: HeadroomPoint) =>
      a.built_at.localeCompare(c.built_at);
    for (const series of Object.values(b.packages)) series.sort(sortPoints);
    for (const series of Object.values(b.modules)) series.sort(sortPoints);
    b.headroom_rootfs.sort(sortHead);
    b.headroom_kernel.sort(sortHead);

    const out = {
      schema: 1,
      source,
      platform: plat,
      generated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      packages: b.packages,
      modules: b.modules,
      headroom_rootfs: b.headroom_rootfs,
      headroom_kernel: b.headroom_kernel,
    };
    fs.write(join(trendsOut, `trends.${plat}.json`), JSON.stringify(out) + "\n");
    written++;
  }
  log(`[${source}] wrote trends for ${written} platforms`);
}

/**
 * Walk the build list newest-first and download Kconfig assets from the first
 * tag that has them. Files land at:
 *   <sourceOut>/kconfig/<platform>.json          (graph, what user can toggle)
 *   <sourceOut>/kconfig/<platform>.help.json     (per-symbol help, lazy-load)
 * Returns the platform-name list for the index's `kconfig_available_for`.
 */
async function downloadKconfig(args: {
  builds: BuildEntry[];
  source: Source;
  details: Map<string, GhReleaseDetail>;
  sourceOut: string;
  cacheDir: string;
  forceRefetch: boolean;
  http: HttpFn;
  fs: FsHooks;
  log: (msg: string) => void;
}): Promise<string[]> {
  const { builds, source, details, sourceOut, cacheDir, forceRefetch, http, fs, log } = args;
  const kconfigOut = join(sourceOut, "kconfig");

  for (const build of builds) {
    const tag = build.id;
    const kcCache = join(cacheDir, source, tag, "kconfig");
    const detail = details.get(tag);

    const cached =
      !forceRefetch &&
      fs.exists(kcCache) &&
      fs.listDir(kcCache).some((n) => KCONFIG_GRAPH_RE.test(n));

    if (!cached) {
      if (!detail) continue;
      const kconfigAssets = detail.assets.filter(
        (a) => KCONFIG_GRAPH_RE.test(a.name) || KCONFIG_HELP_RE.test(a.name),
      );
      if (kconfigAssets.length === 0) continue; // no kconfig on this tag
      fs.rmDir(kcCache);
      fs.mkdir(kcCache);
      try {
        for (const asset of kconfigAssets) {
          if (!asset.downloadUrl) {
            throw new Error(`no browser_download_url on ${asset.name}`);
          }
          http(asset.downloadUrl, join(kcCache, asset.name));
        }
      } catch (e) {
        log(`[${source}] ${tag} kconfig download failed: ${(e as Error).message}`);
        continue;
      }
    }

    const graphs = fs.listDir(kcCache).filter((n) => KCONFIG_GRAPH_RE.test(n));
    if (graphs.length === 0) continue;

    // Copy verbatim — the explorer fetches by the original
    // kconfig-graph.<plat>.json / kconfig-help.<plat>.json filenames.
    fs.rmDir(kconfigOut);
    fs.mkdir(kconfigOut);
    fs.copyDir(kcCache, kconfigOut);

    const platforms = graphs
      .map(platformFromKconfigGraphName)
      .filter((p): p is string => p !== null)
      .sort();
    log(`[${source}] kconfig from ${tag}: ${platforms.length} platforms`);
    return platforms;
  }

  log(`[${source}] no kconfig assets found in any retained tag`);
  return [];
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
