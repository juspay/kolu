/** The ORCHESTRATOR mirror — ONE subscription to kolu-server's `orchestrator`
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
  DEFAULT_ORCHESTRATOR_STATE,
  type OrchestratorState,
} from "kolu-common/orchestrator";
import type { Accessor } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { app } from "../wire";

/** The live conversation state, mirrored once for the whole app.
 *
 *  `DEFAULT_ORCHESTRATOR_STATE` before the first frame lands — `phase:
 *  "offline"`, which is exactly what this end knows about a conversation it
 *  has not heard from yet. */
export const useOrchestratorFacts = createSharedRoot<
  Accessor<OrchestratorState>
>(() => {
  // Bare `.use()`: the cell DECLARES its own `onError` policy (`hostToast`,
  // labelled `orchestrator`) on the spec, so the use-site carries none and
  // the one shared interpreter surfaces a failure.
  const { value } = app.cells.orchestrator.use();
  return () => value() ?? DEFAULT_ORCHESTRATOR_STATE;
});

/** The conversation, as a plain read — for the readers that are not holding
 *  the accessor themselves (the chrome-bar entry's badge, the attention arm). */
export function orchestratorState(): OrchestratorState {
  return useOrchestratorFacts()();
}

/** Σ open asks — the violet needs-you count the chrome-bar entry wears and the
 *  app badge's orchestrator contribution. One conversation reaches every host,
 *  so this single number already IS the count across the fleet. */
export function orchestratorAsksTotal(): number {
  return orchestratorState().openAsks.length;
}
