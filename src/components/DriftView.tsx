import { useEffect, useMemo, useState } from "react";
import type { Build, Sizes } from "../lib/types";
import { fetchSizes } from "../lib/sizes";

type Props = {
  builds: Build[];
  baseBuildId: string;
  platform: string;
};

type Row = {
  kind: "package" | "module";
  name: string;
  before: number;
  after: number;
  delta: number;
};

function fmtBytes(b: number): string {
  const sign = b < 0 ? "−" : b > 0 ? "+" : "";
  const a = Math.abs(b);
  if (a >= 1024 * 1024) return sign + (a / 1024 / 1024).toFixed(2) + " MB";
  if (a >= 1024) return sign + (a / 1024).toFixed(1) + " KB";
  return sign + a + " B";
}

export function DriftView({ builds, baseBuildId, platform }: Props) {
  const otherBuilds = useMemo(
    () => builds.filter((b) => b.id !== baseBuildId && b.platforms[platform]?.sizes),
    [builds, baseBuildId, platform],
  );

  const [compareId, setCompareId] = useState<string | null>(
    otherBuilds[0]?.id ?? null,
  );
  const [baseSizes, setBaseSizes] = useState<Sizes | null>(null);
  const [cmpSizes, setCmpSizes] = useState<Sizes | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset cmp picker when base/platform changes so we don't end up comparing
  // against a build that no longer has data for the new platform.
  useEffect(() => {
    setCompareId(otherBuilds[0]?.id ?? null);
    setCmpSizes(null);
    setBaseSizes(null);
  }, [baseBuildId, platform, otherBuilds]);

  useEffect(() => {
    setError(null);
    const base = builds.find((b) => b.id === baseBuildId);
    const cmp = compareId ? builds.find((b) => b.id === compareId) : null;
    const baseUrl = base?.platforms[platform]?.sizes?.url;
    const cmpUrl = cmp?.platforms[platform]?.sizes?.url;
    if (!baseUrl || !cmpUrl) return;
    Promise.all([fetchSizes(baseUrl), fetchSizes(cmpUrl)])
      .then(([b, c]) => {
        setBaseSizes(b);
        setCmpSizes(c);
      })
      .catch((e: Error) => setError(e.message));
  }, [builds, baseBuildId, compareId, platform]);

  const rows = useMemo<Row[]>(() => {
    if (!baseSizes || !cmpSizes) return [];
    const out: Row[] = [];

    const pkgBefore = new Map(cmpSizes.packages.map((p) => [p.name, p.uncompressed_bytes]));
    const pkgAfter = new Map(baseSizes.packages.map((p) => [p.name, p.uncompressed_bytes]));
    const allPkg = new Set([...pkgBefore.keys(), ...pkgAfter.keys()]);
    for (const name of allPkg) {
      const before = pkgBefore.get(name) ?? 0;
      const after = pkgAfter.get(name) ?? 0;
      if (before !== after) {
        out.push({ kind: "package", name, before, after, delta: after - before });
      }
    }

    const modBefore = new Map(cmpSizes.linux_components.modules.map((m) => [m.name, m.bytes]));
    const modAfter = new Map(baseSizes.linux_components.modules.map((m) => [m.name, m.bytes]));
    const allMod = new Set([...modBefore.keys(), ...modAfter.keys()]);
    for (const name of allMod) {
      const before = modBefore.get(name) ?? 0;
      const after = modAfter.get(name) ?? 0;
      if (before !== after) {
        out.push({ kind: "module", name, before, after, delta: after - before });
      }
    }

    out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return out;
  }, [baseSizes, cmpSizes]);

  if (otherBuilds.length === 0) {
    return (
      <p className="muted">
        No other build in this manifest has sizes data for{" "}
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
            <strong>{baseSizes.board}-{baseSizes.variant}</strong> — uncompressed
            bytes per item, <code>{compareId}</code> ⇒{" "}
            <code>{baseBuildId}</code>. Only items whose size changed are listed.
            Sorted by absolute delta.
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
                    <strong>{fmtBytes(r.delta)}</strong>
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
