import { useEffect, useMemo, useState } from "react";
import type {
  KconfigGraph,
  KconfigHelp,
  Sizes,
  Source,
} from "../lib/types";
import {
  buildRequest,
  closeDisable,
  defconfigFragment,
  fetchKconfigGraph,
  fetchKconfigHelp,
} from "../lib/kconfig";
import { fmtBytes } from "../lib/format";

type Props = {
  source: Source;
  platform: string;
  sizes: Sizes;
};

export function WhatIfPanel({ source, platform, sizes }: Props) {
  const [graph, setGraph] = useState<KconfigGraph | null>(null);
  const [help, setHelp] = useState<KconfigHelp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userDisabled, setUserDisabled] = useState<Set<string>>(new Set());
  const [openHelp, setOpenHelp] = useState<string | null>(null);

  useEffect(() => {
    setGraph(null);
    setHelp(null);
    setError(null);
    setUserDisabled(new Set());
    fetchKconfigGraph(source, platform).then(setGraph).catch((e: Error) => setError(e.message));
    fetchKconfigHelp(source, platform).then(setHelp).catch(() => {
      // Help is optional — main panel still works without it.
    });
  }, [source, platform]);

  const closure = useMemo(() => {
    if (!graph) return null;
    return closeDisable(graph, userDisabled);
  }, [graph, userDisabled]);

  // Map symbol → package, then package → uncompressed bytes from sizes.json.
  const packageBytes = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of sizes.packages) m.set(p.name, p.uncompressed_bytes);
    return m;
  }, [sizes]);

  const savings = useMemo(() => {
    if (!graph || !closure) return { bytes: 0, packagesHit: [] as string[] };
    const hit = new Set<string>();
    for (const sym of closure.disabled) {
      const pkg = graph.symbols[sym]?.package;
      if (pkg && packageBytes.has(pkg)) hit.add(pkg);
    }
    let total = 0;
    for (const p of hit) total += packageBytes.get(p) ?? 0;
    return { bytes: total, packagesHit: [...hit].sort() };
  }, [graph, closure, packageBytes]);

  const toggleSymbol = (name: string) => {
    setUserDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const downloadFragment = () => {
    if (!graph || !closure) return;
    const text = defconfigFragment(graph, closure.disabled);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${graph.board}-${graph.variant}-custom.config.fragment`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const openBuildRequest = () => {
    if (!graph || !closure) return;
    const headroomKb = sizes.headroom.rootfs.headroom_kb ?? 0;
    const req = buildRequest({
      graph,
      disabled: closure.disabled,
      savingsBytes: savings.bytes,
      newHeadroomKb: headroomKb + Math.round(savings.bytes / 1024),
      shareUrl: window.location.href,
    });
    if (req.truncated) {
      const proceed = confirm(
        "The defconfig fragment was clipped to fit GitHub's URL length budget. " +
          "Open the issue anyway? You can paste the full fragment as a follow-up comment.",
      );
      if (!proceed) return;
    }
    window.open(req.url, "_blank", "noopener,noreferrer");
  };

  if (error) {
    return <p className="error">configurator data unavailable: {error}</p>;
  }
  if (!graph) {
    return <p className="muted">loading kconfig graph…</p>;
  }

  const headroomKb = sizes.headroom.rootfs.headroom_kb ?? 0;
  const newHeadroomKb = headroomKb + Math.round(savings.bytes / 1024);
  const sortedSymbols = Object.entries(graph.symbols).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <div>
      <p className="muted">
        Tick a package to mark it for removal. The cascade column shows
        what's hard-pinning a symbol on; the explorer disables transitively
        where possible. <strong>Save bytes</strong> reflects the closure's
        impact against this build's <code>sizes.json</code>.
      </p>

      <div className="what-if-summary">
        <div>
          <div className="kpi-label">Disabled symbols</div>
          <div className="kpi-value">{closure?.disabled.size ?? 0}</div>
        </div>
        <div>
          <div className="kpi-label">Blocked</div>
          <div className="kpi-value">{closure?.blocked.size ?? 0}</div>
        </div>
        <div>
          <div className="kpi-label">Estimated rootfs savings</div>
          <div className="kpi-value">{fmtBytes(savings.bytes)}</div>
        </div>
        <div>
          <div className="kpi-label">New rootfs headroom</div>
          <div className={`kpi-value ${newHeadroomKb > 0 ? "positive" : "negative"}`}>
            ≈ {newHeadroomKb} KB
          </div>
        </div>
        <div className="what-if-actions">
          <button
            className="btn-primary"
            disabled={(closure?.disabled.size ?? 0) === 0}
            onClick={downloadFragment}
            title="Save a Buildroot defconfig fragment you append to your board defconfig."
          >
            Download defconfig fragment
          </button>
          <button
            className="btn-secondary"
            disabled={(closure?.disabled.size ?? 0) === 0}
            onClick={openBuildRequest}
            title="Open a pre-filled build-request issue on OpenIPC/builder for a maintainer to dispatch."
          >
            Open build request
          </button>
        </div>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th className="col-toggle">×</th>
            <th>Symbol</th>
            <th>Package</th>
            <th>Status</th>
            <th>Pinned by</th>
            <th className="num">Size</th>
          </tr>
        </thead>
        <tbody>
          {sortedSymbols.map(([name, sym]) => {
            const wanted = userDisabled.has(name);
            const inClosure = closure?.disabled.has(name) ?? false;
            const blockedBy = closure?.blocked.get(name);
            const pkgBytes = sym.package ? packageBytes.get(sym.package) ?? 0 : 0;
            const helpText = help?.help[name];
            const status = inClosure
              ? "would-disable"
              : blockedBy
                ? "blocked"
                : "kept";

            return (
              <tr key={name} className={inClosure ? "row-disabled" : undefined}>
                <td className="col-toggle">
                  <input
                    type="checkbox"
                    checked={wanted}
                    onChange={() => toggleSymbol(name)}
                  />
                </td>
                <td>
                  <button
                    className="row-expand"
                    onClick={() => setOpenHelp(openHelp === name ? null : name)}
                    title="show help"
                  >
                    {name}
                    {sym.prompt ? ` — ${sym.prompt}` : ""}
                  </button>
                  {openHelp === name && helpText && (
                    <pre className="help-popover">{helpText}</pre>
                  )}
                </td>
                <td>{sym.package ?? <span className="muted">—</span>}</td>
                <td>
                  <span className={`badge badge-${status}`}>
                    {status === "would-disable"
                      ? "would disable"
                      : status === "blocked"
                        ? "blocked"
                        : "kept"}
                  </span>
                </td>
                <td>
                  {blockedBy && blockedBy.length > 0 ? (
                    blockedBy.map((s) => (
                      <code key={s} className="pin-chip">
                        {s}
                      </code>
                    ))
                  ) : sym.selected_by.length > 0 ? (
                    <span className="muted" title={sym.selected_by.join(", ")}>
                      {sym.selected_by.length} selector
                      {sym.selected_by.length === 1 ? "" : "s"}
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="num">
                  {pkgBytes > 0 ? fmtBytes(pkgBytes) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
