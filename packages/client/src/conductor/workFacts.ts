/** A WORK'S LIVE FACTS — its member terminals, each with its standing read once;
 *  the PR one of their records carries; that PR's checks counted; and where the
 *  work stands. Read for every face a work has: its card, its line in the
 *  sidebar, its chip and the chip's hover card.
 *
 *  ONE READING PER WORK, NOT PER FACE. The members map is one value for the
 *  whole fleet, and a chat draws a chip on every turn. So the map is split by
 *  work once, for the whole app (`useMembersByWork`), and each work's lines,
 *  its live PR and its checks are read once, in a root of their own that every
 *  face of that work shares. The root lives while any face holds it: the last
 *  face to go disposes it, so a work nobody draws is read by nobody.
 *
 *  Where the work stands (`at`) is folded per face from the face's own record:
 *  it is a pure fold over that record, and a face may hold a work's last
 *  record for a moment while the mirror is without it (the picked work). */

import { activeArm } from "@kolu/padi-client/surface";
import type { PrInfo } from "anyforge/schemas";
import { Option } from "effect";
import type { Work, WorkId } from "kolu-work";
import { type Accessor, createMemo, createRoot, onCleanup } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import {
  type FleetTerminalStanding,
  fleetTerminalStanding,
} from "../palette/fleetTerminals";
import { agentName } from "../ui/agentDisplay";
import { type MemberRef, splitMemberRef } from "./memberRef";
import { type ChecksTally, checksTally, livePrOf } from "./prReadings";
import { useWorkMembers } from "./useWorks";
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
   *  is over (the members map holds open works only). */
  readonly members: Accessor<ReadonlyArray<MemberLine>>;
  /** The work's PR as a member's record carries it right now. */
  readonly livePr: Accessor<PrInfo | null>;
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

/** What one work's shared root reads: everything but `at`. */
export type SharedFacts = Omit<WorkFacts, "at">;

/** ONE WORK'S READING, from its members' rows — the reading itself, apart
 *  from who holds it.
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
): SharedFacts {
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
  const livePr = createMemo(() => livePrOf(members()));
  const checks = createMemo(() => checksTally(Option.fromNullishOr(livePr())));
  return { members, livePr, checks };
}

/** The shared roots, by work, with how many faces hold each. */
const held = new Map<
  WorkId,
  { count: number; facts: SharedFacts; dispose: () => void }
>();

function acquire(id: WorkId): SharedFacts {
  let one = held.get(id);
  if (one === undefined) {
    const byWork = useMembersByWork();
    const made = createRoot((dispose) => ({
      count: 0,
      facts: readWorkFacts(() => byWork().get(id) ?? NONE),
      dispose,
    }));
    held.set(id, made);
    one = made;
  }
  one.count += 1;
  return one.facts;
}

function release(id: WorkId): void {
  const one = held.get(id);
  if (one === undefined) return;
  one.count -= 1;
  if (one.count > 0) return;
  held.delete(id);
  one.dispose();
}

/** A face's hold on its work's reading. Call from a component body: the hold
 *  lasts as long as the face, and moves with the face's id. */
export function createWorkFacts(
  id: Accessor<WorkId>,
  work: Accessor<Work>,
): WorkFacts {
  const shared = createMemo(() => {
    const one = id();
    const facts = acquire(one);
    onCleanup(() => release(one));
    return facts;
  });
  const members = () => shared().members();
  const livePr = () => shared().livePr();
  const checks = () => shared().checks();
  const at = createMemo(() => standingLine(work(), checks()));
  return { members, livePr, checks, at };
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
