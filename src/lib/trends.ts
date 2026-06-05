import type { Source } from "./types";
import type { TrendsFile } from "./timeseries";

export function trendsUrl(source: Source, platform: string): string {
  return `./data/${source}/trends/trends.${platform}.json`;
}

const cache = new Map<string, Promise<TrendsFile>>();

export function fetchTrends(source: Source, platform: string): Promise<TrendsFile> {
  const url = trendsUrl(source, platform);
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      const r = await fetch(url, { cache: "force-cache" });
      if (!r.ok) throw new Error(`trends: HTTP ${r.status} from ${url}`);
      const t = (await r.json()) as TrendsFile;
      if (t.schema !== 1) {
        throw new Error(
          `trends: unsupported schema ${t.schema} (expected 1)`,
        );
      }
      return t;
    })().catch((e) => {
      cache.delete(url);
      throw e;
    });
    cache.set(url, p);
  }
  return p;
}

export function clearTrendsCache(): void {
  cache.clear();
}
