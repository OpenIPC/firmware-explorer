import { describe, it, expect } from "vitest";
import {
  parseBody,
  platformFromAssetName,
  runPrebuild,
  type FsHooks,
  type GhFn,
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

function makeGh(fs: FsHooks, releases: FakeRelease[]): GhFn {
  return (args) => {
    // gh release list --repo <repo> --limit N --json tagName,createdAt,isPrerelease
    if (args[0] === "release" && args[1] === "list") {
      return JSON.stringify(
        releases.map((r) => ({
          tagName: r.tagName,
          createdAt: r.createdAt,
          isPrerelease: r.isPrerelease,
        })),
      );
    }

    // gh release view <tag> --repo <repo> --json tagName,createdAt,body,assets
    if (args[0] === "release" && args[1] === "view") {
      const tag = args[2];
      const rel = releases.find((r) => r.tagName === tag);
      if (!rel) throw new Error(`no fake release for tag ${tag}`);
      return JSON.stringify({
        tagName: rel.tagName,
        createdAt: rel.createdAt,
        body: rel.body,
        assets: rel.assets.map((a) => ({ name: a.name, size: a.size })),
      });
    }

    // gh release download <tag> --repo <repo> --pattern 'sizes.*.json' --dir <dir> --skip-existing
    if (args[0] === "release" && args[1] === "download") {
      const tag = args[2];
      const dirIdx = args.indexOf("--dir");
      const target = args[dirIdx + 1];
      const rel = releases.find((r) => r.tagName === tag);
      if (!rel) throw new Error(`no fake release for tag ${tag}`);
      for (const a of rel.assets) {
        if (a.name.startsWith("sizes.") && a.name.endsWith(".json")) {
          fs.write(
            target + "/" + a.name,
            a.content ?? JSON.stringify({ schema: 1, board: "x" }),
          );
        }
      }
      return "";
    }

    throw new Error(`unmocked gh call: ${args.join(" ")}`);
  };
}

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
    const gh = makeGh(fs, releases);

    const result = await runPrebuild({
      outDir: "/out",
      cacheDir: "/cache",
      gh,
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
    const gh = makeGh(fs, many);

    await runPrebuild({
      outDir: "/out",
      cacheDir: "/cache",
      gh,
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
    const gh = makeGh(fs, compound);

    const result = await runPrebuild({
      outDir: "/out",
      cacheDir: "/cache",
      gh,
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
