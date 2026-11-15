/**
 * THE ONE SMART CONSTRUCTOR — the works and their members, together, or a
 * value naming which rule the two of them break and the rows that break it.
 *
 * Most of what "a legal store" means is already the TYPES' job and needs no
 * check at all: one work per branch (a map keyed by {@link workIdOf}), a
 * terminal in at most one work (one map keyed by terminal), no bookkeeping
 * without a member (one row holds both), no kept files on a work in progress
 * and no `endedAt` without an outcome (one sum), no check event without a PR
 * (a required field), no "answered with nothing" (a sum).
 *
 * What is left is what JSON cannot say, and it is exactly four sentences:
 *
 *  1. the record's key is the work's own id;
 *  2. every member's work exists;
 *  3. that work is OPEN — so an ended work has no members, which is the same
 *     rule read from the other end;
 *  4. a work holds at most one `planner` and at most one `implementor`.
 *
 * PARSE, DO NOT VALIDATE: the DECODER goes through here, so a store on disk
 * that breaks one of the four fails to decode with the fault that names it —
 * a VALUE, because the SENTENCE belongs to whichever face shows it — the same
 * rule a refusal follows (`./refusal.ts`) — and the recovery screen offers
 * the way back. The single writer goes through here too, so a
 * transition that would break one cannot be saved. There is no third path
 * that "already knows" its values are good.
 */

import {
  isWaterfallRole,
  type Work,
  type WorkId,
  type WorkMember,
  type WorkRole,
  workIdOf,
} from "./schema.ts";

/** WHICH OF THE FOUR RULES A STORE BREAKS, and the rows that break it.
 *
 *  A value, not a sentence: this package holds no English a person reads
 *  ({@link WorkRefusal}'s doc states the rule), so the one face that shows a
 *  fault composes the words from these fields. */
export type StoreFault =
  | {
      readonly kind: "key-mismatch";
      readonly filedAs: WorkId;
      readonly says: WorkId;
    }
  | {
      readonly kind: "no-such-work";
      readonly terminal: string;
      readonly work: WorkId;
    }
  | {
      readonly kind: "work-ended";
      readonly terminal: string;
      readonly title: string;
    }
  | {
      readonly kind: "role-taken";
      readonly title: string;
      readonly role: WorkRole;
      readonly held: string;
      readonly second: string;
    };

/** A store that breaks one of the four rules — the {@link StoreFault} saying
 *  which, thrown. The `message` is the kind, for a stack trace and nothing
 *  else; what a person is shown is the face's. */
export class InvalidWorkStore extends Error {
  readonly fault: StoreFault;
  constructor(fault: StoreFault) {
    super(fault.kind);
    this.name = "InvalidWorkStore";
    this.fault = fault;
  }
}

/** The works and their members, as the one writer and every reader hold
 *  them. Maps rather than records: insertion order is the works' order (a
 *  card keeps its place), and a lookup is not a prototype hazard. */
export interface WorkStoreValue<M extends WorkMember> {
  readonly works: ReadonlyMap<WorkId, Work>;
  readonly members: ReadonlyMap<string, M>;
}

/** THE CHECK, as a {@link StoreFault} or nothing — the half {@link parseStore}
 *  throws with, exported for a caller that wants to ask before it writes. */
export const storeFault = <M extends WorkMember>(
  works: Readonly<Record<WorkId, Work>> | ReadonlyMap<WorkId, Work>,
  members: Readonly<Record<string, M>> | ReadonlyMap<string, M>,
): StoreFault | null => {
  const workRows = works instanceof Map ? [...works] : Object.entries(works);
  const memberRows =
    members instanceof Map ? [...members] : Object.entries(members);
  for (const [id, work] of workRows) {
    const own = workIdOf(work.key);
    if (own !== id) return { kind: "key-mismatch", filedAs: id, says: own };
  }
  const byId = new Map(workRows);
  const byWork = new Map<WorkId, Map<string, string>>();
  for (const [terminal, member] of memberRows) {
    const work = byId.get(member.work);
    if (work === undefined)
      return { kind: "no-such-work", terminal, work: member.work };
    if (work.state.kind !== "open")
      return { kind: "work-ended", terminal, title: work.title };
    const roles = byWork.get(member.work) ?? new Map<string, string>();
    const taken = roles.get(member.role);
    if (taken !== undefined && isWaterfallRole(member.role)) {
      return {
        kind: "role-taken",
        title: work.title,
        role: member.role,
        held: taken,
        second: terminal,
      };
    }
    roles.set(member.role, terminal);
    byWork.set(member.work, roles);
  }
  return null;
};

/** The works and their members, as a value nothing can have built wrong — or
 *  an {@link InvalidWorkStore} carrying the {@link StoreFault}. */
export const parseStore = <M extends WorkMember>(
  works: Readonly<Record<WorkId, Work>> | ReadonlyMap<WorkId, Work>,
  members: Readonly<Record<string, M>> | ReadonlyMap<string, M>,
): WorkStoreValue<M> => {
  const fault = storeFault(works, members);
  if (fault !== null) throw new InvalidWorkStore(fault);
  return {
    works:
      works instanceof Map ? new Map(works) : new Map(Object.entries(works)),
    members:
      members instanceof Map
        ? new Map(members)
        : new Map(Object.entries(members)),
  };
};
