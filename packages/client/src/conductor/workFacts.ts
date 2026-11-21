/** A WORK'S LIVE FACTS — its member terminals, each with its standing read once;
 *  the PR one of their records carries; that PR's checks counted; and where the
 *  work stands. One reading for every face a work has: its card, its line in
 *  the sidebar, and its chip.
 *
 *  Each face used to assemble these itself, and two faces of one work built
 *  them two ways; read here, a work's card, line and chip cannot say different
 *  things about the same work. */

import { activeArm } from "@kolu/padi-client/surface";
import type { PrInfo } from "anyforge/schemas";
import { Option } from "effect";
import type { Work, WorkId, WorkMember } from "kolu-work";
import { type Accessor, createMemo } from "solid-js";
import {
  type FleetTerminalStanding,
  fleetTerminalStanding,
} from "../palette/fleetTerminals";
import { agentName } from "../ui/agentDisplay";
import { type MemberRef, splitMemberRef } from "./memberRef";
import { type ChecksTally, checksTally, livePrOf } from "./prReadings";
import { useWorkMembers } from "./useWorks";
import {
  membersIn,
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
  //
  // A LINE THAT DID NOT MOVE KEEPS ITS OBJECT, and a list in which none did
  // is the list it was. The members map is one value for the whole fleet, so
  // every face re-reads it when any work's membership moves — and a chat holds
  // a chip per turn. Without this, each of those re-reads minted new lines,
  // and every chip on screen rebuilt its terminals' marks for a change in
  // some other work.
  const members = createMemo(
    (prev: ReadonlyArray<MemberLine>): ReadonlyArray<MemberLine> => {
      const next = membersIn(allMembers(), id()).map((row): MemberLine => {
        const split = splitMemberRef(row.terminal);
        const standing =
          split === null
            ? undefined
            : fleetTerminalStanding(split.host, split.id);
        const was = prev.find((one) => one.terminal === row.terminal);
        return was !== undefined &&
          sameMember(was.member, row.member) &&
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
  const livePr = createMemo(() => livePrOf(members()));
  const checks = createMemo(() => checksTally(Option.fromNullishOr(livePr())));
  const at = createMemo(() => standingLine(work(), checks()));
  return { members, livePr, checks, at };
}

/** The same membership, field by field: the map is decoded afresh off the
 *  wire, so an unchanged member arrives as a new object. */
function sameMember(a: WorkMember, b: WorkMember): boolean {
  return (
    a === b ||
    (a.work === b.work &&
      a.role === b.role &&
      a.joinedAt === b.joinedAt &&
      a.worktree.kind === b.worktree.kind &&
      (a.worktree.kind !== "read" ||
        (b.worktree.kind === "read" && a.worktree.path === b.worktree.path)))
  );
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
