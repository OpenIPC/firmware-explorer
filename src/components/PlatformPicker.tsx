import type { Build } from "../lib/types";

type Props = {
  build: Build;
  value: string | null;
  onChange: (platform: string) => void;
  label?: string;
};

export function PlatformPicker({ build, value, onChange, label = "Platform" }: Props) {
  const platforms = [...build.platforms].sort((a, b) => a.localeCompare(b));

  return (
    <label className="picker">
      <span className="picker-label">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={platforms.length === 0}
      >
        <option value="" disabled>
          {platforms.length === 0
            ? "no sizes data in this build"
            : "— pick a platform —"}
        </option>
        {platforms.map((plat) => (
          <option key={plat} value={plat}>
            {plat}
          </option>
        ))}
      </select>
    </label>
  );
}
