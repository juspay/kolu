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
import { useWorks } from "./useWorks";
import { waitingCount } from "./workReadings";

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
 *  ONE NUMBER, and it is HOW MANY THINGS ARE WAITING ON YOU: every piece of
 *  work whose standing is "waiting on you" (one per work however many
 *  questions it holds — the card is the one place to answer them), plus every
 *  open ask that is about NO work, which is the conversation's own question
 *  and has no card to carry it. That is the number a person acts on; the count
 *  of work in flight is a readout and lives on the status line, where there is
 *  room to say what it counts.
 *
 *  VIOLET, always — a badge that only ever says "it is your turn" has one
 *  colour. ABSENT at zero, never a `0`: a badge that renders its own silence
 *  is one every reader has to parse before ignoring it.
 *
 *  A memo over two primitives, so the tab wakes when that number moves and not
 *  when a row lands, a model changes or a terminal on some host ticks — a tab
 *  in the chrome bar must not re-render the strip because an unrelated
 *  terminal breathed. */
export const useConductorBadge = createSharedRoot(() => {
  const facts = useConductorFacts();
  const works = useWorks();
  return {
    /** How many things are waiting on the human. */
    waiting: createMemo(() => waitingCount(works().works, facts().openAsks)),
  };
});
