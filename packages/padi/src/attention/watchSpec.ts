/**
 * The wire's supervision knobs, decoded into what the engine compares against —
 * ONCE, for both faces.
 *
 * `kolu watch --states/--held-for/--nag/--nag-count` and an MCP `watch.open`
 * that names the same knobs are the same subscription; the only thing that
 * differs is which schema carried them. So the defaults live here rather than
 * at each face: a caller that named no states means {@link WATCH_DEFAULT_STATES}
 * on BOTH faces, and there is no second place for one of them to drift.
 *
 * It also owns the one decision that reads as a mode but is not one: whether a
 * caller asked for the agent-state watch at all. The answer is the PRESENCE of
 * any knob — no flag, nothing to contradict the knobs, and nothing to forget to
 * set when another knob is added.
 */

import type { PadiWatchStatesInput } from "@kolu/padi-client/surface";
import {
  WATCH_DEFAULT_STATES,
  WATCH_FILTER_KEYS,
} from "@kolu/padi-client/surface";
import type { WaitState } from "@kolu/padi-client/terminalVocab";
import { type WatchScope, watchScopeOf } from "@kolu/padi-client/watchScope";
import type { StateWatchFilter, StateWatchSpec } from "./stateWatch.ts";

/** The knobs as either face's schema decodes them. Structural, so both wire
 *  inputs satisfy it without an adapter object per call — and unexported,
 *  because that structural fit is exactly why no caller ever needs to name it. */
interface WatchKnobs {
  readonly states?: readonly WaitState[];
  readonly heldForMs?: number;
  readonly nagMs?: number;
  readonly nagCount?: number;
}

/** Decode the knobs, defaults applied. */
function filterFrom(knobs: WatchKnobs): StateWatchFilter {
  return {
    states: new Set(knobs.states ?? WATCH_DEFAULT_STATES),
    // A hold of zero is "report it the instant it enters", which is what a
    // caller who named only `--nag` asked for.
    heldForMs: knobs.heldForMs ?? 0,
    // Absent means report ONCE. Spread-or-omit rather than an explicit
    // `undefined`, so "nag not" — and "cap not" — is spelled by the key being
    // missing everywhere it travels.
    ...(knobs.nagMs === undefined ? {} : { nagMs: knobs.nagMs }),
    ...(knobs.nagCount === undefined ? {} : { nagCount: knobs.nagCount }),
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

/** A filter plus the {@link WatchScope} it is applied at — the ONE place a
 *  filter becomes a spec, so a standing subscription and the live stream cannot
 *  disagree about what an unscoped watch means. PURE: the never-match refusal
 *  lives in {@link watchScopeOf}, the only thing that can make the scope this
 *  takes, so there is nothing left here to reject. */
export function specOf(
  filter: StateWatchFilter,
  scope: WatchScope,
): StateWatchSpec {
  return { ...filter, scope };
}

/** The full spec behind one `watchStates` subscription, or the refusal that says
 *  the scope it asked for can never match. Unlike a standing subscription there
 *  is nothing to CHOOSE here: opening the stream at all IS the ask, so the
 *  defaults always apply. */
export function watchSpecOf(
  input: PadiWatchStatesInput,
):
  | { readonly kind: "ok"; readonly value: StateWatchSpec }
  | { readonly kind: "error"; readonly message: string } {
  const scope = watchScopeOf({
    ...(input.id === undefined ? {} : { ids: [input.id] }),
    ...(input.ignoreIds === undefined ? {} : { mute: input.ignoreIds }),
  });
  if (scope.kind === "error") return scope;
  return { kind: "ok", value: specOf(filterFrom(input), scope.value) };
}
