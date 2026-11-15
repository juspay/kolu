/**
 * THE ONE SMART CONSTRUCTOR — the works and their members, together, or a
 * sentence saying which rule the two of them break.
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
 * that breaks one of the four fails to decode with the sentence that names it
 * (and the Conductor's recovery screen offers the way back), and the single
 * writer goes through here too, so a transition that would break one cannot
 * be saved. There is no third path that "already knows" its values are good.
 */

import {
  UNIQUE_ROLES,
  type Work,
  type WorkId,
  type WorkMember,
  workIdOf,
} from "./schema.ts";

/** A store that breaks one of the four rules, as a value — `why` is the
 *  whole sentence, naming the rule and the rows that break it. */
export class InvalidWorkStore extends Error {
  readonly why: string;
  constructor(why: string) {
    super(why);
    this.name = "InvalidWorkStore";
    this.why = why;
  }
}

/** The works and their members, as the one writer and every reader hold
 *  them. Maps rather than records: insertion order is the works' order (a
 *  card keeps its place), and a lookup is not a prototype hazard. */
export interface WorkStoreValue<M extends WorkMember> {
  readonly works: ReadonlyMap<WorkId, Work>;
  readonly members: ReadonlyMap<string, M>;
}

/** THE CHECK, as a sentence or nothing — the half {@link parseStore} throws
 *  with, exported for a caller that wants to ask before it writes. */
export const storeFault = <M extends WorkMember>(
  works: Readonly<Record<WorkId, Work>> | ReadonlyMap<WorkId, Work>,
  members: Readonly<Record<string, M>> | ReadonlyMap<string, M>,
): string | null => {
  const workRows = works instanceof Map ? [...works] : Object.entries(works);
  const memberRows =
    members instanceof Map ? [...members] : Object.entries(members);
  for (const [id, work] of workRows) {
    const own = workIdOf(work.key);
    if (own !== id) {
      return `A piece of work is stored under ${JSON.stringify(id)} but says it is ${JSON.stringify(own)} — a work is identified by its branch, and the key it is filed under has to be that same identity.`;
    }
  }
  const byWork = new Map<WorkId, Map<string, string>>();
  for (const [terminal, member] of memberRows) {
    const work = workRows.find(([id]) => id === member.work)?.[1];
    if (work === undefined) {
      return `The terminal ${JSON.stringify(terminal)} is recorded as a member of ${JSON.stringify(member.work)}, and there is no such piece of work — a member belongs to a work kolu holds.`;
    }
    if (work.state.kind !== "open") {
      return `The terminal ${JSON.stringify(terminal)} is recorded as a member of «${work.title}», which has ended — a work that ends takes its members with it, so a finished work has no terminals.`;
    }
    const roles = byWork.get(member.work) ?? new Map<string, string>();
    const taken = roles.get(member.role);
    if (
      taken !== undefined &&
      (UNIQUE_ROLES as ReadonlyArray<string>).includes(member.role)
    ) {
      return `«${work.title}» has two terminals in the ${member.role} role (${JSON.stringify(taken)} and ${JSON.stringify(terminal)}) — a piece of work has one planner and one implementor.`;
    }
    roles.set(member.role, terminal);
    byWork.set(member.work, roles);
  }
  return null;
};

/** The works and their members, as a value nothing can have built wrong — or
 *  an {@link InvalidWorkStore} carrying the sentence. */
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
