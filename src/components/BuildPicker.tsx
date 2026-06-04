import type { IndexFile } from "../lib/types";

type Props = {
  index: IndexFile;
  value: string | null;
  onChange: (id: string) => void;
  label?: string;
};

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
        {index.builds.map((b) => (
          <option key={b.id} value={b.id}>
            {b.id} — {b.built_at}
          </option>
        ))}
      </select>
    </label>
  );
}
