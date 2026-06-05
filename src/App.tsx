import { useEffect, useMemo, useState } from "react";
import type { Build, IndexFile, Sizes, Source } from "./lib/types";
import { fetchIndex, indexUrl } from "./lib/index";
import { fetchPlatformSizes } from "./lib/sizes";
import { readQueryString, writeQueryString } from "./lib/url";
import { BuildPicker } from "./components/BuildPicker";
import { PlatformPicker } from "./components/PlatformPicker";
import { SizeSummary } from "./components/SizeSummary";
import { PackageTable } from "./components/PackageTable";
import { ModuleTable } from "./components/ModuleTable";
import { PackageTreemap } from "./components/PackageTreemap";
import { RemovedPanel } from "./components/RemovedPanel";
import { DriftView } from "./components/DriftView";
import { WhatIfPanel } from "./components/WhatIfPanel";

type Tab = "tree" | "packages" | "modules" | "removed" | "drift" | "configure";

export function App() {
  const initial = useMemo(() => readQueryString(window.location.search), []);
  const [source, setSource] = useState<Source>(initial.source);
  const [index, setIndex] = useState<IndexFile | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [buildId, setBuildId] = useState<string | null>(initial.buildId);
  const [platform, setPlatform] = useState<string | null>(initial.platform);
  const [sizes, setSizes] = useState<Sizes | null>(null);
  const [sizesError, setSizesError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("tree");

  // Fetch index on source change.
  useEffect(() => {
    setIndex(null);
    setIndexError(null);
    fetchIndex(source)
      .then((m) => setIndex(m))
      .catch((e: Error) => setIndexError(e.message));
  }, [source]);

  // Default build = newest in index if none chosen yet.
  useEffect(() => {
    if (index && !buildId && index.builds.length > 0) {
      setBuildId(index.builds[0].id);
    }
  }, [index, buildId]);

  // Default platform when build changes if none chosen (or new one is missing).
  useEffect(() => {
    if (!index || !buildId) return;
    const build = index.builds.find((b) => b.id === buildId);
    if (!build) return;
    if (platform && build.platforms.includes(platform)) return;
    setPlatform(build.platforms[0] ?? null);
  }, [index, buildId, platform]);

  // Fetch the selected platform's sizes JSON (same-origin shard).
  useEffect(() => {
    setSizes(null);
    setSizesError(null);
    if (!index || !buildId || !platform) return;
    fetchPlatformSizes(source, buildId, platform)
      .then((s) => setSizes(s))
      .catch((e: Error) => setSizesError(e.message));
  }, [source, index, buildId, platform]);

  // Persist state to URL.
  useEffect(() => {
    const q = writeQueryString({ source, buildId, platform });
    window.history.replaceState({}, "", window.location.pathname + q);
  }, [source, buildId, platform]);

  const build: Build | null = index && buildId
    ? index.builds.find((b) => b.id === buildId) ?? null
    : null;

  return (
    <div className="app">
      <header>
        <h1>
          OpenIPC firmware explorer{" "}
          <span className="version-tag">v0.2</span>
        </h1>
        <div className="source-toggle" role="tablist" aria-label="Manifest source">
          {(["firmware", "builder"] as Source[]).map((s) => (
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
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </header>

      <section className="pickers">
        {indexError ? (
          <p className="error">
            index fetch failed for <code>{indexUrl(source)}</code>:{" "}
            {indexError}
          </p>
        ) : !index ? (
          <p className="muted">loading index…</p>
        ) : (
          <>
            <BuildPicker
              index={index}
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
            {(() => {
              const kconfigAvailable =
                platform !== null &&
                index?.kconfig_available_for?.includes(platform);
              const tabs: Array<[Tab, string, boolean]> = [
                ["tree", "Treemap", true],
                ["packages", `Packages (${sizes.packages.length})`, true],
                [
                  "modules",
                  `Modules (${sizes.linux_components.modules.length})`,
                  true,
                ],
                [
                  "removed",
                  `Removed-by-finalize (${sizes.removed_by_finalize.length})`,
                  true,
                ],
                ["drift", "Drift vs another build", true],
                ["configure", "Configure (what-if)", !!kconfigAvailable],
              ];
              return tabs.map(([k, label, enabled]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  className={tab === k ? "active" : ""}
                  disabled={!enabled}
                  title={
                    !enabled && k === "configure"
                      ? "Kconfig graph not yet published for this platform"
                      : undefined
                  }
                  onClick={() => enabled && setTab(k)}
                >
                  {label}
                </button>
              ));
            })()}
          </nav>

          <main>
            {tab === "tree" && <PackageTreemap packages={sizes.packages} />}
            {tab === "packages" && <PackageTable packages={sizes.packages} />}
            {tab === "modules" && (
              <ModuleTable modules={sizes.linux_components.modules} />
            )}
            {tab === "removed" && (
              <RemovedPanel removed={sizes.removed_by_finalize} />
            )}
            {tab === "drift" && index && buildId && platform && (
              <DriftView
                source={source}
                builds={index.builds}
                baseBuildId={buildId}
                platform={platform}
              />
            )}
            {tab === "configure" && platform && (
              <WhatIfPanel source={source} platform={platform} sizes={sizes} />
            )}
          </main>
        </>
      )}

      <footer>
        <p className="muted">
          data baked at build time from{" "}
          <a
            href={`https://github.com/${source === "firmware" ? "OpenIPC/firmware" : "OpenIPC/builder"}/releases`}
            target="_blank"
            rel="noreferrer"
          >
            OpenIPC/{source} releases
          </a>{" "}
          · runtime fetches are same-origin only · source:{" "}
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
