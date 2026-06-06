import { type Source } from "./types";

export type ViewState = {
  source: Source;
  buildId: string | null;
  platform: string | null;
  /**
   * DriftView's comparison build. Null falls back to DriftView's default
   * (the newest other-build that has this platform). Stays absent from the
   * URL when null so fresh sessions don't carry stale `?compare=` baggage.
   */
  compareBuildId: string | null;
  /**
   * Whether the help overlay is open. Reflected to the URL as `?help=1`
   * so a bookmarked help page survives reload.
   */
  helpOpen: boolean;
};

export function readQueryString(search: string): ViewState {
  const p = new URLSearchParams(search);
  const source: Source = p.get("source") === "builder" ? "builder" : "firmware";
  return {
    source,
    buildId: p.get("build"),
    platform: p.get("plat"),
    compareBuildId: p.get("compare"),
    helpOpen: p.get("help") === "1",
  };
}

export function writeQueryString(state: ViewState): string {
  const p = new URLSearchParams();
  p.set("source", state.source);
  if (state.buildId) p.set("build", state.buildId);
  if (state.platform) p.set("plat", state.platform);
  if (state.compareBuildId) p.set("compare", state.compareBuildId);
  if (state.helpOpen) p.set("help", "1");
  return "?" + p.toString();
}
