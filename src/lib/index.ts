import type { IndexFile, Source } from "./types";

// Relative to the deployed site (`./` = wherever index.html lives). Same-origin
// by construction — there is no CORS gate to fail.
export function indexUrl(source: Source): string {
  return `./data/${source}/index.json`;
}

const cache = new Map<Source, Promise<IndexFile>>();

export function fetchIndex(source: Source): Promise<IndexFile> {
  let p = cache.get(source);
  if (!p) {
    p = (async () => {
      const r = await fetch(indexUrl(source), { cache: "no-cache" });
      if (!r.ok) throw new Error(`index ${source}: HTTP ${r.status}`);
      const m = (await r.json()) as IndexFile;
      if (m.schema !== 1) {
        throw new Error(
          `index ${source}: unsupported schema ${m.schema} (expected 1)`,
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

export function clearIndexCache(): void {
  cache.clear();
}
