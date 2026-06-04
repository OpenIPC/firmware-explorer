import { useMemo } from "react";
import { hierarchy, treemap } from "d3-hierarchy";
import type { SizesPackage } from "../lib/types";
import { categorise, CATEGORY_COLOUR, CATEGORY_LABEL } from "../lib/categorise";

type Props = {
  packages: SizesPackage[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  width?: number;
  height?: number;
};

type Leaf = {
  name: string;
  size: number;
  category: ReturnType<typeof categorise>;
};

export function PackageTreemap({
  packages,
  selected,
  onToggle,
  width = 960,
  height = 480,
}: Props) {
  const layout = useMemo(() => {
    const leaves: Leaf[] = packages
      .filter((p) => p.uncompressed_bytes > 0)
      .map((p) => ({
        name: p.name,
        size: p.uncompressed_bytes,
        category: categorise(p.name),
      }));
    const root = hierarchy<{ children?: Leaf[] } | Leaf>({ children: leaves })
      .sum((d) => ("size" in d ? d.size : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    treemap<{ children?: Leaf[] } | Leaf>()
      .size([width, height])
      .paddingInner(1)
      .round(true)(root);
    return root.leaves() as unknown as Array<{
      x0: number;
      x1: number;
      y0: number;
      y1: number;
      data: Leaf;
    }>;
  }, [packages, width, height]);

  // Legend = unique categories present in the data.
  const categoriesPresent = useMemo(() => {
    const s = new Set<ReturnType<typeof categorise>>();
    for (const p of packages) s.add(categorise(p.name));
    return [...s];
  }, [packages]);

  return (
    <div className="treemap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMinYMin meet"
        className="treemap-svg"
      >
        {layout.map((d) => {
          const w = d.x1 - d.x0;
          const h = d.y1 - d.y0;
          const showLabel = w > 60 && h > 22;
          const showSize = w > 80 && h > 38;
          const isSelected = selected.has(d.data.name);
          return (
            <g
              key={d.data.name}
              transform={`translate(${d.x0},${d.y0})`}
              className={`treemap-cell${isSelected ? " treemap-selected" : ""}`}
              onClick={() => onToggle(d.data.name)}
            >
              <title>
                {d.data.name} ({CATEGORY_LABEL[d.data.category]}){"\n"}
                {(d.data.size / 1024).toFixed(1)} KB
              </title>
              <rect
                width={w}
                height={h}
                fill={CATEGORY_COLOUR[d.data.category]}
                opacity={isSelected ? 0.4 : 0.85}
              />
              {showLabel && (
                <text x={4} y={14} className="treemap-label">
                  {d.data.name}
                </text>
              )}
              {showSize && (
                <text x={4} y={30} className="treemap-size">
                  {(d.data.size / 1024).toFixed(0)} KB
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="treemap-legend">
        {categoriesPresent.map((c) => (
          <span key={c} className="legend-item">
            <span
              className="legend-swatch"
              style={{ background: CATEGORY_COLOUR[c] }}
            />
            {CATEGORY_LABEL[c]}
          </span>
        ))}
        <span className="muted">click a cell to toggle what-if disable</span>
      </div>
    </div>
  );
}
