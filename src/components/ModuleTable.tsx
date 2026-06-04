import { useMemo, useState } from "react";
import type { SizesModule } from "../lib/types";

type SortKey = "name" | "bytes" | "package" | "autoloaded";
type SortDir = "asc" | "desc";
type Filter = "all" | "autoloaded" | "ondemand";

type Props = {
  modules: SizesModule[];
  selected: Set<string>;
  onToggle: (name: string) => void;
};

function fmtBytes(b: number): string {
  if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(2) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(1) + " KB";
  return b + " B";
}

export function ModuleTable({ modules, selected, onToggle }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("bytes");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    const arr = modules.filter((m) => {
      if (filter === "autoloaded") return m.autoloaded;
      if (filter === "ondemand") return !m.autoloaded;
      return true;
    });
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "bytes":
          cmp = a.bytes - b.bytes;
          break;
        case "package":
          cmp = a.package.localeCompare(b.package);
          break;
        case "autoloaded":
          cmp = Number(a.autoloaded) - Number(b.autoloaded);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [modules, sortKey, sortDir, filter]);

  const totalBytes = useMemo(
    () => filtered.reduce((s, m) => s + m.bytes, 0),
    [filtered],
  );

  const onSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir(key === "name" || key === "package" ? "asc" : "desc");
    }
  };

  return (
    <div>
      <div className="filters">
        <label>
          <span>Filter</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
          >
            <option value="all">All modules</option>
            <option value="autoloaded">Autoloaded only (/etc/modules)</option>
            <option value="ondemand">On-demand only (hotplug / manual)</option>
          </select>
        </label>
        <span className="filter-summary">
          {filtered.length} module{filtered.length === 1 ? "" : "s"} ·{" "}
          {fmtBytes(totalBytes)} total
        </span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th className="col-toggle" title="What-if: mark for disable">
              ×
            </th>
            <SortHeader k="name" current={sortKey} dir={sortDir} onClick={onSort}>
              Module
            </SortHeader>
            <SortHeader
              k="bytes"
              current={sortKey}
              dir={sortDir}
              onClick={onSort}
              className="num"
            >
              Size
            </SortHeader>
            <SortHeader
              k="package"
              current={sortKey}
              dir={sortDir}
              onClick={onSort}
            >
              Owning package
            </SortHeader>
            <SortHeader
              k="autoloaded"
              current={sortKey}
              dir={sortDir}
              onClick={onSort}
            >
              Autoloaded
            </SortHeader>
            <th>Path</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((m) => {
            const isSelected = selected.has(m.name);
            return (
              <tr
                key={m.name}
                className={isSelected ? "row-selected" : undefined}
              >
                <td className="col-toggle">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(m.name)}
                    title={`what-if: drop ${m.name}.ko`}
                  />
                </td>
                <td>{m.name}</td>
                <td className="num">{fmtBytes(m.bytes)}</td>
                <td>{m.package}</td>
                <td>{m.autoloaded ? "yes" : "—"}</td>
                <td className="path">
                  <code>{m.path}</code>
                </td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                no modules match this filter
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SortHeader({
  k,
  current,
  dir,
  onClick,
  className,
  children,
}: {
  k: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const isActive = k === current;
  const indicator = !isActive ? "" : dir === "asc" ? " ▲" : " ▼";
  return (
    <th className={`sortable ${className ?? ""}`} onClick={() => onClick(k)}>
      {children}
      {indicator}
    </th>
  );
}
