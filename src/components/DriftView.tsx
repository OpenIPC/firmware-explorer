import { useEffect, useMemo, useState } from "react";
import type { Build, Sizes, Source } from "../lib/types";
import { fetchPlatformSizes } from "../lib/sizes";
import { diffSizes, type DriftRow } from "../lib/drift";
import { fmtBytes, fmtSignedBytes } from "../lib/format";
import { buildOptionLabel } from "./BuildPicker";

type Props = {
  source: Source;
  builds: Build[];
  baseBuildId: string;
  platform: string;
  compareBuildId: string | null;
  onCompareChange: (id: string) => void;
};

export function DriftView({
  source,
  builds,
  baseBuildId,
  platform,
  compareBuildId,
  onCompareChange,
}: Props) {
  const otherBuilds = useMemo(
    () =>
      builds.filter(
        (b) => b.id !== baseBuildId && b.platforms.includes(platform),
      ),
    [builds, baseBuildId, platform],
  );

  // The compare select is controlled by the URL-bearing parent. When the
  // parent passes null, fall back to the newest other-build that has this
  // platform — same behaviour as v0.2, just without an internal source of
  // truth. The effective ID is what actually drives the fetch.
  const effectiveCompareId = useMemo(() => {
    if (compareBuildId && otherBuilds.some((b) => b.id === compareBuildId)) {
      return compareBuildId;
    }
    return otherBuilds[0]?.id ?? null;
  }, [compareBuildId, otherBuilds]);

  const [baseSizes, setBaseSizes] = useState<Sizes | null>(null);
  const [cmpSizes, setCmpSizes] = useState<Sizes | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCmpSizes(null);
    setBaseSizes(null);
  }, [baseBuildId, platform]);

  useEffect(() => {
    setError(null);
    if (!effectiveCompareId) return;
    Promise.all([
      fetchPlatformSizes(source, baseBuildId, platform),
      fetchPlatformSizes(source, effectiveCompareId, platform),
    ])
      .then(([b, c]) => {
        setBaseSizes(b);
        setCmpSizes(c);
      })
      .catch((e: Error) => setError(e.message));
  }, [source, baseBuildId, effectiveCompareId, platform]);

  const rows = useMemo<DriftRow[]>(() => {
    if (!baseSizes || !cmpSizes) return [];
    return diffSizes(cmpSizes, baseSizes);
  }, [baseSizes, cmpSizes]);

  if (otherBuilds.length === 0) {
    return (
      <p className="muted">
        No other build in this catalogue has sizes data for{" "}
        <code>{platform}</code> — drift view needs at least two.
      </p>
    );
  }

  return (
    <div>
      <label className="picker">
        <span className="picker-label">Compare against</span>
        <select
          value={effectiveCompareId ?? ""}
          onChange={(e) => onCompareChange(e.target.value)}
        >
          {otherBuilds.map((b, i) => (
            <option key={b.id} value={b.id} title={b.id}>
              {buildOptionLabel(b, i === 0)}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="error">drift fetch failed: {error}</p>}

      {baseSizes && cmpSizes && (
        <>
          <p className="muted">
            <strong>
              {baseSizes.board}-{baseSizes.variant}
            </strong>{" "}
            — uncompressed bytes per item, <code>{effectiveCompareId}</code> ⇒{" "}
            <code>{baseBuildId}</code>. Only items whose size changed are
            listed. Sorted by absolute delta.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Name</th>
                <th className="num">Before</th>
                <th className="num">After</th>
                <th className="num">Δ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.kind + ":" + r.name}
                  className={
                    r.delta > 0
                      ? "drift-up"
                      : r.delta < 0
                        ? "drift-down"
                        : undefined
                  }
                >
                  <td className="muted">{r.kind}</td>
                  <td>{r.name}</td>
                  <td className="num">{fmtBytes(r.before)}</td>
                  <td className="num">{fmtBytes(r.after)}</td>
                  <td className="num">
                    <strong>{fmtSignedBytes(r.delta)}</strong>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    no drift between these two builds for this platform
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
