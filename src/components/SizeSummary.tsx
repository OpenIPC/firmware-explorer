import type { Sizes } from "../lib/types";

type Props = { sizes: Sizes };

type BadgeLevel = "ok" | "warn" | "tight" | "over" | "unknown";

function badge(headroomKb: number | null, capKb: number): BadgeLevel {
  if (!capKb) return "unknown";
  if (headroomKb === null) return "unknown";
  if (headroomKb < 0) return "over";
  const pct = (headroomKb / capKb) * 100;
  if (pct < 2) return "tight";
  if (pct < 10) return "warn";
  return "ok";
}

const BADGE_TEXT: Record<BadgeLevel, string> = {
  ok: "OK",
  warn: "tight",
  tight: "very tight",
  over: "OVER CAP",
  unknown: "n/a",
};

function fmtKb(kb: number): string {
  return kb.toLocaleString("en-US") + " KB";
}

export function SizeSummary({ sizes }: Props) {
  const k = sizes.headroom.kernel;
  const r = sizes.headroom.rootfs;
  const kLevel = badge(k.headroom_kb, k.cap_kb);
  const rLevel = badge(r.headroom_kb, r.cap_kb);

  return (
    <div className="summary">
      <h2>
        {sizes.board}
        {sizes.variant ? ` · ${sizes.variant}` : ""}
        {sizes.flash_mb ? ` · ${sizes.flash_mb} MB flash` : ""}
        {sizes.kernel_version ? ` · linux ${sizes.kernel_version}` : ""}
      </h2>
      <div className="summary-grid">
        <SummaryCard
          title="Kernel (uImage)"
          used={k.used_kb}
          cap={k.cap_kb}
          headroom={k.headroom_kb}
          level={kLevel}
        />
        <SummaryCard
          title={`Rootfs (${sizes.rootfs.compression ?? "squashfs"})`}
          used={r.used_kb}
          cap={r.cap_kb}
          headroom={r.headroom_kb}
          level={rLevel}
        />
      </div>
      <p className="summary-meta">
        rootfs uncompressed {fmtKb(Math.round(sizes.rootfs.uncompressed_bytes / 1024))}{" "}
        ·{" "}
        compression ratio{" "}
        {sizes.rootfs.compression_ratio
          ? sizes.rootfs.compression_ratio.toFixed(3)
          : "n/a"}{" "}
        ·{" "}
        {sizes.packages.length} packages,{" "}
        {sizes.linux_components.modules.length} kernel modules,{" "}
        {sizes.linux_components.built_in.length} built-in modules
      </p>
    </div>
  );
}

function SummaryCard({
  title,
  used,
  cap,
  headroom,
  level,
}: {
  title: string;
  used: number;
  cap: number;
  headroom: number | null;
  level: BadgeLevel;
}) {
  const pct = cap ? Math.min(100, (used / cap) * 100) : 0;
  return (
    <div className={`summary-card summary-${level}`}>
      <div className="summary-card-title">{title}</div>
      <div className="summary-card-bytes">
        {fmtKb(used)} <span className="summary-cap">/ {fmtKb(cap)}</span>
      </div>
      <div className="summary-bar">
        <div className="summary-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="summary-card-foot">
        <span className={`badge badge-${level}`}>{BADGE_TEXT[level]}</span>
        <span className="summary-headroom">
          {headroom === null
            ? "headroom n/a"
            : headroom >= 0
              ? `${fmtKb(headroom)} headroom`
              : `${fmtKb(-headroom)} OVER`}
        </span>
      </div>
    </div>
  );
}
