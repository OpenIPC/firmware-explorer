import type { Build } from "../lib/types";

type Props = {
  build: Build;
  value: string | null;
  onChange: (platform: string) => void;
  label?: string;
};

export function PlatformPicker({ build, value, onChange, label = "Platform" }: Props) {
  const entries = Object.entries(build.platforms)
    .filter(([, a]) => a.sizes)
    .sort(([a], [b]) => a.localeCompare(b));

  const missing = Object.keys(build.platforms).length - entries.length;

  return (
    <label className="picker">
      <span className="picker-label">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={entries.length === 0}
      >
        <option value="" disabled>
          {entries.length === 0 ? "no sizes data in this build" : "— pick a platform —"}
        </option>
        {entries.map(([plat]) => (
          <option key={plat} value={plat}>
            {plat}
          </option>
        ))}
      </select>
      {missing > 0 && (
        <span className="picker-hint">
          ({missing} platform{missing === 1 ? "" : "s"} without sizes data hidden)
        </span>
      )}
    </label>
  );
}
