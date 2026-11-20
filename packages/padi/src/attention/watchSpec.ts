import type { PadiWatchStatesInput } from "@kolu/padi-client/surface";
import {
  WATCH_DEFAULT_STATES,
  WATCH_FILTER_KEYS,
} from "@kolu/padi-client/surface";
import type { WaitState } from "@kolu/padi-client/terminalVocab";
import type { Parsed } from "@kolu/padi-client/watchDuration";
import { type WatchScope, watchScopeOf } from "@kolu/padi-client/watchScope";
import type { StateWatchFilter, StateWatchSpec } from "./stateWatch.ts";

interface WatchKnobs {
  readonly states?: readonly WaitState[];
  readonly heldForMs?: number;
  readonly nagMs?: number;
  readonly nagCount?: number;
}

/** The refusal a `nagCount` without `nagMs` is answered with: a cap names how
 *  many times a REPETITION fires, so without the interval there is nothing to
 *  cap. */
export const WATCH_NAG_COUNT_ORPHAN =
  "nagCount caps the nagging, but no nagMs was given: there is no repetition to cap.";

function filterFrom(knobs: WatchKnobs): Parsed<StateWatchFilter> {
  if (knobs.nagCount !== undefined && knobs.nagMs === undefined) {
    return { kind: "error", message: WATCH_NAG_COUNT_ORPHAN };
  }
  return {
    kind: "ok",
    value: {
      states: new Set(knobs.states ?? WATCH_DEFAULT_STATES),
      heldForMs: knobs.heldForMs ?? 0,
      ...(knobs.nagMs === undefined ? {} : { nagMs: knobs.nagMs }),
      ...(knobs.nagCount === undefined ? {} : { nagCount: knobs.nagCount }),
    },
  };
}

/** Did the caller name any supervision knob? The one definition of "this is an
 *  agent-state watch", asked over {@link WATCH_FILTER_KEYS}. */
export function namesWatchKnobs(knobs: WatchKnobs): boolean {
  return WATCH_FILTER_KEYS.some((key) => knobs[key] !== undefined);
}

/** The filter a standing subscription was opened with, `undefined` when the
 *  caller named no knob (a plain settle-detector watch), or the refusal. */
export function watchFilterOf(
  knobs: WatchKnobs,
): Parsed<StateWatchFilter | undefined> {
  return namesWatchKnobs(knobs)
    ? filterFrom(knobs)
    : { kind: "ok", value: undefined };
}

/** A filter plus the {@link WatchScope} it is applied at. PURE: everything that
 *  can be refused was refused when the filter and the scope were decoded. */
export function specOf(
  filter: StateWatchFilter,
  scope: WatchScope,
): StateWatchSpec {
  return { ...filter, scope };
}

/** The full spec behind one `watchStates` subscription, or the refusal that
 *  says the scope it asked for can never match. Opening the stream IS the ask,
 *  so the defaults always apply. */
export function watchSpecOf(
  input: PadiWatchStatesInput,
): Parsed<StateWatchSpec> {
  const scope = watchScopeOf({
    ...(input.id === undefined ? {} : { ids: [input.id] }),
    ...(input.ignoreIds === undefined ? {} : { mute: input.ignoreIds }),
  });
  if (scope.kind === "error") return scope;
  const filter = filterFrom(input);
  if (filter.kind === "error") return filter;
  return { kind: "ok", value: specOf(filter.value, scope.value) };
}
