import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Build,
  Manifest,
  ManifestSource,
  Sizes,
} from "./lib/types";
import { fetchManifest, manifestUrl } from "./lib/manifest";
import { fetchSizes } from "./lib/sizes";
import { BuildPicker } from "./components/BuildPicker";
import { PlatformPicker } from "./components/PlatformPicker";
import { SizeSummary } from "./components/SizeSummary";
import { PackageTable } from "./components/PackageTable";
import { ModuleTable } from "./components/ModuleTable";
import { PackageTreemap } from "./components/PackageTreemap";
import { RemovedPanel } from "./components/RemovedPanel";
import { WhatIfPanel } from "./components/WhatIfPanel";
import { DriftView } from "./components/DriftView";

type Tab = "tree" | "packages" | "modules" | "removed" | "drift";

type WhatIf = { packages: Set<string>; modules: Set<string> };

// URL query schema:
//   ?source=firmware|builder
//   &build=<build-id>
//   &plat=<platform-key>
//   &off=pkg:foo,pkg:bar,mod:baz
function readQuery(): {
  source: ManifestSource;
  buildId: string | null;
  platform: string | null;
  whatIf: WhatIf;
} {
  const p = new URLSearchParams(window.location.search);
  const source = (p.get("source") === "builder" ? "builder" : "firmware") as ManifestSource;
  const buildId = p.get("build");
  const platform = p.get("plat");
  const off = p.get("off") ?? "";
  const whatIf: WhatIf = { packages: new Set(), modules: new Set() };
  for (const tok of off.split(",").filter(Boolean)) {
    if (tok.startsWith("pkg:")) whatIf.packages.add(tok.slice(4));
    else if (tok.startsWith("mod:")) whatIf.modules.add(tok.slice(4));
  }
  return { source, buildId, platform, whatIf };
}

function writeQuery(
  source: ManifestSource,
  buildId: string | null,
  platform: string | null,
  whatIf: WhatIf,
): void {
  const p = new URLSearchParams();
  p.set("source", source);
  if (buildId) p.set("build", buildId);
  if (platform) p.set("plat", platform);
  const off = [
    ...[...whatIf.packages].map((n) => `pkg:${n}`),
    ...[...whatIf.modules].map((n) => `mod:${n}`),
  ].join(",");
  if (off) p.set("off", off);
  const next = `${window.location.pathname}?${p.toString()}`;
  window.history.replaceState({}, "", next);
}

