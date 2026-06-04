import { Fragment, useMemo, useState } from "react";
import type { SizesPackage } from "../lib/types";
import { categorise, CATEGORY_COLOUR, CATEGORY_LABEL } from "../lib/categorise";

type SortKey = "name" | "uncompressed" | "compressed" | "files";
type SortDir = "asc" | "desc";

type Props = {
  packages: SizesPackage[];
};

function fmtBytes(b: number | null): string {
  if (b === null) return "n/a";
  if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(2) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(1) + " KB";
  return b + " B";
}

export function PackageTable({ packages }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("uncompressed");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    const arr = [...packages];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "uncompressed":
          cmp = a.uncompressed_bytes - b.uncompressed_bytes;
          break;
        case "compressed":
          cmp =
            (a.compressed_bytes_approx ?? 0) -
            (b.compressed_bytes_approx ?? 0);
          break;
        case "files":
          cmp = a.file_count - b.file_count;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [packages, sortKey, sortDir]);

  const total = useMemo(
    () => packages.reduce((s, p) => s + p.uncompressed_bytes, 0),
    [packages],
  );

  const onSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th className="col-cat"></th>
          <SortHeader k="name" current={sortKey} dir={sortDir} onClick={onSort}>
            Package
          </SortHeader>
          <SortHeader
            k="uncompressed"
            current={sortKey}
            dir={sortDir}
            onClick={onSort}
            className="num"
          >
            Uncompressed
          </SortHeader>
          <SortHeader
            k="compressed"
            current={sortKey}
            dir={sortDir}
            onClick={onSort}
            className="num"
          >
            Compressed*
          </SortHeader>
          <SortHeader
            k="files"
            current={sortKey}
            dir={sortDir}
            onClick={onSort}
            className="num"
          >
            Files
          </SortHeader>
          <th className="col-share num">Share</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => {
          const cat = categorise(p.name);
          const isExpanded = expanded.has(p.name);
          const share = total ? (p.uncompressed_bytes / total) * 100 : 0;
          return (
            <Fragment key={p.name}>
              <tr>
                <td className="col-cat">
                  <span
                    className="cat-swatch"
                    style={{ background: CATEGORY_COLOUR[cat] }}
                    title={CATEGORY_LABEL[cat]}
                  />
                </td>
                <td>
                  <button
                    className="row-expand"
                    onClick={() => toggleExpand(p.name)}
                    title={isExpanded ? "collapse" : "show top files"}
                  >
                    {isExpanded ? "▾" : "▸"} {p.name}
                  </button>
                </td>
                <td className="num">{fmtBytes(p.uncompressed_bytes)}</td>
                <td className="num">{fmtBytes(p.compressed_bytes_approx)}</td>
                <td className="num">{p.file_count.toLocaleString("en-US")}</td>
                <td className="num">{share.toFixed(1)}%</td>
              </tr>
              {isExpanded && (
                <tr className="row-files">
                  <td colSpan={6}>
                    <ul>
                      {p.top_files.length === 0 ? (
                        <li className="muted">no per-file breakdown</li>
                      ) : (
                        p.top_files.map((f) => (
                          <li key={f.path}>
                            <code>{f.path}</code>{" "}
                            <span className="muted">{fmtBytes(f.bytes)}</span>
                          </li>
                        ))
                      )}
                    </ul>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
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
