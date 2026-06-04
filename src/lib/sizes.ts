import type { Sizes, Source } from "./types";

// Relative URL → same-origin → no CORS.
export function sizesUrl(source: Source, buildId: string, platform: string): string {
  return `./data/${source}/${buildId}/sizes.${platform}.json`;
}

const cache = new Map<string, Promise<Sizes>>();

export function fetchPlatformSizes(
  source: Source,
  buildId: string,
  platform: string,
): Promise<Sizes> {
  const url = sizesUrl(source, buildId, platform);
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      const r = await fetch(url, { cache: "force-cache" });
      if (!r.ok) throw new Error(`sizes: HTTP ${r.status} from ${url}`);
      return (await r.json()) as Sizes;
    })().catch((e) => {
      cache.delete(url);
      throw e;
    });
    cache.set(url, p);
  }
  return p;
}

export function clearSizesCache(): void {
  cache.clear();
}