export function App() {
  const initial = useMemo(readQuery, []);
  const [source, setSource] = useState<ManifestSource>(initial.source);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [buildId, setBuildId] = useState<string | null>(initial.buildId);
  const [platform, setPlatform] = useState<string | null>(initial.platform);
  const [sizes, setSizes] = useState<Sizes | null>(null);
  const [sizesError, setSizesError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("tree");
  const [whatIf, setWhatIf] = useState<WhatIf>(initial.whatIf);

  // Fetch manifest on source change.
  useEffect(() => {
    setManifest(null);
    setManifestError(null);
    fetchManifest(source)
      .then((m) => setManifest(m))
      .catch((e: Error) => setManifestError(e.message));
  }, [source]);

  // Default build = newest in manifest if none chosen yet.
  useEffect(() => {
    if (manifest && !buildId && manifest.builds.length > 0) {
      const newest =
        manifest.channels.nightly ??
        manifest.channels.latest ??
        manifest.builds[0].id;
      setBuildId(newest);
    }
  }, [manifest, buildId]);

  // Default platform when build changes if none chosen (or new one is missing).
  useEffect(() => {
    if (!manifest || !buildId) return;
    const build = manifest.builds.find((b) => b.id === buildId);
    if (!build) return;
    if (platform && build.platforms[platform]?.sizes) return;
    const firstWithSizes = Object.entries(build.platforms)
      .filter(([, a]) => a.sizes)
      .map(([k]) => k)
      .sort()[0];
    setPlatform(firstWithSizes ?? null);
  }, [manifest, buildId, platform]);

  // Fetch sizes when (build, platform) is fully resolved.
  useEffect(() => {
    setSizes(null);
    setSizesError(null);
    if (!manifest || !buildId || !platform) return;
    const build = manifest.builds.find((b) => b.id === buildId);
    const url = build?.platforms[platform]?.sizes?.url;
    if (!url) return;
    fetchSizes(url)
      .then((s) => setSizes(s))
      .catch((e: Error) => setSizesError(e.message));
  }, [manifest, buildId, platform]);

  // Persist state to URL.
  useEffect(() => {
    writeQuery(source, buildId, platform, whatIf);
  }, [source, buildId, platform, whatIf]);

  const togglePackage = useCallback((name: string) => {
    setWhatIf((prev) => {
      const next = new Set(prev.packages);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return { ...prev, packages: next };
    });
  }, []);

  const toggleModule = useCallback((name: string) => {
    setWhatIf((prev) => {
      const next = new Set(prev.modules);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return { ...prev, modules: next };
    });
  }, []);

  const clearWhatIf = useCallback(() => {
    setWhatIf({ packages: new Set(), modules: new Set() });
  }, []);

  const build: Build | null = manifest && buildId
    ? manifest.builds.find((b) => b.id === buildId) ?? null
    : null;

  return (
    <div className="app">
      <header>
        <h1>
          OpenIPC firmware explorer{" "}
          <span className="version-tag">v0.1</span>
        </h1>
        <div className="source-toggle" role="tablist" aria-label="Manifest source">
          {(["firmware", "builder"] as ManifestSource[]).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={source === s}
              className={source === s ? "active" : ""}
              onClick={() => {
                setSource(s);
                setBuildId(null);
                setPlatform(null);
                setSizes(null);
                setWhatIf({ packages: new Set(), modules: new Set() });
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </header>

      <section className="pickers">
        {manifestError ? (
          <p className="error">
            manifest fetch failed for <code>{manifestUrl(source)}</code>:{" "}
            {manifestError}
          </p>
        ) : !manifest ? (
          <p className="muted">loading manifest…</p>
        ) : (
          <>
            <BuildPicker
              manifest={manifest}
              value={buildId}
              onChange={setBuildId}
            />
            {build && (
              <PlatformPicker
                build={build}
                value={platform}
                onChange={setPlatform}
              />
            )}
          </>
        )}
      </section>

      {sizesError && (
        <p className="error">sizes fetch failed: {sizesError}</p>
      )}

      {sizes && (
        <>
          <SizeSummary sizes={sizes} />

          <nav className="tabs" role="tablist">
            {(
              [
                ["tree", "Treemap"],
                ["packages", `Packages (${sizes.packages.length})`],
                ["modules", `Modules (${sizes.linux_components.modules.length})`],
                ["removed", `Removed-by-finalize (${sizes.removed_by_finalize.length})`],
                ["drift", "Drift vs another build"],
              ] as Array<[Tab, string]>
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                className={tab === k ? "active" : ""}
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </nav>

          <main>
            {tab === "tree" && (
              <PackageTreemap
                packages={sizes.packages}
                selected={whatIf.packages}
                onToggle={togglePackage}
              />
            )}
            {tab === "packages" && (
              <PackageTable
                packages={sizes.packages}
                selected={whatIf.packages}
                onToggle={togglePackage}
              />
            )}
            {tab === "modules" && (
              <ModuleTable
                modules={sizes.linux_components.modules}
                selected={whatIf.modules}
                onToggle={toggleModule}
              />
            )}
            {tab === "removed" && (
              <RemovedPanel removed={sizes.removed_by_finalize} />
            )}
            {tab === "drift" && manifest && buildId && platform && (
              <DriftView
                builds={manifest.builds}
                baseBuildId={buildId}
                platform={platform}
              />
            )}
          </main>

          <aside className="sidebar">
            <WhatIfPanel
              sizes={sizes}
              selectedPackages={whatIf.packages}
              selectedModules={whatIf.modules}
              onClear={clearWhatIf}
            />
          </aside>
        </>
      )}

      <footer>
        <p className="muted">
          data:{" "}
          <a href={manifestUrl(source)} target="_blank" rel="noreferrer">
            {manifestUrl(source)}
          </a>{" "}
          · source:{" "}
          <a
            href="https://github.com/OpenIPC/firmware-explorer"
            target="_blank"
            rel="noreferrer"
          >
            OpenIPC/firmware-explorer
          </a>{" "}
          · schema:{" "}
          <a
            href="https://github.com/OpenIPC/firmware/blob/master/general/scripts/size_report.py"
            target="_blank"
            rel="noreferrer"
          >
            size_report.py
          </a>
        </p>
      </footer>
    </div>
  );
}
