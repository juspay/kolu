import { agoPhrase, compactPhrase } from "@kolu/terminal-vocab/duration";
import { DASH } from "@kolu/terminal-vocab/dash";

export type RecencyMode = "wait-chip" | "hidden" | "ago";

export function recencyMode(pip: {
  asking: boolean;
  active: boolean;
}): RecencyMode {
  if (pip.asking) return "wait-chip";
  return pip.active ? "hidden" : "ago";
}

export type RecencyAt = {
  /** The tile's window recency — newest activity across parent and splits. */
  window: number | null;
  /** THIS row's own agent recency — how long it has awaited you. */
  own: number | null;
};

export function displayRecencyAt(
  mode: RecencyMode,
  at: RecencyAt,
): number | null {
  return mode === "wait-chip" ? at.own : at.window;
}

export function agoText(at: number | null, now: number): string {
  return agoPhrase(at, now);
}

export function waitText(at: number | null, now: number): string {
  return at === null ? DASH : compactPhrase(now - at);
}

export type RowRecency =
  | { mode: "hidden" }
  | { mode: "ago"; text: string }
  | { mode: "wait-chip"; text: string };

export type RowClocks = {
  counting: () => number;
  glancing: () => number;
};

export function rowRecency(
  pip: { asking: boolean; active: boolean },
  at: RecencyAt,
  clocks: RowClocks,
): RowRecency {
  const mode = recencyMode(pip);
  if (mode === "hidden") return { mode };
  const shown = displayRecencyAt(mode, at);
  if (mode === "ago") return { mode, text: agoText(shown, clocks.glancing()) };
  const now = shown === null ? clocks.glancing() : clocks.counting();
  return { mode, text: waitText(shown, now) };
}
