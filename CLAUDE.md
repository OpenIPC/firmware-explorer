# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, single-page React explorer for OpenIPC firmware build composition — per-build package sizes, kernel modules, finalize-removed files, drift between builds, historical trends, and a Kconfig-aware "what-if" configurator. Deployed to GitHub Pages at `https://openipc.github.io/firmware-explorer/`.

## Commands

```bash
npm run dev          # vite dev server at http://localhost:5173/firmware-explorer/
npm run build        # prebuild (downloads data via gh) → tsc -b → vite build → dist/
npm run build:app    # tsc -b → vite build only — no prebuild, no gh, no token
npm test             # vitest run — full suite; 3 live tests skip unless RUN_LIVE_TESTS=1
npm run test:watch   # vitest in watch mode
npm run prebuild     # data aggregator only (tsx scripts/prebuild.mts)
RUN_LIVE_TESTS=1 npm test   # include tests that hit the real gh CLI / network
```

Run a single test file or test: `npx vitest run tests/kconfig.test.ts` or `npx vitest run -t "closeDisable"`.

`npm run dev` works against whatever is already under `public/data/` — you do **not** need to run the prebuild (which requires an authenticated `gh` CLI) just to iterate on the UI. Run the prebuild only when you need to refresh or regenerate the baked data. Prebuild knobs (env vars): `RETENTION` (default 90), `LIMIT` (cap tags, for fast iteration e.g. `LIMIT=3`), `SOURCES` (`firmware,builder`), `FORCE_REFETCH=1`, `QUIET=1`. The `gh release download` cache lives at `/tmp/firmware-explorer-prebuild/`.

## The one architectural invariant: no runtime cross-origin fetch

This is a **build-time aggregator, not a runtime fetcher**, and that is the central design decision — read it before touching any fetch path.

The source data lives in GitHub release assets on `OpenIPC/firmware` and `OpenIPC/builder`. Those assets do **not** set `Access-Control-Allow-Origin`, so a browser `fetch()` of them is CORS-blocked (an earlier version of this tool only appeared to work because `curl` has no CORS gate). The fix is structural: `scripts/prebuild.mts` downloads every `sizes.*.json` / `kconfig-*.json` asset **server-side via the `gh` CLI** during CI, writes them under `public/data/`, and Vite copies `public/` into `dist/`. At runtime the browser only ever fetches **same-origin relative URLs** (`./data/...`).

Consequences when editing:
- Every runtime fetch URL is a relative `./data/...` path. The helpers `indexUrl`/`sizesUrl`/`kconfigGraphUrl`/`kconfigHelpUrl` (in `src/lib/`) are the only places that build these — keep them relative. Never introduce a `fetch()` of a `github.com`, `api.github.com`, or `releases/download/...` URL in `src/`.
- `tests/bundle.test.ts` enforces this by grepping the **production JS bundle** for the killer URL patterns. It skips itself when `dist/` is absent, so a bare `npm test` does not run it — you must build first. Both CI workflows therefore run `npm test` *after* a build: `ci.yml` on every PR (via `build:app`, no data needed) and `pages.yml` after the real build. Order matters — a `npm test` that runs before the build silently drops this invariant, which is how it went unenforced in CI until 2026-08-27. If you add a new data type, add its same-origin invariant there too (as was done for kconfig and trends).
- Two footguns when checking this locally: a **stale** `dist/` makes the test validate an old bundle, and `tsc -b && vite build` short-circuits on a type error leaving the previous `dist/` in place. Always `rm -rf dist` and watch the build output before trusting a pass.

## Data flow

```
prebuild.mts (CI, server-side gh)
  └─ public/data/<source>/index.json              IndexFile — build catalogue
  └─ public/data/<source>/<tag>/sizes.<plat>.json  Sizes — verbatim size_report.py output
  └─ public/data/<source>/kconfig/kconfig-{graph,help}.<plat>.json
  └─ public/data/<source>/trends/trends.<plat>.json   per-platform time-series (computed in-runner)
        │  (Vite copies public/ → dist/, deployed to gh-pages)
        ▼
App.tsx  fetchIndex → fetchPlatformSizes → render tabs
```

