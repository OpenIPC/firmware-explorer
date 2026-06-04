import type { Sizes } from "../lib/types";

type Props = {
  sizes: Sizes;
  selectedPackages: Set<string>;
  selectedModules: Set<string>;
  onClear: () => void;
};

function fmtKb(b: number): string {
  return (b / 1024).toFixed(1) + " KB";
}

export function WhatIfPanel({
  sizes,
  selectedPackages,
  selectedModules,
  onClear,
}: Props) {
  const pkgIndex = new Map(sizes.packages.map((p) => [p.name, p]));
  const modIndex = new Map(sizes.linux_components.modules.map((m) => [m.name, m]));

  let uncompressed = 0;
  let compressedApprox = 0;
  for (const name of selectedPackages) {
    const p = pkgIndex.get(name);
    if (!p) continue;
    uncompressed += p.uncompressed_bytes;
    compressedApprox += p.compressed_bytes_approx ?? 0;
  }
  for (const name of selectedModules) {
    const m = modIndex.get(name);
    if (!m) continue;
    uncompressed += m.bytes;
    if (sizes.rootfs.compression_ratio !== null) {
      compressedApprox += m.bytes * sizes.rootfs.compression_ratio;
    }
  }

  const headroomKb = sizes.headroom.rootfs.headroom_kb ?? 0;
  const wouldFitKb = Math.round(compressedApprox / 1024);
  const newHeadroom = headroomKb + wouldFitKb;
  const empty = selectedPackages.size + selectedModules.size === 0;

  return (
    <div className="what-if">
      <div className="what-if-head">
        <h3>What-if</h3>
        {!empty && (
          <button onClick={onClear} className="btn-secondary">
            clear ({selectedPackages.size + selectedModules.size})
          </button>
        )}
      </div>

      <p className="what-if-disclaimer">
        ⚠ <strong>Naive sum, no dependency resolution.</strong> Disabling a
        package may force its dependents off too (good), or be impossible
        because something else hard-requires it (this panel will lie). Real
        toggle gating arrives in v0.2 once firmware ships{" "}
        <code>kconfig-graph.json</code>.
      </p>

      {empty ? (
        <p className="muted">
          Tick boxes in the package or module table, or click cells in the
          treemap, to estimate the rootfs savings.
        </p>
      ) : (
        <dl className="what-if-stats">
          <dt>Selected (naive sum)</dt>
          <dd>
            {fmtKb(uncompressed)} uncompressed,{" "}
            {fmtKb(compressedApprox)} compressed-approx
          </dd>
          <dt>Current rootfs headroom</dt>
          <dd>{headroomKb} KB</dd>
          <dt>New headroom if disabled</dt>
          <dd className={newHeadroom > 0 ? "positive" : "negative"}>
            ≈ {newHeadroom} KB
          </dd>
        </dl>
      )}
    </div>
  );
}
