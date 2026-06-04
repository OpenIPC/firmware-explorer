import type { Manifest } from "../lib/types";

type Props = {
  manifest: Manifest;
  value: string | null;
  onChange: (id: string) => void;
  label?: string;
};

export function BuildPicker({ manifest, value, onChange, label = "Build" }: Props) {
  const channelLabel = (id: string): string => {
    const ch = Object.entries(manifest.channels)
      .filter(([, v]) => v === id)
      .map(([k]) => k);
    return ch.length ? ` [${ch.join(", ")}]` : "";
  };

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
        {manifest.builds.map((b) => (
          <option key={b.id} value={b.id}>
            {b.id}
            {channelLabel(b.id)} — {b.built_at}
          </option>
        ))}
      </select>
    </label>
  );
}
