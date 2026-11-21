/** A WORK'S LIVE FACTS — its member terminals, each with its standing read once;
 *  the PR one of their records carries; that PR's checks counted; and where the
 *  work stands. One reading for every face a work has: its card, its line in
 *  the sidebar, and its chip.
 *
 *  Each face used to assemble these itself, and two faces of one work built
 *  them two ways; read here, a work's card, line and chip cannot say different
 *  things about the same work. */

import type { PrInfo } from "anyforge/schemas";
import { Option } from "effect";
import type { Work, WorkId } from "kolu-work";
import { type Accessor, createMemo } from "solid-js";
import {
  type FleetTerminalStanding,
  fleetTerminalStanding,
} from "../palette/fleetTerminals";
import { type MemberRef, splitMemberRef } from "./memberRef";
import { type ChecksTally, checksTally, livePrOf } from "./prReadings";
import { useWorkMembers } from "./useWorks";
import {
  membersIn,
  type StandingLine,
  standingLine,
  type WorkMemberRow,
} from "./workReadings";

/** One member as a face holds it: its row in the work, its ref split into the
 *  keys the fleet index is read by (`null` when this browser cannot read it),
 *  and its live standing, read once. */
export interface MemberLine extends WorkMemberRow {
  readonly split: MemberRef | null;
  readonly standing: FleetTerminalStanding | undefined;
}

export interface WorkFacts {
  /** The members, in the order a waterfall runs them — none once the work
   *  is over (the members map holds open works only). */
  readonly members: Accessor<ReadonlyArray<MemberLine>>;
  /** The work's PR as a member's record carries it right now. */
  readonly livePr: Accessor<PrInfo | null>;
  readonly checks: Accessor<Option.Option<ChecksTally>>;
  /** Where the work stands, with the live checks folded in. */
  readonly at: Accessor<StandingLine>;
}

/** Call from a component body: the readings live as long as the face. */
export function createWorkFacts(
  id: Accessor<WorkId>,
  work: Accessor<Work>,
): WorkFacts {
  const allMembers = useWorkMembers();
  // Each member's standing is read ONCE here: the agent's name, the clock and
  // whether there is anywhere to go all want it, and reading it per reader is
  // how one terminal came to be looked up three times a frame.
  const members = createMemo(
    (): ReadonlyArray<MemberLine> =>
      membersIn(allMembers(), id()).map((row) => {
        const split = splitMemberRef(row.terminal);
        const standing =
          split === null
            ? undefined
            : fleetTerminalStanding(split.host, split.id);
        return { ...row, split, standing };
      }),
  );
  const livePr = createMemo(() => livePrOf(members()));
  const checks = createMemo(() => checksTally(Option.fromNullishOr(livePr())));
  const at = createMemo(() => standingLine(work(), checks()));
  return { members, livePr, checks, at };
}
