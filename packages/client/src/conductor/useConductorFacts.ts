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

/** The cell exactly as it arrived — `undefined` until kolu-server's first
 *  frame lands. This is the ONE subscription; every reading below derives
 *  from it, so the defaulted view and the "has the server answered yet" view
 *  can never be two frames that disagree. */
const useConductorCell = createSharedRoot(() => {
  // Bare `.use()`: the cell DECLARES its own `onError` policy (`hostToast`,
  // labelled `conductor`) on the spec, so the use-site carries none and
  // the one shared interpreter surfaces a failure.
  const { value } = app.cells.conductor.use();
  return value;
});

/** The live conversation state, mirrored once for the whole app.
 *
 *  `DEFAULT_CONDUCTOR_STATE` before the first frame lands — `phase:
 *  "offline"`, which is exactly what this end knows about a conversation it
 *  has not heard from yet. */
export const useConductorFacts = createSharedRoot<Accessor<ConductorState>>(
  () => {
    const cell = useConductorCell();
    return () => cell() ?? DEFAULT_CONDUCTOR_STATE;
  },
);

/** The open questions' ids — or `undefined` while the server has not
 *  reported yet. The one reader that must tell those apart is the bell: the
 *  default's empty list is not a reading, and taking it for one would make
 *  the real first frame look like questions that just arrived. */
export function conductorOpenAsks(): readonly string[] | undefined {
  return useConductorCell()()?.openAsks;
}

/** THE ONE COUNT OF WHAT IS WAITING ON YOU, derived once for every place that
 *  wears it — the desktop tab, the phone's Conductor entry and the OS badge.
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
    /** How many things are waiting on the human. The RECORDS alone: which id
     *  a work is filed under is not part of the count. */
    waiting: createMemo(() =>
      waitingCount(
        works().map(([, work]) => work),
        facts().openAsks,
      ),
    ),
  };
});
