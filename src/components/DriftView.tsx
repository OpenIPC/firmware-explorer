import { useEffect, useMemo, useState } from "react";
import type { Build, Sizes, Source } from "../lib/types";
import { fetchPlatformSizes } from "../lib/sizes";
import { diffSizes, type DriftRow } from "../lib/drift";

type Props = {
  source: Source;
  builds: Build[];
  baseBuildId: string;
  platform: string;
};

function fmtBytes(b: number): string {
  if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(2) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(1) + " KB";
  return Math.round(b) + " B";
}

function fmtSignedBytes(b: number): string {
  const sign = b < 0 ? "−" : b > 0 ? "+" : "";
  const a = Math.abs(b);
  if (a >= 1024 * 1024) return sign + (a / 1024 / 1024).toFixed(2) + " MB";
  if (a >= 1024) return sign + (a / 1024).toFixed(1) + " KB";
  return sign + Math.round(a) + " B";
}

export function DriftView({ source, builds, baseBuildId, platform }: Props) {
  const otherBuilds = useMemo(
    () =>
      builds.filter(
        (b) => b.id !== baseBuildId && b.platforms.includes(platform),
      ),
    [builds, baseBuildId, platform],
  );

  const [compareId, setCompareId] = useState<string | null>(
    otherBuilds[0]?.id ?? null,
  );
  const [baseSizes, setBaseSizes] = useState<Sizes | null>(null);
  const [cmpSizes, setCmpSizes] = useState<Sizes | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCompareId(otherBuilds[0]?.id ?? null);
    setCmpSizes(null);
    setBaseSizes(null);
  }, [baseBuildId, platform, otherBuilds]);

  useEffect(() => {
    setError(null);
    if (!compareId) return;
    Promise.all([
      fetchPlatformSizes(source, baseBuildId, platform),
      fetchPlatformSizes(source, compareId, platform),
    ])
      .then(([b, c]) => {
        setBaseSizes(b);
        setCmpSizes(c);
      })
      .catch((e: Error) => setError(e.message));
  }, [source, baseBuildId, compareId, platform]);

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
          value={compareId ?? ""}
          onChange={(e) => setCompareId(e.target.value)}
        >
          {otherBuilds.map((b) => (
            <option key={b.id} value={b.id}>
              {b.id} — {b.built_at}
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
            — uncompressed bytes per item, <code>{compareId}</code> ⇒{" "}
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
