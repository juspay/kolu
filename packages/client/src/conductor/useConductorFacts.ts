/** The CONDUCTOR mirror — ONE subscription to kolu-server's `conductor`
 *  cell, and the one place every surface reads it from.
 *
 *  There is one conversation now, hosted by kolu-server, and it covers every
 *  host — so this is a reading of the KOLU surface, never of a host's padi.
 *  The per-host mirror this replaced existed because the conversation used to
 *  live in each host's padi and the badge had to count questions on hosts
 *  nobody was looking at; with one conversation that fold is the cell's own
 *  `openAsks`, and a second subscription to the same member would only be a
 *  second frame to disagree with.
 *
 *  The cell is SMALL — phase, model, options, rosters, the open-ask ids — and
 *  carries none of the conversation: the transcript is its own stream, opened
 *  only by the panel that draws it. So the standing cost of keeping it open
 *  for the badge alone is a handful of values. */

import {
  DEFAULT_CONDUCTOR_STATE,
  type ConductorState,
} from "kolu-common/conductor";
import { type Accessor, createMemo } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { app } from "../wire";

/** The live conversation state, mirrored once for the whole app.
 *
 *  `DEFAULT_CONDUCTOR_STATE` before the first frame lands — `phase:
 *  "offline"`, which is exactly what this end knows about a conversation it
 *  has not heard from yet. */
export const useConductorFacts = createSharedRoot<Accessor<ConductorState>>(
  () => {
    // Bare `.use()`: the cell DECLARES its own `onError` policy (`hostToast`,
    // labelled `conductor`) on the spec, so the use-site carries none and
    // the one shared interpreter surfaces a failure.
    const { value } = app.cells.conductor.use();
    return () => value() ?? DEFAULT_CONDUCTOR_STATE;
  },
);

/** The conversation, as a plain read — for the readers that are not holding
 *  the accessor themselves (the chrome-bar entry's badge, the attention arm). */
export function conductorState(): ConductorState {
  return useConductorFacts()();
}

/** Σ open asks — the violet needs-you count the chrome-bar entry wears and the
 *  app badge's conductor contribution. One conversation reaches every host,
 *  so this single number already IS the count across the fleet. */
export function conductorAsksTotal(): number {
  return conductorState().openAsks.length;
}

/** THE TAB'S ONE BADGE, derived once for every place that wears it — the
 *  desktop tab and the phone's Conductor entry.
 *
 *  Two facts go in and ONE mark comes out. `pieces` is how many pieces of
 *  work are in flight: the watched terminals GROUPED by the top-level
 *  terminal their `child-of` edges end at, which kolu-server derives from the
 *  watch list's own readings and publishes as `work` — so a planner and the
 *  implementor split under it count once, and a host this browser has never
 *  opened still has its group (the browser cannot walk a parent edge on a
 *  machine it is not connected to; the server already reads every watched
 *  terminal's record on every host). `asking` is whether the conversation is
 *  blocked on an answer from you.
 *
 *  The count is what the badge SAYS and the ask is what COLOURS it. There is
 *  no second number: two counters on one tab is a sum every reader has to do
 *  before they know whether to look.
 *
 *  Both are memos over PRIMITIVES, so the tab wakes when one of those two
 *  moves and not when a row lands, a model changes or a terminal on some host
 *  ticks — a tab in the chrome bar must not re-render the strip because an
 *  unrelated terminal breathed. */
export const useConductorBadge = createSharedRoot(() => {
  const facts = useConductorFacts();
  return {
    /** The pieces of work in flight. */
    pieces: createMemo(() => facts().work.length),
    /** Whether the conversation is waiting on a human answer. */
    asking: createMemo(() => facts().openAsks.length > 0),
  };
});
