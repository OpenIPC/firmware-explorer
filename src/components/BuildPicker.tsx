import type { IndexFile } from "../lib/types";

type Props = {
  index: IndexFile;
  value: string | null;
  onChange: (id: string) => void;
  label?: string;
};

/**
 * Render an ISO timestamp as `YYYY-MM-DD HH:MM UTC`. Strips seconds and the
 * `T`/`Z` markers so two builds on the same UTC day are visually distinct
 * by their time-of-day. Falls back to the input on parse failure.
 */
export function fmtBuildAt(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]} UTC` : iso;
}

/**
 * Compose the human-readable option label.
 *
 * Old format `nightly-20260604-d7e89a8 — 2026-06-04T23:42:59Z` put two
 * same-day builds at indistinguishable visual positions: both started with
 * the same `nightly-20260604-` prefix and the timestamp came last. New
 * format leads with time-of-day so a same-day pair reads as
 * `2026-06-04 23:42 UTC — d7e89a8` vs `2026-06-04 00:11 UTC — 679c2c7`.
 */
export function buildOptionLabel(
  build: { built_at: string; short: string; id: string },
  isNewest: boolean,
): string {
  const sha = build.short || build.id.split("-").slice(-1)[0];
  const suffix = isNewest ? " · newest" : "";
  return `${fmtBuildAt(build.built_at)} — ${sha}${suffix}`;
}

export function BuildPicker({ index, value, onChange, label = "Build" }: Props) {
  return (
    <label className="picker">
      <span className="picker-label">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>
          — pick a build —
        </option>
        {index.builds.map((b, i) => (
          <option key={b.id} value={b.id} title={b.id}>
            {buildOptionLabel(b, i === 0)}
          </option>
        ))}
      </select>
    </label>
  );
}
