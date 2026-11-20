import {
  DEFAULT_CONDUCTOR_STATE,
  type ConductorState,
} from "kolu-common/conductor";
import { type Accessor, createMemo } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { app } from "../wire";
import { useNeedsYou } from "./useWorks";
import { waitingCount } from "./workReadings";

const useConductorCell = createSharedRoot(() => {
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

export function conductorAsks():
  | {
      readonly ownAsks: readonly string[];
      readonly workAsks: readonly string[];
    }
  | undefined {
  const cell = useConductorCell()();
  return cell === undefined
    ? undefined
    : { ownAsks: cell.openAsks, workAsks: cell.workAsks };
}

export const useConductorBadge = createSharedRoot(() => {
  const facts = useConductorFacts();
  const needs = useNeedsYou();
  return {
    /** How many things are waiting on the human. */
    waiting: createMemo(() => waitingCount(needs(), facts().openAsks)),
  };
});
