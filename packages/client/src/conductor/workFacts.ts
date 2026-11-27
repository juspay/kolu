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
 *  moment while the mirror is without it (the picked work). Every such fold
 *  reads `record` ({@link createWorkRecord}) rather than the store, so the
 *  whole record is subscribed once per face — a source per event and per
 *  decision, not a node per leaf — and each fold over it carries one. */

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
import { foldEach } from "../wideFold";
import { type MemberRef, splitMemberRef } from "./memberRef";
import { type ChecksTally, checksTally } from "./prReadings";
import { sameItems } from "./sameItems";
import { liveArm } from "./terminalStatus";
import { useWorkMembers } from "./useWorks";
import { useWorkPr, type WorkPr } from "./workPr";
import {
  membersByWork,
  roleRuns,
  sameStandingLine,
  type StandingLine,
  standingLine,
  type WorkMemberRow,
} from "./workReadings";
import { createWorkRecord } from "./workRecord";

/** One member as a face holds it: its row in the work, its ref split into the
 *  keys the fleet index is read by (`null` when this browser cannot read it),
 *  its live standing, read once, and whether that standing has a screen to
 *  watch. */
export interface MemberLine extends WorkMemberRow {
  readonly split: MemberRef | null;
  readonly standing: FleetTerminalStanding | undefined;
  /** THERE IS A SCREEN TO WATCH — the standing's live arm, read HERE with
   *  the standing rather than by each face that asks. A face asking it per
   *  member off the standing's record reads that record's leaves on its own
   *  scope, which for a card asking "is any terminal up?" is the whole
   *  membership on one scope. */
  readonly up: boolean;
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
  /** THE WHOLE RECORD, AS ONE READ — {@link createWorkRecord}. Every fold
   *  over the work reads this rather than the store, so each of them carries
   *  one dependency and the record is subscribed once for the face. */
  readonly record: Accessor<Work>;
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
  return createMemo(() => membersByWork(all()), { name: "membersByWork" });
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
  // ONE ROW MEMO PER MEMBER, JOINED A CHUNK AT A TIME. A member's standing is
  // the fleet index's per-key memo and that key's `store.v` on top of the
  // host's own three reads, so a single memo over the whole list carried two
  // to four sources per member and was past Solid's 200-source
  // `WIDE_SCOPE_DEPS` judge at about a hundred of them.
  //
  // Keyed by the member's SLOT, not its row object: `membersByWork` mints a
  // fresh row per run of the one app-wide map, so the object is no identity
  // to key on. A line that did not move keeps its object through the row
  // memo's `equals`, and a list in which none did keeps its own through the
  // join's — so a change to another work's membership, or to another
  // terminal's record, rebuilds nothing drawn from these lines.
  const slots = createMemo(() => rows().map((_, at) => at), {
    name: "workFacts.memberSlots",
    equals: sameItems,
  });
  const members = foldEach(
    "workFacts.members",
    slots,
    (at): MemberLine | undefined => {
      const row = rows()[at];
      if (row === undefined) return undefined;
      const split = splitMemberRef(row.terminal);
      const standing =
        split === null
          ? undefined
          : fleetTerminalStanding(split.host, split.id);
      return {
        ...row,
        split,
        standing,
        up: standing !== undefined && liveArm(standing) !== undefined,
      };
    },
    sameLine,
  );
  return { members };
}

/** The same line: the same member, standing the same way, with the same
 *  answer to whether there is a screen to watch.
 *
 *  `up` IS a test of its own, unlike the fields a face reads off the
 *  standing's record: the collection MERGES a frame into the record standing
 *  at that key, so a terminal going to sleep leaves `sameStanding` (whose
 *  test is `a.meta === b.meta`) saying the standing did not move. A face
 *  reading a field off that record is woken by the field and reads the new
 *  value; a flag COPIED onto the line is not, so the copy is what the
 *  comparison has to check. */
const sameLine = (a: MemberLine, b: MemberLine): boolean =>
  a.terminal === b.terminal &&
  a.member === b.member &&
  a.up === b.up &&
  sameStanding(a.standing, b.standing);

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
  const record = createWorkRecord(work);
  const { members } = readWorkFacts(() =>
    work().state.kind === "open" ? (byWork().get(id()) ?? NONE) : NONE,
  );
  // THE SNAPSHOT, not the store: `workPrOf` walks the whole timeline for the
  // PR the work's own events name, which off the proxy is a node per leaf of
  // every event.
  const pr = useWorkPr(id, record);
  const checks = createMemo(() => checksTally(pr()));
  // GATED: `standingLine` folds the snapshot again on every move of the
  // record and mints a fresh line — and a fresh `Option` inside it — for a
  // work standing exactly where it stood, so every face drawn from it (the
  // rail's clock and its dot, the card's line, the chip's hover card) would
  // re-run for nothing.
  const at = createMemo(() => standingLine(record(), checks()), {
    equals: sameStandingLine,
  });
  return { record, members, pr, checks, at };
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
