import { Fragment, useEffect, useMemo, useState } from "react";
import type { Source } from "../lib/types";
import type { HeadroomPoint, SeriesPoint, TrendsFile } from "../lib/timeseries";
import {
  projectOverflow,
  sortedByDate,
  topGrowers,
  type GrowerRow,
} from "../lib/timeseries";
import { fetchTrends } from "../lib/trends";

type Props = {
  source: Source;
  platform: string;
};

type WindowDays = 7 | 14 | 30 | 90;
type Kind = "packages" | "modules";

const WINDOW_OPTIONS: WindowDays[] = [7, 14, 30, 90];
const TOP_N = 20;

function fmtBytes(b: number): string {
  const abs = Math.abs(b);
  if (abs >= 1024 * 1024) return (b / 1024 / 1024).toFixed(2) + " MB";
  if (abs >= 1024) return (b / 1024).toFixed(1) + " KB";
  return b + " B";
}

function fmtSignedBytes(b: number): string {
  const sign = b > 0 ? "+" : b < 0 ? "−" : "";
  const abs = Math.abs(b);
  if (abs >= 1024 * 1024) return sign + (abs / 1024 / 1024).toFixed(2) + " MB";
  if (abs >= 1024) return sign + (abs / 1024).toFixed(1) + " KB";
  return sign + abs + " B";
}

