/**
 * EVERY MEMBER TERMINAL — ONE map, keyed by fleet ref, holding the whole of
 * what kolu knows about it: which work it is doing, in what role, since when,
 * where it is working, and the watch's own memory of the terminal.
 *
 * ONE map rather than a members array inside each work plus a parallel
 * bookkeeping record beside them. Holding it in two places cost five
 * invariants nothing enforced; holding membership inside the work cost the
 * biggest one of all — a terminal could be a member of two works at once, and
 * that is a card claiming an agent another card is also claiming. Here, a
 * terminal is in AT MOST ONE WORK by construction: it has one row.
 *
 * THE MAP IS HALF OF ONE VALUE. The works and their members are one
 * `WorkStoreValue`, held by the work store (`./workStore.ts`), and every
 * write replaces the whole value through `parseStore` — so a write that
 * would break one of the store's rules throws before anything is assigned.
 * This module is the members' face onto that value ({@link memberView}): it
 * reads the map, and a write hands the next map to the store's one commit.
 *
 * The SAVED half is the watch's own six fields, listed at the write
 * (`./members.ts`'s `saved`): the row holds the model's four as well, so a
 * rest-spread would write them a second time inside `watch`. The two runtime
 * fields — the last reading and whether the next one baselines — are not in
 * that list, so they cannot be written by accident.
 */

import type { MemberReading } from "kolu-common/works";
import type { WorkId, WorkMember, WorkRole } from "kolu-work";
import {
  type MemberState,
  type MemberWatch,
  joinedWatch,
  restoredMember,
  saved,
} from "./members.ts";
import type { PersistedMember, PersistedMembers } from "./persisted.ts";

/** ONE MEMBER as this process holds it: what the model says a member is, plus
 *  the watch's own state for that terminal. */
export interface Member extends WorkMember, MemberState {}

/** The members, read and written through the store's one value. */
export interface MemberStore {
  readonly at: (ref: string) => Member | undefined;
  readonly set: (ref: string, member: Member) => void;
  /** A member that left has nothing left to read. */
  readonly forget: (ref: string) => void;
  /** Every member, in the order they joined this process's map. */
  readonly all: () => ReadonlyMap<string, Member>;
  /** The members of one work. */
  readonly ofWork: (work: WorkId) => ReadonlyArray<readonly [string, Member]>;
  /** The terminal already in this role of this work, if any — what the role
   *  uniqueness refusal names. */
  readonly inRole: (work: WorkId, role: WorkRole) => string | undefined;
  /** How each member terminal stands, as a reader is told it. A terminal
   *  nothing has read yet is ABSENT rather than carried at zero. */
  readonly readings: () => ReadonlyMap<string, MemberReading>;
  /** What the `members` key holds after this movement. */
  readonly saved: () => PersistedMembers;
}

/** The member a restart restores: the model's four fields as the file holds
 *  them, and the watch's half with its two runtime fields empty. */
export const restored = (member: PersistedMember): Member => ({
  work: member.work,
  role: member.role,
  joinedAt: member.joinedAt,
  worktree: member.worktree,
  ...restoredMember(member.watch),
});

/** A member as it joins: the model's four fields, and a watch that knows
 *  nothing about the terminal yet. */
export const joined = (
  member: WorkMember,
  how: MemberWatch["joined"],
): Member => ({
  ...member,
  ...restoredMember(joinedWatch(how)),
  baselining: how === "asked",
});

/** Every persisted member, restored — the members half of a boot read or a
 *  restored backup. */
export const restoredAll = (
  held: PersistedMembers,
): ReadonlyMap<string, Member> =>
  new Map(Object.entries(held).map(([ref, one]) => [ref, restored(one)]));

/** THE MEMBERS' FACE onto the store's one value: `read` is the members map
 *  as it stands, and `write` hands the next one to the store's commit, which
 *  parses it with the works before it is assigned. */
export const memberView = (
  read: () => ReadonlyMap<string, Member>,
  write: (next: ReadonlyMap<string, Member>) => void,
): MemberStore => {
  /** The next map: this one with `change` applied to a copy. */
  const writing = (change: (next: Map<string, Member>) => void): void => {
    const next = new Map(read());
    change(next);
    write(next);
  };
  return {
    at: (ref) => read().get(ref),
    set: (ref, member) => writing((next) => next.set(ref, member)),
    forget: (ref) => writing((next) => next.delete(ref)),
    all: read,
    ofWork: (work) => [...read()].filter(([, one]) => one.work === work),
    inRole: (work, role) =>
      [...read()].find(
        ([, one]) => one.work === work && one.role === role,
      )?.[0],
    readings: () => {
      const seen = new Map<string, MemberReading>();
      for (const [ref, member] of read()) {
        if (member.last === null) continue;
        seen.set(ref, { level: member.last.level, since: member.last.since });
      }
      return seen;
    },
    saved: () => {
      const written: Record<string, PersistedMember> = {};
      for (const [ref, member] of read())
        written[ref] = {
          work: member.work,
          role: member.role,
          joinedAt: member.joinedAt,
          worktree: member.worktree,
          watch: saved(member),
        };
      return written;
    },
  };
};
