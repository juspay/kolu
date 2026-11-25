/** A WORK'S LIVE FACTS — its member terminals, each with its standing read
 *  once; the work's own PR (`./workPr.ts`) and its checks counted; and where
 *  the work stands. Read for every face that draws a work's terminals: its
 *  card, its line in the sidebar, and a chip's hover card while it is open.
 *
 *  The PR is the WORK'S, looked up by its id: no member is asked for it. A
 *  member may stand on another branch, and what its record carries is that
 *  branch's.
 *
 *  The members map is one value for the whole fleet, so it is split by work
 *  once, for the whole app (`useMembersByWork`): a membership change anywhere
 *  moves only the work it is in. Each face then reads its own work's slice. A
 *  work has at most a few such faces at once, so the reading is a plain one
 *  per face, not a shared one with a count of who holds it.
 *
 *  Where the work stands (`at`) is folded from the face's own record: it is a
 *  pure fold over that record, and a face may hold a work's last record for a
 *  moment while the mirror is without it (the picked work). */

import { activeArm } from "@kolu/padi-client/surface";
import { Option } from "effect";
import type { Work, WorkId } from "kolu-work";
import { type Accessor, createMemo } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import {
  type FleetTerminalStanding,
  fleetTerminalStanding,
} from "../palette/fleetTerminals";
import { agentName } from "../ui/agentDisplay";
import { type MemberRef, splitMemberRef } from "./memberRef";
import { type ChecksTally, checksTally } from "./prReadings";
import { useWorkMembers } from "./useWorks";
import { useWorkPr, type WorkPr } from "./workPr";
import {
  membersByWork,
  roleRuns,
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

/** WHAT A MEMBER RUNS, as its row and the chip's hover card say it: the
 *  harness the setup chose for its role, else the agent kolu sees in it; the
 *  model its session reports, else the setup's. `""` when nothing is known. */
export function memberRuns(work: Work, one: MemberLine): string {
  const agent =
    one.standing?.kind === "here"
      ? activeArm(one.standing.meta)?.agent
      : undefined;
  return Option.getOrElse(
    roleRuns(work, one.member.role, {
      agent: agent == null ? undefined : agentName(agent.kind),
      // The session's own word, as the Dock's row reads it: `null` until the
      // session names one.
      model: agent?.model ?? undefined,
    }),
    () => "",
  );
}

export interface WorkFacts {
  /** The members, in the order a waterfall runs them — none once the work
   *  is over. */
  readonly members: Accessor<ReadonlyArray<MemberLine>>;
  /** The work's own PR, as its branch's watch read it right now. */
  readonly pr: Accessor<Option.Option<WorkPr>>;
  readonly checks: Accessor<Option.Option<ChecksTally>>;
  /** Where the work stands, with the live checks folded in. */
  readonly at: Accessor<StandingLine>;
}

const NONE: ReadonlyArray<WorkMemberRow> = [];

/** THE MEMBERS MAP, SPLIT BY WORK — once for the whole app. */
const useMembersByWork = createSharedRoot(() => {
  const all = useWorkMembers();
  return createMemo(() => membersByWork(all()));
});

/** One work's reading of its members, and nothing else: no fact about the
 *  work is read off a member. */
export type MemberFacts = Pick<WorkFacts, "members">;

/** ONE WORK'S READING OF ITS MEMBERS, from their rows.
 *
 *  Each member's standing is read ONCE here: the agent's name, the clock and
 *  whether there is anywhere to go all want it.
 *
 *  A LINE THAT DID NOT MOVE KEEPS ITS OBJECT, and a list in which none did is
 *  the list it was — so a change to another work's membership, or to another
 *  terminal's record, rebuilds nothing drawn from these lines. A member keeps
 *  its object until its own frame arrives (the members map is one
 *  subscription per terminal), and a terminal's record until it moves, so
 *  identity is the test. */
export function readWorkFacts(
  rows: Accessor<ReadonlyArray<WorkMemberRow>>,
): MemberFacts {
  const members = createMemo(
    (prev: ReadonlyArray<MemberLine>): ReadonlyArray<MemberLine> => {
      const next = rows().map((row): MemberLine => {
        const split = splitMemberRef(row.terminal);
        const standing =
          split === null
            ? undefined
            : fleetTerminalStanding(split.host, split.id);
        const was = prev.find((one) => one.terminal === row.terminal);
        return was !== undefined &&
          was.member === row.member &&
          sameStanding(was.standing, standing)
          ? was
          : { ...row, split, standing };
      });
      return next.length === prev.length &&
        next.every((one, i) => one === prev[i])
        ? prev
        : next;
    },
    [],
  );
  return { members };
}

/** A face's reading of its work. Call from a component body: it lives as long
 *  as the face, and follows the face's id.
 *
 *  A work that is not open has no members here, whatever the members map
 *  says in the frame where the two collections disagree. */
export function createWorkFacts(
  id: Accessor<WorkId>,
  work: Accessor<Work>,
): WorkFacts {
  const byWork = useMembersByWork();
  const { members } = readWorkFacts(() =>
    work().state.kind === "open" ? (byWork().get(id()) ?? NONE) : NONE,
  );
  const pr = useWorkPr(id, work);
  const checks = createMemo(() => checksTally(pr()));
  const at = createMemo(() => standingLine(work(), checks()));
  return { members, pr, checks, at };
}

/** The same standing: the same answer, and for a terminal that is here, the
 *  same record — the fleet index hands a record over unchanged until it
 *  moves. */
function sameStanding(
  a: FleetTerminalStanding | undefined,
  b: FleetTerminalStanding | undefined,
): boolean {
  if (a === b) return true;
  if (a?.kind === "here" && b?.kind === "here") return a.meta === b.meta;
  return a?.kind === b?.kind && a?.kind !== "here";
}