- **`<source>`** is `firmware` (OpenIPC/firmware nightlies) or `builder` (OpenIPC/builder per-device nightlies), toggled in the header. `Source` is defined in both `src/lib/types.ts` and `scripts/prebuild.mts` — keep them in sync.
- `prebuild.mts` walks nightly tags matching `TAG_RE` (`nightly-YYYYMMDD-<7hex>`), parses `sha`/`short`/`built_at` from the release body, and aggregates. **kconfig** is pulled from the newest tag only (deps evolve slowly; per-build would cost ~3 GB). **trends** are computed in-runner by re-reading every shard already on disk — no extra downloads.
- `runPrebuild()` takes injectable `gh` and `fs` hooks so unit tests drive it with mocks; the bare `gh`/`node:fs` calls are reserved for the CLI entrypoint at the bottom of the file. Preserve that seam when editing.

## Schema contract

`Sizes` (`src/lib/types.ts`) mirrors the output of upstream `OpenIPC/firmware:general/scripts/size_report.py` — this repo copies those JSON files **verbatim**, it does not define their shape. A schema bump on the upstream emitter requires a matching change to `types.ts`. `IndexFile` and `trends.*.json` *are* defined here. Both index/sizes carry `schema: 1`; `fetchIndex` hard-rejects any other index schema.

## App structure

`src/App.tsx` owns all view state (`source`, `buildId`, `platform`, `compareBuildId`, `tab`, `helpOpen`) and the fetch effects. State is reflected to the URL query (`src/lib/url.ts`, `readQueryString`/`writeQueryString`) so views are shareable; the compare selection is intentionally reset on any source/build/platform change. Tabs (Treemap / Packages / Modules / Removed-by-finalize / Drift / Trends / Configure) map to components in `src/components/`. The **Configure** tab is enabled only when `index.kconfig_available_for` includes the platform.

`src/lib/` holds the pure logic, all unit-tested independently of React:
- `categorise.ts` — heuristic Buildroot-package → category (vendor/kernel/userspace/toolchain/overlay) for treemap colour; first-matching regex rule wins, default `userspace`.
- `kconfig.ts` — `closeDisable()` computes the Kconfig select-cascade disable closure (a symbol can't be disabled if a still-set symbol hard-`select`s it → reported as `blocked`); `defconfigFragment()` and `buildRequest()` turn a selection into a `# BR2_... is not set` fragment and a pre-filled `OpenIPC/builder` GitHub issue URL.
- `drift.ts` / `trends.ts` / `timeseries.ts` / `sizes.ts` / `index.ts` / `format.ts` — diffing, trend shaping, fetchers, formatting.

## Deployment

`.github/workflows/pages.yml`: `test` job (`npm ci && npm test`) is a hard gate; `build` job runs the prebuild with the workflow's `GH_TOKEN`, then re-runs `npm test` so the bundle invariant is checked against the real `dist/`; `deploy` publishes it. Triggers: push to `main`, nightly cron 04:30 UTC, manual dispatch. Requires Node 20+. Concurrency is `group: pages, cancel-in-progress: false` — runs **queue** rather than cancel, because the build produces the whole data set and a cancelled run discards its downloads for nothing.

`.github/workflows/ci.yml`: pull requests only. One `verify` job: `npm ci` → `npm run build:app` → `npm test`. It deliberately skips the prebuild — no `gh`, no token, no API calls, no downloads, ~2s of build — because the prebuild's logic is covered by the mocked unit tests and `tests/live.test.ts` (`RUN_LIVE_TESTS=1`). Concurrency is per-ref and the token is read-only, so a PR can neither cancel a deploy nor perform one.
