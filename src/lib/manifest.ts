import type { Manifest, ManifestSource } from "./types";

const MANIFEST_URLS: Record<ManifestSource, string> = {
  firmware: "https://openipc.github.io/firmware/manifest.json",
  builder: "https://openipc.github.io/builder/manifest.json",
};

const cache = new Map<ManifestSource, Promise<Manifest>>();

export function manifestUrl(source: ManifestSource): string {
  return MANIFEST_URLS[source];
}

export function fetchManifest(source: ManifestSource): Promise<Manifest> {
  let p = cache.get(source);
  if (!p) {
    p = (async () => {
      const r = await fetch(MANIFEST_URLS[source], { cache: "no-cache" });
      if (!r.ok) throw new Error(`manifest ${source}: HTTP ${r.status}`);
      const m = (await r.json()) as Manifest;
      if (m.schema !== 1) {
        throw new Error(
          `manifest ${source}: unsupported schema ${m.schema} (this explorer understands schema 1)`,
        );
      }
      return m;
    })().catch((e) => {
      cache.delete(source);
      throw e;
    });
    cache.set(source, p);
  }
  return p;
}
