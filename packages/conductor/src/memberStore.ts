/**
 * WHAT KOLU KNOWS ABOUT EACH MEMBER TERMINAL — ONE location, keyed by fleet
 * ref.
 *
 * One map rather than a watch field inside the work record plus a parallel
 * runtime map beside it. The domain says a member's state is one thing
 * (`./members.ts` declares it as one interface), and holding it in two places
 * cost five invariants nothing enforced — every transition had to hand its
 * members back by reference, `joinWork` had to be patched at its one call
 * site, nothing carrying a watch could reach a reader — plus a work whose
 * published value moved every time a terminal was renamed.
 *
 * The SAVED half is taken by subtraction at the write (`./members.ts`'s
 * `saved`), so a field added to the member arrives in the file with no edit
 * here, and the two runtime fields — the last reading and whether the next one
 * baselines — cannot be written by accident.
 */

import type { MemberReading } from "kolu-common/works";
import {
  type MemberState,
  type MemberWatch,
  joinedWatch,
  restoredMember,
  saved,
} from "./members.ts";
import type { PersistedMembers } from "./persisted.ts";

export interface MemberStore {
  readonly at: (ref: string) => MemberState | undefined;
  readonly set: (ref: string, member: MemberState) => void;
  /** A member that left has nothing left to read. */
  readonly forget: (ref: string) => void;
  /** THE MEMBERSHIP IS THE TRUTH — every ref that is an active member of a
   *  work in progress and nothing else. Refs this store does not hold are
   *  seeded from what was written down (or, for one the file never had, from
   *  an empty watch); refs it holds that are not members are dropped.
   *
   *  One rule rather than "add these, remove those", because the two edges
   *  that reach it — the boot read and a restored backup — both REPLACE the
   *  membership wholesale. */
  readonly reseed: (refs: ReadonlyArray<string>, was: PersistedMembers) => void;
  /** How each member terminal stands, as a reader is told it. A terminal
   *  nothing has read yet is ABSENT rather than carried at zero — "nobody has
   *  looked at its host" and "it has stood this way for no time" are different
   *  facts. */
  readonly readings: () => ReadonlyMap<string, MemberReading>;
  /** What the `members` key holds after this movement. */
  readonly saved: () => PersistedMembers;
}

export const memberStore = (): MemberStore => {
  const members = new Map<string, MemberState>();
  return {
    at: (ref) => members.get(ref),
    set: (ref, member) => {
      members.set(ref, member);
    },
    forget: (ref) => {
      members.delete(ref);
    },
    reseed: (refs, was) => {
      const wanted = new Set(refs);
      for (const ref of [...members.keys()])
        if (!wanted.has(ref)) members.delete(ref);
      for (const ref of wanted) {
        if (members.has(ref)) continue;
        // A ref the file never wrote down is a member whose watch is unknown
        // — an empty one, read as `asked` so its first sighting is taken at
        // face value rather than as news about a state nobody chose.
        members.set(ref, restoredMember(was[ref] ?? joinedWatch("asked")));
      }
    },
    readings: () => {
      const seen = new Map<string, MemberReading>();
      for (const [ref, member] of members) {
        if (member.last === null) continue;
        seen.set(ref, { level: member.last.level, since: member.last.since });
      }
      return seen;
    },
    saved: () => {
      const written: Record<string, MemberWatch> = {};
      for (const [ref, member] of members) written[ref] = saved(member);
      return written;
    },
  };
};
