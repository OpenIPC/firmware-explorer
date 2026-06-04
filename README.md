# firmware-explorer

Per-build package + kernel-module composition explorer for OpenIPC firmware.

Live: **https://openipc.github.io/firmware-explorer/**

## What it does

Reads the `manifest.json` published at:

- https://openipc.github.io/firmware/manifest.json
- https://openipc.github.io/builder/manifest.json

…and, for every build × platform that ships a `sizes.<plat>.json` sidecar (from `OpenIPC/firmware` PR [#2166](https://github.com/OpenIPC/firmware/pull/2166) and `OpenIPC/builder` PR [#102](https://github.com/OpenIPC/builder/pull/102)), renders:

- **Size summary** — kernel/uImage and rootfs cap utilisation with a red/amber/green badge.
- **Treemap** — packages sized by uncompressed bytes, coloured by category (vendor SDK / kernel / userspace / toolchain / overlay).
- **Package table** — sortable by name / uncompressed / compressed-approx / file count; click a row to expand `top_files[]`.
- **Module table** — every `.ko` with its owning package and an "autoloaded by `/etc/modules`" flag; filter to "on-demand only" to surface compaction candidates.
- **Removed-by-finalize panel** — files the build dropped via OpenIPC-specific finalize hooks (`HISILICON_OPENSDK_TRIM_SP2308`, the libstdc++ strip from `rootfs_script.sh`, per-board excludes lists).
- **What-if scratchpad** — tick boxes to mark packages / modules as "would disable", see a running total of the rootfs savings. **Naive sum, no dependency resolution yet** (see [v0.2 below](#roadmap)).
- **Drift view** — diff any two builds for the same platform, sorted by absolute byte delta. Catches the kind of week-on-week growth that PR [firmware#2163](https://github.com/OpenIPC/firmware/pull/2163) had to wait for a rootfs overflow to detect.

Source toggle lets you switch between the firmware repo's nightlies and the builder repo's (per-device) nightlies. Selection state is encoded in the URL query so views are shareable.

## Local dev

```bash
npm install
npm run dev    # http://localhost:5173/
npm run build  # → dist/
npm run preview
```

Requires Node 20+. The dev server fetches manifests directly from `openipc.github.io` (CORS: allow-`*`), so no local data is needed.

## Deployment

`.github/workflows/pages.yml` builds on every push to `main` and deploys `dist/` to GitHub Pages. The Vite `base` is set to `/firmware-explorer/` so asset paths resolve correctly under the gh-pages subpath.

## Schema

This explorer expects `schema: 1` on both `manifest.json` and `sizes.<plat>.json`. The authoritative emitter is [`OpenIPC/firmware`'s `general/scripts/size_report.py`](https://github.com/OpenIPC/firmware/blob/master/general/scripts/size_report.py); the explorer's [`src/lib/types.ts`](src/lib/types.ts) mirrors that schema. Any schema bump on the emitter side will require a matching change here.

## Roadmap

This is **v0.1** — the viewer and the what-if scratchpad.

- **v0.2** — real Kconfig dependency resolution. Two PRs:
  - `OpenIPC/firmware`: new `general/scripts/kconfig_graph.py` that walks `general/openipc.fragment` + every `package/*/Config.in` and emits `kconfig-graph.<plat>.json` next to `sizes.<plat>.json`.
  - This repo: consume it, gate impossible toggles, generate downloadable defconfig fragments ("paste these lines into your board defconfig").
- **v0.3 (optional)** — submit a config to the builder pipeline and trigger a build. Needs hosted infrastructure.

## Issue trail

Originally requested in [OpenIPC/firmware#242](https://github.com/OpenIPC/firmware/issues/242) (in Russian: "package tree for a firmware web configurator"). The data side shipped in [`OpenIPC/firmware#2166`](https://github.com/OpenIPC/firmware/pull/2166) + [`OpenIPC/builder#102`](https://github.com/OpenIPC/builder/pull/102); this repo is the consumer.

## License

MIT — see [LICENSE](LICENSE).
