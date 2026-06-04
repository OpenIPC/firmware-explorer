import type { Sizes } from "./types";

const cache = new Map<string, Promise<Sizes>>();

export function fetchSizes(url: string): Promise<Sizes> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      const r = await fetch(url, { cache: "force-cache" });
      if (!r.ok) throw new Error(`sizes: HTTP ${r.status} from ${url}`);
      const s = (await r.json()) as Sizes;
      if (s.schema !== 1) {
        throw new Error(
          `sizes: unsupported schema ${s.schema} (this explorer understands schema 1)`,
        );
      }
      return s;
    })().catch((e) => {
      cache.delete(url);
      throw e;
    });
    cache.set(url, p);
  }
  return p;
}
