/**
 * The wire's supervision knobs, decoded into what the engine compares against —
 * ONCE, for both faces.
 *
 * `kolu watch --states/--held-for/--nag` and an MCP `watch.open` that names the
 * same knobs are the same subscription; the only thing that differs is which
 * schema carried them — and how the CAP is spelled: the faces ride it inside
 * the interval (`--nag 30m/3`), the wire carries it as the `nagCount` field.
 * So the defaults live here rather than at each face: a caller that named no
 * states means {@link WATCH_DEFAULT_STATES} on BOTH faces, and there is no
 * second place for one of them to drift.
 *
 * It also owns the one decision that reads as a mode but is not one: whether a
 * caller asked for the agent-state watch at all. The answer is the PRESENCE of
 * any knob — no flag, nothing to contradict the knobs, and nothing to forget to
 * set when another knob is added. And it owns the ONE knob-pairing refusal the
 * faces cannot express: `nagCount` without `nagMs`. The faces make the orphan
 * unparseable (a count lives only after the slash); a direct caller of the
 * wire meets it HERE, the way the never-match scope is met in
 * {@link watchScopeOf} — as a VALUE, so each entrance throws it in its own
 * grammar.
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

/** The one refusal the decode owns, stated once: a cap names how many times a
 *  REPETITION fires, so without the interval there is no repetition to cap.
 *  The faces never type it (the count only parses after a slash on the
 *  interval); this is for whoever reaches the wire directly. */
export const WATCH_NAG_COUNT_ORPHAN =
  "nagCount caps the nagging, but no nagMs was given: there is no repetition to cap.";

/** Decode the knobs, defaults applied, or the pair that is refused. */
function filterFrom(
  knobs: WatchKnobs,
):
  | { readonly kind: "ok"; readonly value: StateWatchFilter }
  | { readonly kind: "error"; readonly message: string } {
  if (knobs.nagCount !== undefined && knobs.nagMs === undefined) {
    return { kind: "error", message: WATCH_NAG_COUNT_ORPHAN };
  }
  return {
    kind: "ok",
    value: {
      states: new Set(knobs.states ?? WATCH_DEFAULT_STATES),
      // A hold of zero is "report it the instant it enters", which is what a
      // caller who named only `--nag` asked for.
      heldForMs: knobs.heldForMs ?? 0,
      // Absent means report ONCE. Spread-or-omit rather than an explicit
      // `undefined`, so "nag not" — and "cap not" — is spelled by the key being
      // missing everywhere it travels.
      ...(knobs.nagMs === undefined ? {} : { nagMs: knobs.nagMs }),
      ...(knobs.nagCount === undefined ? {} : { nagCount: knobs.nagCount }),
    },
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
 *  caller named no knob — which is what keeps a plain `watch.open` on the
 *  settle detector it has always used — or the refusal of the pair the faces
 *  cannot spell. */
export function watchFilterOf(
  knobs: WatchKnobs,
):
  | { readonly kind: "ok"; readonly value: StateWatchFilter | undefined }
  | { readonly kind: "error"; readonly message: string } {
  return namesWatchKnobs(knobs)
    ? filterFrom(knobs)
    : { kind: "ok", value: undefined };
}

/** A filter plus the {@link WatchScope} it is applied at — the ONE place a
 *  filter becomes a spec, so a standing subscription and the live stream cannot
 *  disagree about what an unscoped watch means. PURE: it has already refused
 *  everything it can refuse ({@link filterFrom}, {@link watchScopeOf}), and a
 *  filter made any other way is the caller's own business. */
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
  const filter = filterFrom(input);
  if (filter.kind === "error") return filter;
  return { kind: "ok", value: specOf(filter.value, scope.value) };
}
