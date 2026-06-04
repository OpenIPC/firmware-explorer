# firmware-explorer

Per-build package + kernel-module composition viewer for OpenIPC firmware.

Live: **https://openipc.github.io/firmware-explorer/**

## What it does

For each nightly build × platform that ships a `sizes.<plat>.json` sidecar (from `OpenIPC/firmware` and `OpenIPC/builder` release assets), it renders:

- **Size summary** — kernel/uImage and rootfs cap utilisation with a red/amber/green badge.
- **Treemap** — packages sized by uncompressed bytes, coloured by category (vendor SDK / kernel / userspace / toolchain / overlay).
- **Package table** — sortable by name / uncompressed / compressed-approx / file count; click a row to expand `top_files[]`.
- **Module table** — every `.ko` with its owning package and an "autoloaded by `/etc/modules`" flag; filter to "on-demand only" to surface compaction candidates.
- **Removed-by-finalize panel** — files the build dropped via OpenIPC-specific finalize hooks (`HISILICON_OPENSDK_TRIM_SP2308`, the libstdc++ strip from `rootfs_script.sh`, per-board excludes lists).
- **Drift view** — diff any two builds for the same platform, sorted by absolute byte delta.

Source toggle switches between OpenIPC/firmware nightlies and OpenIPC/builder per-device nightlies. Selection state is encoded in the URL query so views are shareable.

## Architecture

The explorer is a **build-time aggregator**, not a runtime fetcher. The browser never crosses an origin boundary at runtime.

```
GitHub release assets ──(server-side, no CORS)──> explorer CI prebuild
                                                       │
                                                       ▼
                          public/data/<source>/<build>/sizes.<plat>.json
                          public/data/<source>/index.json
                                                       │
                                            (Vite copies public/ to dist/)
                                                       │
                                                       ▼
                               gh-pages static site at openipc.github.io/firmware-explorer/
                                                       │
                                       (browser fetches same-origin only)
                                                       ▼
                                             user views build × platform
```

`scripts/prebuild.mts` is the workhorse: it walks each repo's nightly releases via the `gh` CLI, downloads every `sizes.*.json` asset server-side (CORS is structurally not a question there), and writes per-platform JSON shards plus a small `index.json` catalogue under `public/data/`. Vite copies the entire `public/` into `dist/`, the deploy workflow pushes that to GitHub Pages, and the runtime only ever fetches relative URLs.

### Why this matters

Earlier versions of this tool used `manifest.json[builds[].platforms.<plat>.sizes.url]` URLs at runtime, which pointed at GitHub release assets. Release assets do not set `Access-Control-Allow-Origin`, so every browser fetch was blocked by CORS — the tool only appeared to work in `curl`. The build-time aggregator design removes the cross-origin fetch entirely. `tests/bundle.test.ts` enforces this by grepping the production JS for the killer URL patterns.

## Launch byte budget

| Resource | Gzipped |
|---|---|
| `index.html` + JS bundle + CSS | ~57 KB |
| `data/<default source>/index.json` | ~3 KB |
| **Empty-state landing total** | **~60 KB** |
| One platform's JSON (after pick) | ~5 KB |
| Drift comparison (one more shard) | ~5 KB |

## Local dev

Requires Node 20+ and `gh` CLI authenticated (`gh auth login`) for the prebuild step.

```bash
npm install
npm run dev          # http://localhost:5173/firmware-explorer/
npm run build        # prebuild → tsc → vite build → dist/
npm test             # vitest suite (38 tests; 3 live tests skipped)
RUN_LIVE_TESTS=1 npm test
```

Prebuild knobs:

| Env var | Default | Purpose |
|---|---|---|
| `RETENTION` | 90 | Number of nightlies to retain |
| `LIMIT` | (none) | Cap on tags processed (debug; e.g. `LIMIT=3` for a fast iteration) |
| `SOURCES` | `firmware,builder` | Comma-separated subset |
| `FORCE_REFETCH` | (off) | Skip the on-disk download cache and re-download every tag |
| `QUIET` | (off) | Suppress per-tag progress output |

`gh release download` is cached under `/tmp/firmware-explorer-prebuild/` so repeated builds are fast.

## Deployment

`.github/workflows/pages.yml` runs:

1. `test` job — `npm ci && npm test`. Hard gate; deploys are blocked on red tests.
2. `build` job — `npm ci && npm run build` (prebuild downloads release assets via the workflow's `GH_TOKEN`).
3. `deploy` job — `actions/deploy-pages@v4` publishes `dist/` to gh-pages.

Triggers: push to `main`, nightly cron at 04:30 UTC (after firmware ~00:11 and builder ~07:20 nightlies finish), and manual `workflow_dispatch`.

## Schema

The explorer expects `schema: 1` on both `data/<source>/index.json` (defined in this repo's [`src/lib/types.ts`](src/lib/types.ts)) and the per-platform `sizes.<plat>.json` (defined upstream in [`OpenIPC/firmware`'s `general/scripts/size_report.py`](https://github.com/OpenIPC/firmware/blob/master/general/scripts/size_report.py)). A schema bump on the upstream emitter needs a matching change here.

## Roadmap

- **v0.2 — Kconfig-aware configurator** — `OpenIPC/firmware: general/scripts/kconfig_graph.py` emits a `kconfig-graph.<plat>.json` next to `sizes.<plat>.json`. This repo's prebuild aggregates it the same way as sizes; the explorer gains dep-aware toggles and a downloadable `# BR2_PACKAGE_FOO is not set` defconfig fragment. Deferred — needs the firmware-side emitter to land first.
- **v0.3 (optional) — submit-to-builder trigger** — needs hosted infrastructure; only worth doing once v0.2 proves the workflow useful.

## Issue trail

Originally requested in [OpenIPC/firmware#242](https://github.com/OpenIPC/firmware/issues/242). Size-report data is emitted by [`OpenIPC/firmware#2166`](https://github.com/OpenIPC/firmware/pull/2166) + [`OpenIPC/builder#102`](https://github.com/OpenIPC/builder/pull/102). This repo is the build-time consumer.

## License

MIT — see [LICENSE](LICENSE).
