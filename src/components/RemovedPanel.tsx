import { useMemo } from "react";
import type { SizesRemoved } from "../lib/types";

function fmtBytes(b: number): string {
  if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(2) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(1) + " KB";
  return b + " B";
}

export function RemovedPanel({ removed }: { removed: SizesRemoved[] }) {
  const sorted = useMemo(() => {
    return [...removed].sort((a, b) => b.source_bytes - a.source_bytes);
  }, [removed]);

  const total = sorted.reduce((s, r) => s + r.source_bytes, 0);
  const byPkg = new Map<string, number>();
  for (const r of sorted) byPkg.set(r.package, (byPkg.get(r.package) ?? 0) + r.source_bytes);

  return (
    <div className="removed">
      <p className="muted">
        Files claimed by a package in <code>packages-file-list.txt</code> but
        absent from the final rootfs. These are removals performed by
        OpenIPC-specific finalize hooks (
        <code>HISILICON_OPENSDK_TRIM_SP2308</code>,{" "}
        <code>SKIP_UNUSED_EV200</code>, the <code>libstdc++</code> strip in{" "}
        <code>rootfs_script.sh</code>, per-board excludes lists). Buildroot's
        default finalize strip (<code>.a</code>, <code>.la</code>, headers,
        man / doc / locale) is filtered out at JSON-emission time.
      </p>
      <p>
        <strong>{sorted.length}</strong> entries ·{" "}
        <strong>{fmtBytes(total)}</strong> total reclaimed by hooks
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Path</th>
            <th>Source package</th>
            <th className="num">Bytes</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.path}>
              <td className="path">
                <code>{r.path}</code>
              </td>
              <td>{r.package}</td>
              <td className="num">{fmtBytes(r.source_bytes)}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={3} className="muted">
                no removals on this build — every PFL entry is on disk
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
