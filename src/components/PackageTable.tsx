import { Fragment, useMemo, useState } from "react";
import type { SizesPackage } from "../lib/types";
import { categorise, CATEGORY_COLOUR, CATEGORY_LABEL } from "../lib/categorise";
import { fmtBytesOrNull as fmtBytes } from "../lib/format";

type SortKey = "name" | "uncompressed" | "compressed" | "files";
type SortDir = "asc" | "desc";

type Props = {
  packages: SizesPackage[];
};

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
                    <TopFilesBreakdown
                      topFiles={p.top_files}
                      totalFiles={p.file_count}
                      totalBytes={p.uncompressed_bytes}
                    />
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

function TopFilesBreakdown({
  topFiles,
  totalFiles,
  totalBytes,
}: {
  topFiles: ReadonlyArray<{ path: string; bytes: number }>;
  totalFiles: number;
  totalBytes: number;
}) {
  if (topFiles.length === 0) {
    return (
      <p className="muted">
        no per-file breakdown ({totalFiles.toLocaleString("en-US")}{" "}
        file{totalFiles === 1 ? "" : "s"} total)
      </p>
    );
  }

  const shownBytes = topFiles.reduce((s, f) => s + f.bytes, 0);
  const remainingFiles = Math.max(0, totalFiles - topFiles.length);
  const remainingBytes = Math.max(0, totalBytes - shownBytes);

  return (
    <div>
      <p className="files-caption muted">
        Top <strong>{topFiles.length}</strong> of{" "}
        <strong>{totalFiles.toLocaleString("en-US")}</strong> file
        {totalFiles === 1 ? "" : "s"}
        {remainingFiles > 0 ? (
          <>
            {" "}— remaining {remainingFiles.toLocaleString("en-US")} file
            {remainingFiles === 1 ? "" : "s"} ({fmtBytes(remainingBytes)} total)
            aren't itemised in <code>sizes.json</code>
          </>
        ) : (
          <> — full list</>
        )}
        .
      </p>
      <ul>
        {topFiles.map((f) => (
          <li key={f.path}>
            <code>{f.path}</code>{" "}
            <span className="muted">{fmtBytes(f.bytes)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
