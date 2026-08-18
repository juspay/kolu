/**
 * The wire's three supervision knobs, decoded into what the engine compares
 * against — ONCE, for both faces.
 *
 * `kolu watch --states/--held-for/--nag` and an MCP `watch.open` that names the
 * same three are the same subscription; the only thing that differs is which
 * schema carried them. So the defaults live here rather than at each face: a
 * caller that named no states means {@link WATCH_DEFAULT_STATES} on BOTH faces,
 * and there is no second place for one of them to drift.
 *
 * It also owns the one decision that reads as a mode but is not one: whether a
 * caller asked for the agent-state watch at all. The answer is the PRESENCE of
 * any knob — no flag, nothing to contradict the knobs, and nothing to forget to
 * set when a fourth knob is added.
 */

import type { WaitState } from "../terminalVocab.ts";
import { WATCH_DEFAULT_STATES, WATCH_FILTER_KEYS } from "../surface.ts";
import type { PadiWatchStatesInput } from "../surface.ts";
import type { StateWatchFilter, StateWatchSpec } from "./stateWatch.ts";

/** The three knobs as either face's schema decodes them. Structural, so both
 *  wire inputs satisfy it without an adapter object per call — and unexported,
 *  because that structural fit is exactly why no caller ever needs to name it. */
interface WatchKnobs {
  readonly states?: readonly WaitState[];
  readonly heldForMs?: number;
  readonly nagMs?: number;
}

/** Decode the knobs, defaults applied. */
function filterFrom(knobs: WatchKnobs): StateWatchFilter {
  return {
    states: new Set(knobs.states ?? WATCH_DEFAULT_STATES),
    // A hold of zero is "report it the instant it enters", which is what a
    // caller who named only `--nag` asked for.
    heldForMs: knobs.heldForMs ?? 0,
    // Absent means report ONCE. Spread-or-omit rather than an explicit
    // `undefined`, so "nag not" is spelled by the key being missing everywhere
    // it travels.
    ...(knobs.nagMs === undefined ? {} : { nagMs: knobs.nagMs }),
  };
}

/** Did the caller name any supervision knob? The ONE definition of "this is an
 *  agent-state watch", asked by both faces and by the daemon rather than each
 *  re-listing the knobs — and asked over {@link WATCH_FILTER_KEYS}, which is the
 *  wire declaration itself, so a fourth knob is admitted here the moment it is
 *  declared instead of quietly failing to count. */
export function namesWatchKnobs(knobs: WatchKnobs): boolean {
  return WATCH_FILTER_KEYS.some((key) => knobs[key] !== undefined);
}

/** The filter a standing subscription was opened with, or `undefined` when the
 *  caller named none of the three — which is what keeps a plain `watch.open` on
 *  the settle detector it has always used. */
export function watchFilterOf(knobs: WatchKnobs): StateWatchFilter | undefined {
  return namesWatchKnobs(knobs) ? filterFrom(knobs) : undefined;
}

/** The full spec behind one `watchStates` subscription. Unlike a standing
 *  subscription there is nothing to choose here: opening the stream at all IS
 *  the ask, so the defaults always apply. */
export function watchSpecOf(input: PadiWatchStatesInput): StateWatchSpec {
  return {
    ...filterFrom(input),
    ...(input.id === undefined ? {} : { ids: new Set([input.id]) }),
  };
}
