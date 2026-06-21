/**
 * The truecolour palette for arivu-tui's OpenTUI views. The one place a semantic
 * `tone` (decided in the pure `render.ts`) becomes a concrete colour — shared by
 * the single-host table (`tui.tsx`) and the fleet board (`fleet.tsx`) so a
 * tone's hex is spelled exactly once. No JSX here, so it imports cleanly into
 * both the Bun views and any Node test.
 */

import type { FieldTone } from "./render.ts";

/** Tone → colour. Awaiting (blocked-on-you) amber and working cyan are the two
 *  the eye should catch; everything else stays calm. */
export const TONE_COLOR: Record<FieldTone, string> = {
  working: "#56b6c2",
  awaiting: "#e6a23c",
  idle: "#5b6678",
  pass: "#7ec699",
  fail: "#e06c75",
  pending: "#c8a24c",
  muted: "#5b6678",
  plain: "#c8d0de",
};

// Chrome colours — title bar, column/section headers, the fleet's per-host group
// bar. Not per-cell tones, so they live outside TONE_COLOR; nothing here
// re-spells a tone's hex.
export const TITLE = "#7c8696";
export const HEADER = "#8b94a6";
export const SUBTLE = "#8b94a6";
/** Violet — the fleet's per-host group bar (matches the plan's prototype). */
export const HOST = "#a78bfa";
