import { describe, it, expect } from "vitest";
import {
  fetchReleases,
  parseBody,
  platformFromAssetName,
  runPrebuild,
  type FsHooks,
  type GhFn,
  type HttpFn,
} from "../scripts/prebuild.mts";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("parseBody", () => {
  it("extracts sha / short / built_at", () => {
    const body = [
      "sha=679c2c7abcdef0123456",
      "short=679c2c7",
      "built_at=2026-06-04T00:11:18Z",
    ].join("\n");
    expect(parseBody(body)).toEqual({
      sha: "679c2c7abcdef0123456",
      short: "679c2c7",
      built_at: "2026-06-04T00:11:18Z",
    });
  });

  it("tolerates blank / partial bodies", () => {
    expect(parseBody("")).toEqual({ sha: "", short: "", built_at: "" });
    expect(parseBody("foo=bar\nsha=abc\n")).toEqual({
      sha: "abc",
      short: "",
      built_at: "",
    });
  });
});

describe("platformFromAssetName", () => {
  it("parses simple (firmware-style) names", () => {
    expect(platformFromAssetName("sizes.hi3518ev300-lite.json")).toBe(
      "hi3518ev300-lite",
    );
    expect(platformFromAssetName("sizes.ssc338q-fpv.json")).toBe(
      "ssc338q-fpv",
    );
  });

  it("parses compound (builder-style) names", () => {
    expect(
      platformFromAssetName("sizes.gk7205v210_lite_tiandy-tc-c32qn.json"),
    ).toBe("gk7205v210_lite_tiandy-tc-c32qn");
    expect(
      platformFromAssetName("sizes.gk7202v300_lite_cootli_camv0103.json"),
    ).toBe("gk7202v300_lite_cootli_camv0103");
  });

  it("rejects non-sizes assets", () => {
    expect(platformFromAssetName("openipc.hi3518ev300-nor-lite.tgz")).toBeNull();
    expect(platformFromAssetName("sizes.json")).toBeNull();
    expect(platformFromAssetName("foo.bar.json")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// In-memory FS + canned gh CLI driver
// ---------------------------------------------------------------------------

type MemFsState = {
  files: Map<string, string>;
  dirs: Set<string>;
};

function memFs(): { fs: FsHooks; state: MemFsState } {
  const state: MemFsState = { files: new Map(), dirs: new Set() };
  const ensureDirChain = (dir: string) => {
    let acc = "";
    for (const seg of dir.split("/").filter(Boolean)) {
      acc += "/" + seg;
      state.dirs.add(acc);
    }
  };

  const fs: FsHooks = {
    mkdir: (p) => ensureDirChain(p),
    write: (p, c) => {
      const dir = p.split("/").slice(0, -1).join("/") || "/";
      ensureDirChain(dir);
      state.files.set(p, typeof c === "string" ? c : new TextDecoder().decode(c));
    },
    read: (p) => {
      const content = state.files.get(p);
      if (content === undefined) throw new Error(`memFs: no such file ${p}`);
      return content;
    },
    exists: (p) => state.dirs.has(p) || state.files.has(p),
    copyDir: (from, to) => {
      ensureDirChain(to);
      for (const [path, content] of state.files) {
        if (path.startsWith(from + "/")) {
          const rel = path.slice(from.length + 1);
          fs.write(to + "/" + rel, content);
        }
      }
    },
    rmDir: (p) => {
      state.dirs.delete(p);
      for (const key of [...state.files.keys()]) {
        if (key.startsWith(p + "/") || key === p) state.files.delete(key);
      }
    },
    listDir: (p) => {
      const out = new Set<string>();
      for (const path of state.files.keys()) {
        if (path.startsWith(p + "/")) {
          const rest = path.slice(p.length + 1);
          out.add(rest.split("/")[0]);
        }
      }
      return [...out].sort();
    },
  };

  return { fs, state };
}

type FakeAsset = { name: string; size: number; content?: string };
type FakeRelease = {
  tagName: string;
  createdAt: string;
  isPrerelease: boolean;
  body: string;
  assets: FakeAsset[];
};

function assetUrl(repo: string, tag: string, name: string): string {
  return `https://github.com/${repo}/releases/download/${tag}/${name}`;
}

function makeGh(releases: FakeRelease[]): GhFn {
  return (args) => {
    // Only endpoint the new prebuild hits: paginated /releases enumeration.
    // Matches `gh api ... /repos/<repo>/releases?per_page=100&page=N`.
    if (args[0] === "api") {
      const path = args.find((a) => a.startsWith("/repos/"));
      if (!path) throw new Error(`unmocked gh api path: ${args.join(" ")}`);
      const repoMatch = /^\/repos\/([^/]+\/[^/]+)\/releases/.exec(path);
      if (!repoMatch) throw new Error(`unexpected gh api path: ${path}`);
      const repo = repoMatch[1];
      const pageMatch = /[?&]page=(\d+)/.exec(path);
      const page = pageMatch ? parseInt(pageMatch[1], 10) : 1;
      // 100 per page; fakes fit in one page.
      if (page > 1) return "[]";
      return JSON.stringify(
        releases.map((r) => ({
          tag_name: r.tagName,
          created_at: r.createdAt,
          prerelease: r.isPrerelease,
          body: r.body,
          assets: r.assets.map((a) => ({
            name: a.name,
            size: a.size,
            browser_download_url: assetUrl(repo, r.tagName, a.name),
          })),
        })),
      );
    }
    throw new Error(`unmocked gh call: ${args.join(" ")}`);
  };
}

function makeHttp(fs: FsHooks, releases: FakeRelease[]): HttpFn {
  return (url, target) => {
    // URLs look like https://github.com/<repo>/releases/download/<tag>/<name>.
    const m = /\/releases\/download\/([^/]+)\/(.+)$/.exec(url);
    if (!m) throw new Error(`unexpected download URL: ${url}`);
    const [, tag, name] = m;
    const rel = releases.find((r) => r.tagName === tag);
    if (!rel) throw new Error(`no fake release for tag ${tag}`);
    const asset = rel.assets.find((a) => a.name === name);
    if (!asset) throw new Error(`no fake asset ${name} on ${tag}`);
    fs.write(
      target,
      asset.content ?? JSON.stringify({ schema: 1, board: "x" }),
    );
  };
}

// ---------------------------------------------------------------------------
// fetchReleases — one paginated call per source, no per-tag API calls
// ---------------------------------------------------------------------------

describe("fetchReleases", () => {
  it("caps at one API call per 100 releases and returns full detail", () => {
    const rows = Array.from({ length: 42 }, (_, i) => ({
      tagName: `nightly-2026060${(i % 9) + 1}-abcdef${i.toString(16).padStart(1, "0")}`,
      createdAt: `2026-07-0${(i % 9) + 1}T00:00:00Z`,
      isPrerelease: true,
      body: `sha=fake${i}\n`,
      assets: [{ name: `sizes.p${i}-lite.json`, size: 1000 + i }],
    }));
    let calls = 0;
    const gh: GhFn = (args) => {
      calls++;
      // Assert we're using /releases and not the old subcommands.
      expect(args[0]).toBe("api");
      const path = args.find((a) => a.startsWith("/repos/"))!;
      expect(path).toContain("/releases");
      expect(path).toContain("per_page=100");
      return JSON.stringify(
        rows.map((r) => ({
          tag_name: r.tagName,
          created_at: r.createdAt,
          prerelease: r.isPrerelease,
          body: r.body,
          assets: r.assets.map((a) => ({
            name: a.name,
            size: a.size,
            browser_download_url: `https://github.com/OpenIPC/firmware/releases/download/${r.tagName}/${a.name}`,
          })),
        })),
      );
    };
    const { list, detail } = fetchReleases(gh, "OpenIPC/firmware");
    // 42 releases fit in one page — stops early on partial page.
    expect(calls).toBe(1);
    expect(list).toHaveLength(42);
    expect(detail.size).toBe(42);
    const first = detail.get(rows[0].tagName)!;
    expect(first.body).toBe(rows[0].body);
    expect(first.assets[0].downloadUrl).toContain("browser_download_url".slice(0, 0)); // downloadUrl populated
    expect(first.assets[0].downloadUrl).toContain(
      `/releases/download/${rows[0].tagName}/${rows[0].assets[0].name}`,
    );
  });

  it("paginates when the API returns a full page", () => {
    // 100 rows on page 1 → advance to page 2. Page 2 returns 5 → stop.
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      tag_name: `t${i}`,
      created_at: "2026-06-01T00:00:00Z",
      prerelease: true,
      body: "",
      assets: [],
    }));
    const page2 = Array.from({ length: 5 }, (_, i) => ({
      tag_name: `late-t${i}`,
      created_at: "2026-05-30T00:00:00Z",
      prerelease: true,
      body: "",
      assets: [],
    }));
    const gh: GhFn = (args) => {
      const path = args.find((a) => a.startsWith("/repos/"))!;
      const page = /[?&]page=(\d+)/.exec(path)?.[1] ?? "1";
      if (page === "1") return JSON.stringify(page1);
      if (page === "2") return JSON.stringify(page2);
      return "[]";
    };
    const { list } = fetchReleases(gh, "OpenIPC/firmware");
    expect(list).toHaveLength(105);
  });
});

// ---------------------------------------------------------------------------
// runPrebuild integration test
// ---------------------------------------------------------------------------

describe("runPrebuild", () => {
  const releases: FakeRelease[] = [
    {
      tagName: "nightly-20260604-679c2c7",
      createdAt: "2026-06-04T00:11:18Z",
      isPrerelease: true,
      body: "sha=679c2c7abcdef0\nshort=679c2c7\nbuilt_at=2026-06-04T00:11:18Z\n",
      assets: [
        { name: "sizes.hi3518ev300-lite.json", size: 30000 },
        { name: "sizes.ssc335-ultimate.json", size: 25000 },
        { name: "openipc.hi3518ev300-nor-lite.tgz", size: 7000000 },
      ],
    },
    {
      tagName: "nightly-20260603-aaaaaaa",
      createdAt: "2026-06-03T00:11:18Z",
      isPrerelease: true,
      body: "sha=aaaaaaabbb\nshort=aaaaaaa\nbuilt_at=2026-06-03T00:11:18Z\n",
      assets: [{ name: "sizes.hi3518ev300-lite.json", size: 29000 }],
    },
    {
      tagName: "junk-not-nightly",
      createdAt: "2026-06-04T01:00:00Z",
      isPrerelease: false,
      body: "",
      assets: [],
    },
  ];

  it("walks one source, filters non-nightly tags, emits index + shards", async () => {
    const { fs, state } = memFs();
    const gh = makeGh(releases);
    const http = makeHttp(fs, releases);

    const result = await runPrebuild({
      outDir: "/out",
      cacheDir: "/cache",
      gh,
      http,
      fs,
      sources: ["firmware"],
      retention: 90,
      log: () => {},
    });

    // Builds emitted in newest-first order, junk tag filtered.
    expect(result.builds.firmware.map((b) => b.id)).toEqual([
      "nightly-20260604-679c2c7",
      "nightly-20260603-aaaaaaa",
    ]);

    // Per-build platform lists.
    expect(result.builds.firmware[0].platforms).toEqual([
      "hi3518ev300-lite",
      "ssc335-ultimate",
    ]);
    expect(result.builds.firmware[1].platforms).toEqual([
      "hi3518ev300-lite",
    ]);

    // Sha/short/built_at parsed from release body.
    expect(result.builds.firmware[0].sha).toBe("679c2c7abcdef0");
    expect(result.builds.firmware[0].short).toBe("679c2c7");
    expect(result.builds.firmware[0].built_at).toBe("2026-06-04T00:11:18Z");

    // Per-platform shard files materialised under outDir.
    expect(
      state.files.has(
        "/out/firmware/nightly-20260604-679c2c7/sizes.hi3518ev300-lite.json",
      ),
    ).toBe(true);
    expect(
      state.files.has(
        "/out/firmware/nightly-20260604-679c2c7/sizes.ssc335-ultimate.json",
      ),
    ).toBe(true);
    expect(
      state.files.has(
        "/out/firmware/nightly-20260603-aaaaaaa/sizes.hi3518ev300-lite.json",
      ),
    ).toBe(true);

    // index.json present with expected shape.
    const raw = state.files.get("/out/firmware/index.json")!;
    expect(raw).toBeDefined();
    const idx = JSON.parse(raw);
    expect(idx.schema).toBe(1);
    expect(idx.source).toBe("firmware");
    expect(idx.retention).toBe(90);
    expect(idx.builds).toHaveLength(2);
  });

  it("honours retention by trimming older nightlies", async () => {
    const many: FakeRelease[] = Array.from({ length: 5 }, (_, i) => ({
      tagName: `nightly-2026060${5 - i}-aaaaaaa`,
      createdAt: `2026-06-0${5 - i}T00:00:00Z`,
      isPrerelease: true,
      body: "",
      assets: [{ name: "sizes.foo-lite.json", size: 100 }],
    }));
    const { fs, state } = memFs();
    const gh = makeGh(many);
    const http = makeHttp(fs, many);

    await runPrebuild({
      outDir: "/out",
      cacheDir: "/cache",
      gh,
      http,
      fs,
      sources: ["firmware"],
      retention: 2,
      log: () => {},
    });

    const idx = JSON.parse(state.files.get("/out/firmware/index.json")!);
    expect(idx.builds).toHaveLength(2);
    expect(idx.builds.map((b: { id: string }) => b.id)).toEqual([
      "nightly-20260605-aaaaaaa",
      "nightly-20260604-aaaaaaa",
    ]);
  });

  // -------------------------------------------------------------------------
  // Completeness gating (partial / in-flight upstream releases)
  // -------------------------------------------------------------------------

  it("skips an in-flight build that lacks the completion marker but is newer than a marked build", async () => {
    const withMarker: FakeRelease[] = [
      {
        // Newest: publish still in flight — no `_manifest.json` yet.
        tagName: "nightly-20260605-bbbbbbb",
        createdAt: "2026-06-05T00:00:00Z",
        isPrerelease: true,
        body: "sha=b\nshort=bbbbbbb\nbuilt_at=2026-06-05T00:00:00Z\n",
        assets: [{ name: "sizes.foo-lite.json", size: 100 }],
      },
      {
        // Older: fully published — carries the completion marker.
        tagName: "nightly-20260604-aaaaaaa",
        createdAt: "2026-06-04T00:00:00Z",
        isPrerelease: true,
        body: "sha=a\nshort=aaaaaaa\nbuilt_at=2026-06-04T00:00:00Z\n",
        assets: [
          { name: "sizes.foo-lite.json", size: 100 },
          { name: "_manifest.json", size: 50 },
        ],
      },
    ];
    const { fs } = memFs();
    const gh = makeGh(withMarker);
    const http = makeHttp(fs, withMarker);

    const result = await runPrebuild({
      outDir: "/out",
      cacheDir: "/cache",
      gh,
      http,
      fs,
      sources: ["firmware"],
      retention: 90,
      log: () => {},
    });

    // Only the marked (complete) build is ingested; the in-flight one is held.
    expect(result.builds.firmware.map((b) => b.id)).toEqual([
      "nightly-20260604-aaaaaaa",
    ]);
  });

  it("trusts marker-less legacy builds older than the newest marked build", async () => {
    const mixed: FakeRelease[] = [
      {
        tagName: "nightly-20260605-eeeeeee",
        createdAt: "2026-06-05T00:00:00Z",
        isPrerelease: true,
        body: "sha=e\nshort=eeeeeee\nbuilt_at=2026-06-05T00:00:00Z\n",
        assets: [
          { name: "sizes.foo-lite.json", size: 100 },
          { name: "_manifest.json", size: 50 },
        ],
      },
      {
        // Pre-marker history: no `_manifest.json`, but older than the marked
        // build, so it is trusted rather than treated as in-flight.
        tagName: "nightly-20260604-fffffff",
        createdAt: "2026-06-04T00:00:00Z",
        isPrerelease: true,
        body: "sha=f\nshort=fffffff\nbuilt_at=2026-06-04T00:00:00Z\n",
        assets: [{ name: "sizes.foo-lite.json", size: 100 }],
      },
    ];
    const { fs } = memFs();
    const gh = makeGh(mixed);
    const http = makeHttp(fs, mixed);

    const result = await runPrebuild({
      outDir: "/out",
      cacheDir: "/cache",
      gh,
      http,
      fs,
      sources: ["firmware"],
      retention: 90,
      log: () => {},
    });

    expect(result.builds.firmware.map((b) => b.id)).toEqual([
      "nightly-20260605-eeeeeee",
      "nightly-20260604-fffffff",
    ]);
  });

  it("re-fetches a partial cache once the release advertises more shards", async () => {
    const complete: FakeRelease[] = [
      {
        tagName: "nightly-20260604-ddddddd",
        createdAt: "2026-06-04T00:00:00Z",
        isPrerelease: true,
        body: "sha=d\nshort=ddddddd\nbuilt_at=2026-06-04T00:00:00Z\n",
        assets: [
          { name: "sizes.a-lite.json", size: 100 },
          { name: "sizes.b-lite.json", size: 100 },
          { name: "_manifest.json", size: 50 },
        ],
      },
    ];
    const { fs, state } = memFs();
    const gh = makeGh(complete);
    const http = makeHttp(fs, complete);

    // Seed a stale, partial cache from an earlier rate-limited run: only 1 of
    // the 2 shards the release now advertises.
    fs.write(
      "/cache/firmware/nightly-20260604-ddddddd/sizes.a-lite.json",
      JSON.stringify({ schema: 1, board: "stale" }),
    );

    const result = await runPrebuild({
      outDir: "/out",
      cacheDir: "/cache",
      gh,
      http,
      fs,
      sources: ["firmware"],
      retention: 90,
      log: () => {},
    });

    // Both shards present after the forced re-fetch (partial cache not served).
    expect(result.builds.firmware[0].platforms).toEqual(["a-lite", "b-lite"]);
    expect(
      state.files.has(
        "/out/firmware/nightly-20260604-ddddddd/sizes.b-lite.json",
      ),
    ).toBe(true);
  });

  it("preserves compound platform names through the round-trip", async () => {
    const compound: FakeRelease[] = [
      {
        tagName: "nightly-20260604-ccccccc",
        createdAt: "2026-06-04T00:00:00Z",
        isPrerelease: true,
        body: "sha=c\nshort=ccccccc\nbuilt_at=2026-06-04T00:00:00Z\n",
        assets: [
          { name: "sizes.gk7202v300_lite_cootli_camv0103.json", size: 41000 },
          { name: "sizes.gk7205v210_lite_tiandy-tc-c32qn.json", size: 42000 },
          { name: "sizes.ssc338q-fpv.json", size: 35000 },
        ],
      },
    ];
    const { fs, state } = memFs();
    const gh = makeGh(compound);
    const http = makeHttp(fs, compound);

    const result = await runPrebuild({
      outDir: "/out",
      cacheDir: "/cache",
      gh,
      http,
      fs,
      sources: ["builder"],
      retention: 1,
      log: () => {},
    });

    expect(result.builds.builder[0].platforms).toEqual([
      "gk7202v300_lite_cootli_camv0103",
      "gk7205v210_lite_tiandy-tc-c32qn",
      "ssc338q-fpv",
    ]);
    expect(
      state.files.has(
        "/out/builder/nightly-20260604-ccccccc/sizes.gk7205v210_lite_tiandy-tc-c32qn.json",
      ),
    ).toBe(true);
  });
});
