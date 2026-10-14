/** The parts of a log-tail block that are genuinely shared by every place an app
 *  shows raw host output: the surface it sits on, the class its lines wear, the
 *  structural shape of a line, and the one empty tail. Sizing, padding and
 *  overflow stay at the call site — those are real differences between a canvas
 *  overlay, a card and a popover — while everything a tail must never disagree
 *  about is named here, once, beside the component that wears it (`./LogTail`).
 *
 *  A consumer's own vocabulary does NOT live here: an app that has a reason to
 *  distinguish "no output" from "output we cannot see" keeps that reason in its
 *  own terms (kolu's `LogAbsence` is exactly that, in `packages/client`). */

/** One line of retained output, structurally. Deliberately NOT a domain type: a
 *  component that renders a tail carries no knowledge of where the line came
 *  from, and a caller hands it whatever tail it kept — its own records, a wire
 *  payload, a plain string list. Named once here, beside the chrome the lines
 *  wear, rather than re-spelled longhand at each of the places that pass or take
 *  a tail. */
export type LogLine = { readonly line: string };

/** The ONE empty tail a consumer reaches for — a shared reference so a site with
 *  no output to narrate hands its renderer the SAME array across every
 *  re-resolve/repaint instead of a fresh `[]` literal (which would churn
 *  identity-keyed DOM on every tick even though nothing changed). */
export const NO_LOG_LINES: readonly LogLine[] = [];

/** The surface a raw-output block sits on: hairline border, recessed tint,
 *  monospace, muted ink. Every log tail wears exactly this; nothing else does.
 *  The colour tokens come from the consumer's theme (`@kolu/theme` in kolu), so
 *  this is a class string, never a palette. */
export const LOG_TAIL_SURFACE =
  "rounded border border-bd-1/50 bg-bg-2/40 font-mono text-fg-4";

/** One line of a log tail — EVERY tail. A long line folds instead of being
 *  clipped at the block's edge: a tail is the window onto output a person reads
 *  to tell an in-flight step from a hung one, and a clipped line hides exactly
 *  the token that would say which. `LogTail` wears this one string everywhere,
 *  so a tail reads the same wherever it appears. */
export const LOG_TAIL_LINE = "whitespace-pre-wrap break-words";
