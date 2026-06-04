import { type Source } from "./types";

export type ViewState = {
  source: Source;
  buildId: string | null;
  platform: string | null;
};

export function readQueryString(search: string): ViewState {
  const p = new URLSearchParams(search);
  const source: Source = p.get("source") === "builder" ? "builder" : "firmware";
  return {
    source,
    buildId: p.get("build"),
    platform: p.get("plat"),
  };
}

export function writeQueryString(state: ViewState): string {
  const p = new URLSearchParams();
  p.set("source", state.source);
  if (state.buildId) p.set("build", state.buildId);
  if (state.platform) p.set("plat", state.platform);
  return "?" + p.toString();
}
