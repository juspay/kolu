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
  /** EVERY MEMBER, REPLACED — the boot read and a restored backup both hand
   *  the whole map over at once. */
  readonly load: (members: PersistedMembers) => void;
  /** Every member of this work, dropped — what ending a work does in the same
   *  step as ending it. Answers the refs that went. */
  readonly dropWork: (work: WorkId) => ReadonlyArray<string>;
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

export const memberStore = (): MemberStore => {
  const members = new Map<string, Member>();
  return {
    at: (ref) => members.get(ref),
    set: (ref, member) => {
      members.set(ref, member);
    },
    forget: (ref) => {
      members.delete(ref);
    },
    all: () => members,
    ofWork: (work) => [...members].filter(([, one]) => one.work === work),
    inRole: (work, role) =>
      [...members].find(
        ([, one]) => one.work === work && one.role === role,
      )?.[0],
    load: (held) => {
      members.clear();
      for (const [ref, member] of Object.entries(held))
        members.set(ref, restored(member));
    },
    dropWork: (work) => {
      const gone = [...members]
        .filter(([, one]) => one.work === work)
        .map(([ref]) => ref);
      for (const ref of gone) members.delete(ref);
      return gone;
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
      const written: Record<string, PersistedMember> = {};
      for (const [ref, member] of members)
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