function fmtPerWeek(perDay: number): string {
  return fmtSignedBytes(perDay * 7) + "/wk";
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

export function TrendsView({ source, platform }: Props) {
  const [trends, setTrends] = useState<TrendsFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [kind, setKind] = useState<Kind>("packages");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [minWeeklyKb, setMinWeeklyKb] = useState<number>(0);

  useEffect(() => {
    setTrends(null);
    setError(null);
    setExpanded(null);
    fetchTrends(source, platform)
      .then(setTrends)
      .catch((e: Error) => setError(e.message));
  }, [source, platform]);

  const seriesByName = useMemo(() => {
    if (!trends) return {};
    return kind === "packages" ? trends.packages : trends.modules;
  }, [trends, kind]);

  const growers = useMemo<GrowerRow[]>(() => {
    if (!trends) return [];
    const all = topGrowers(seriesByName, windowDays, 1_000);
    const threshold = minWeeklyKb * 1024;
    const filtered = threshold > 0
      ? all.filter((r) => Math.abs(r.perDayBytes * 7) >= threshold)
      : all;
    return filtered.slice(0, TOP_N);
  }, [trends, seriesByName, windowDays, minWeeklyKb]);

  const dataWindow = useMemo(() => {
    if (!trends) return null;
    const all = trends.headroom_rootfs;
    if (all.length === 0) return null;
    return {
      points: all.length,
      oldest: all[0]?.built_at,
      newest: all[all.length - 1]?.built_at,
    };
  }, [trends]);

  if (error) {
    return (
      <p className="error">
        trends fetch failed: {error}
      </p>
    );
  }
  if (!trends) {
    return <p className="muted">loading trends…</p>;
  }
  if (!dataWindow) {
    return (
      <p className="muted">
        no historical data available for this platform yet
      </p>
    );
  }

  return (
    <div>
      <p className="muted">
        <strong>{dataWindow.points}</strong> builds, {fmtDate(dataWindow.oldest!)} →{" "}
        {fmtDate(dataWindow.newest!)}. v0.4 ships per-platform aggregates over
        the explorer's retention window; the leaderboard surfaces the kind of
        week-on-week creep that PR #2163 had to wait for a rootfs overflow to
        notice.
      </p>

      <HeadroomChart
        title="Rootfs headroom"
        headroom={trends.headroom_rootfs}
        windowDays={windowDays}
      />
      <HeadroomChart
        title="Kernel headroom"
        headroom={trends.headroom_kernel}
        windowDays={windowDays}
      />

      <div className="trends-controls">
        <label>
          <span>Window</span>
          <div className="segmented">
            {WINDOW_OPTIONS.map((d) => (
              <button
                key={d}
                className={d === windowDays ? "active" : ""}
                onClick={() => setWindowDays(d)}
              >
                {d}d
              </button>
            ))}
          </div>
        </label>
        <label>
          <span>Kind</span>
          <div className="segmented">
            <button
              className={kind === "packages" ? "active" : ""}
              onClick={() => setKind("packages")}
            >
              Packages
            </button>
            <button
              className={kind === "modules" ? "active" : ""}
              onClick={() => setKind("modules")}
            >
              Modules
            </button>
          </div>
        </label>
        <label>
          <span>Min weekly Δ (KB)</span>
          <input
            type="number"
            min={0}
            value={minWeeklyKb}
            onChange={(e) => setMinWeeklyKb(Number(e.target.value) || 0)}
            style={{ width: 80 }}
          />
        </label>
        <span className="filter-summary">
          {growers.length} growers (top {TOP_N} of {Object.keys(seriesByName).length})
        </span>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>{kind === "packages" ? "Package" : "Module"}</th>
            <th className="num">Now</th>
            <th className="num">Δ in window</th>
            <th className="num">≈ /week</th>
            <th>Trend</th>
          </tr>
        </thead>
        <tbody>
          {growers.map((g) => {
            const series = seriesByName[g.name] ?? [];
            const isOpen = expanded === g.name;
            const direction = g.delta > 0 ? "grow" : g.delta < 0 ? "shrink" : "flat";
            return (
              <Fragment key={g.name}>
                <tr className={`drift-${direction === "grow" ? "up" : direction === "shrink" ? "down" : ""}`}>
                  <td>
                    <button
                      className="row-expand"
                      onClick={() => setExpanded(isOpen ? null : g.name)}
                      title={isOpen ? "collapse" : "show sparkline"}
                    >
                      {isOpen ? "▾" : "▸"} {g.name}
                    </button>
                  </td>
                  <td className="num">{fmtBytes(g.lastBytes)}</td>
                  <td className="num"><strong>{fmtSignedBytes(g.delta)}</strong></td>
                  <td className="num">{fmtPerWeek(g.perDayBytes)}</td>
                  <td>
                    <Sparkline
                      series={sortedByDate(series)}
                      windowDays={windowDays}
                      width={180}
                      height={28}
                    />
                  </td>
                </tr>
                {isOpen && (
                  <tr className="row-files">
                    <td colSpan={5}>
                      <Sparkline
                        series={sortedByDate(series)}
                        windowDays={windowDays}
                        width={760}
                        height={140}
                        showAxes
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {growers.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                no {kind} cross the {minWeeklyKb} KB/wk threshold over the last {windowDays} days
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline — simple SVG polyline, no chart library.
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

function Sparkline({
  series,
  windowDays,
  width,
  height,
  showAxes = false,
}: {
  series: readonly SeriesPoint[];
  windowDays: number;
  width: number;
  height: number;
  showAxes?: boolean;
}) {
  const now = Date.now();
  const cutoff = now - windowDays * MS_PER_DAY;
  const visible = series.filter((p) => new Date(p.built_at).getTime() >= cutoff);

  if (visible.length < 2) {
    return (
      <span className="muted" style={{ fontSize: 11 }}>
        only {visible.length} point{visible.length === 1 ? "" : "s"}
      </span>
    );
  }

  const minBytes = Math.min(...visible.map((p) => p.bytes));
  const maxBytes = Math.max(...visible.map((p) => p.bytes));
  const range = Math.max(1, maxBytes - minBytes);
  const t0 = new Date(visible[0].built_at).getTime();
  const tn = new Date(visible[visible.length - 1].built_at).getTime();
  const span = Math.max(1, tn - t0);

  const pad = showAxes ? 28 : 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const pts = visible.map((p) => {
    const x = pad + ((new Date(p.built_at).getTime() - t0) / span) * innerW;
    const y = pad + innerH - ((p.bytes - minBytes) / range) * innerH;
    return { x, y, p };
  });

  const path = pts.map((q, i) => `${i === 0 ? "M" : "L"}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ");
  const lastDelta = pts[pts.length - 1].p.bytes - pts[0].p.bytes;
  const colour = lastDelta > 0 ? "#f0883e" : lastDelta < 0 ? "#3fb950" : "#8b949e";

  return (
    <svg width={width} height={height} className="sparkline">
      {showAxes && (
        <>
          <text x={4} y={pad + 6} className="trend-axis-label">{fmtBytes(maxBytes)}</text>
          <text x={4} y={height - 4} className="trend-axis-label">{fmtBytes(minBytes)}</text>
          <text x={pad} y={height - 4} className="trend-axis-label">{fmtDate(visible[0].built_at)}</text>
          <text x={width - 60} y={height - 4} className="trend-axis-label">{fmtDate(visible[visible.length - 1].built_at)}</text>
        </>
      )}
      <path d={path} stroke={colour} strokeWidth={1.5} fill="none" />
      {pts.map((q) => (
        <circle key={q.p.build_id} cx={q.x} cy={q.y} r={1.6} fill={colour}>
          <title>{q.p.build_id} · {fmtBytes(q.p.bytes)}</title>
        </circle>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// HeadroomChart — like Sparkline but draws a cap line + overflow projection.
// ---------------------------------------------------------------------------

function HeadroomChart({
  title,
  headroom,
  windowDays,
}: {
  title: string;
  headroom: readonly HeadroomPoint[];
  windowDays: number;
}) {
  const now = Date.now();
  const cutoff = now - windowDays * MS_PER_DAY;
  const visible = headroom.filter(
    (p) => new Date(p.built_at).getTime() >= cutoff,
  );
  const proj = useMemo(
    () => projectOverflow(headroom, windowDays, now),
    [headroom, windowDays, now],
  );

  if (visible.length === 0) {
    return null;
  }

  const width = 760;
  const height = 100;
  const pad = 36;

  const capKb = visible[0].cap_kb || 1;
  const t0 = new Date(visible[0].built_at).getTime();
  const tn = new Date(visible[visible.length - 1].built_at).getTime();
  const span = Math.max(1, tn - t0);
  const innerW = width - pad * 2;
  const innerH = height - pad * 1.4;

  const pts = visible.map((p) => {
    const x = pad + ((new Date(p.built_at).getTime() - t0) / span) * innerW;
    // Y axis: 0 (full) ↔ capKb (over). Used_kb maps from top to bottom.
    const usedFrac = Math.max(0, Math.min(1, p.used_kb / capKb));
    const y = pad + usedFrac * innerH;
    return { x, y, p };
  });

  const usedPath = pts
    .map((q, i) => `${i === 0 ? "M" : "L"}${q.x.toFixed(1)},${q.y.toFixed(1)}`)
    .join(" ");
  const lastHeadroom = visible[visible.length - 1].headroom_kb ?? 0;
  const colour = lastHeadroom < 0 ? "#f85149" : lastHeadroom < capKb * 0.05 ? "#f0883e" : "#3fb950";

  return (
    <div className="headroom-chart">
      <div className="headroom-chart-head">
        <span className="kpi-label">{title}</span>
        <span className="muted">
          cap {capKb} KB · now {fmtBytes(visible[visible.length - 1].used_kb * 1024)} /{" "}
          {capKb * 1024 > 0 ? fmtBytes(capKb * 1024) : "—"} ·{" "}
          headroom {lastHeadroom} KB
        </span>
        {proj && proj.daysToZero < 60 && (
          <span className="badge badge-tight">
            projected overflow in {Math.round(proj.daysToZero)}d
            ({proj.projectedDate.slice(0, 10)})
          </span>
        )}
      </div>
      <svg width={width} height={height} className="sparkline">
        <line
          x1={pad}
          y1={pad}
          x2={width - pad}
          y2={pad}
          stroke="#30363d"
          strokeDasharray="2 3"
        />
        <text x={4} y={pad + 4} className="trend-axis-label">cap</text>
        <line
          x1={pad}
          y1={pad + innerH}
          x2={width - pad}
          y2={pad + innerH}
          stroke="#30363d"
          strokeDasharray="2 3"
        />
        <text x={4} y={pad + innerH + 4} className="trend-axis-label">0</text>
        <path d={usedPath} stroke={colour} strokeWidth={1.8} fill="none" />
        {pts.map((q) => (
          <circle key={q.p.build_id} cx={q.x} cy={q.y} r={2} fill={colour}>
            <title>
              {q.p.build_id} · used {q.p.used_kb} KB · headroom {q.p.headroom_kb ?? "n/a"} KB
            </title>
          </circle>
        ))}
        <text x={pad} y={height - 6} className="trend-axis-label">
          {fmtDate(visible[0].built_at)}
        </text>
        <text x={width - 70} y={height - 6} className="trend-axis-label">
          {fmtDate(visible[visible.length - 1].built_at)}
        </text>
      </svg>
    </div>
  );
}
