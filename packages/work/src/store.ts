/**
 * THE ONE SMART CONSTRUCTOR — the works and their members, together, or a
 * value naming which rule the two of them break and the rows that break it.
 *
 * Most of what "a legal store" means is already the TYPES' job and needs no
 * check at all: one work per key (a map keyed by {@link workIdOf}), a
 * terminal in at most one work (one map keyed by terminal), no bookkeeping
 * without a member (one row holds both), no kept files on a work in progress
 * and no `endedAt` without an outcome (one sum), no check event without a PR
 * (a required field), no "answered with nothing" (a sum). One branch, one
 * open work, is not a property of the map — two keys can name one branch —
 * and is rule 5 below.
 *
 * What is left is what JSON cannot say, and it is exactly six sentences:
 *
 *  1. the record's key is the work's own id;
 *  2. every member's work exists;
 *  3. that work is OPEN — so an ended work has no members, which is the same
 *     rule read from the other end;
 *  4. a work holds at most one `planner` and at most one `implementor`;
 *  5. no two OPEN works share a host, a repository root and a branch, where
 *     git has said the root ({@link rootOf}) — one branch runs as one card.
 *     A key whose root git has not said (`as-written`) is outside it;
 *  6. a watch's members are at most its own terminal, in the role `other` —
 *     a watch IS that one terminal, and kolu runs nothing in it.
 *
 * PARSE, DO NOT VALIDATE: the DECODER goes through here, so a store on disk
 * that breaks one of the six fails to decode with the fault that names it —
 * a VALUE, because the SENTENCE belongs to whichever face shows it — the same
 * rule a refusal follows (`./refusal.ts`) — and the recovery screen offers
 * the way back. The single writer goes through here too — `kolu-conductor`'s
 * work store assigns its one value only through `parseStore` — so a
 * transition that would break one throws before it is saved. There is no
 * third path that "already knows" its values are good.
 */

import { Option } from "effect";
import { endWork } from "./record.ts";
import {
  type BranchKey,
  isWaterfallRole,
  rootOf,
  type Work,
  type WorkId,
  type WorkMember,
  type WorkRole,
  workIdOf,
  watchedRef,
} from "./schema.ts";

/** WHICH OF THE SIX RULES A STORE BREAKS, and the rows that break it.
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
    }
  | {
      readonly kind: "branch-twice";
      /** The two open works on one host, root and branch, by title. */
      readonly first: string;
      readonly second: string;
      readonly branch: string;
    }
  | {
      readonly kind: "watch-member";
      /** The watch, by title, and the member that is not its own terminal
       *  in the role `other`. */
      readonly title: string;
      readonly terminal: string;
      readonly role: WorkRole;
    };

/** A store that breaks one of the six rules — the {@link StoreFault} saying
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

/** THE CHECK, as a {@link StoreFault} — none for a legal store — the half
 *  {@link parseStore} throws with, exported for a caller that wants to ask
 *  before it writes. */
export const storeFault = <M extends WorkMember>(
  works: Readonly<Record<WorkId, Work>> | ReadonlyMap<WorkId, Work>,
  members: Readonly<Record<string, M>> | ReadonlyMap<string, M>,
): Option.Option<StoreFault> => {
  const workRows = works instanceof Map ? [...works] : Object.entries(works);
  const memberRows =
    members instanceof Map ? [...members] : Object.entries(members);
  const branches = new Map<string, Work>();
  for (const [id, work] of workRows) {
    const own = workIdOf(work.key);
    if (own !== id)
      return Option.some({ kind: "key-mismatch", filedAs: id, says: own });
    if (work.state.kind !== "open" || work.key.kind !== "branch") continue;
    const { host, branch } = work.key;
    const root = rootOf(work.key);
    if (Option.isNone(root)) continue;
    const at = JSON.stringify([host, root.value, branch]);
    const first = branches.get(at);
    if (first !== undefined)
      return Option.some({
        kind: "branch-twice",
        first: first.title,
        second: work.title,
        branch,
      });
    branches.set(at, work);
  }
  const byId = new Map(workRows);
  const byWork = new Map<WorkId, Map<string, string>>();
  for (const [terminal, member] of memberRows) {
    const work = byId.get(member.work);
    if (work === undefined)
      return Option.some({
        kind: "no-such-work",
        terminal,
        work: member.work,
      });
    if (work.state.kind !== "open")
      return Option.some({ kind: "work-ended", terminal, title: work.title });
    if (
      work.key.kind === "watch" &&
      (terminal !== watchedRef(work.key) || member.role !== "other")
    )
      return Option.some({
        kind: "watch-member",
        title: work.title,
        terminal,
        role: member.role,
      });
    const roles = byWork.get(member.work) ?? new Map<string, string>();
    const taken = roles.get(member.role);
    if (taken !== undefined && isWaterfallRole(member.role)) {
      return Option.some({
        kind: "role-taken",
        title: work.title,
        role: member.role,
        held: taken,
        second: terminal,
      });
    }
    roles.set(member.role, terminal);
    byWork.set(member.work, roles);
  }
  return Option.none();
};

/** The works and their members, as a value nothing can have built wrong — or
 *  an {@link InvalidWorkStore} carrying the {@link StoreFault}. */
export const parseStore = <M extends WorkMember>(
  works: Readonly<Record<WorkId, Work>> | ReadonlyMap<WorkId, Work>,
  members: Readonly<Record<string, M>> | ReadonlyMap<string, M>,
): WorkStoreValue<M> => {
  const fault = storeFault(works, members);
  if (Option.isSome(fault)) throw new InvalidWorkStore(fault.value);
  return {
    works:
      works instanceof Map ? new Map(works) : new Map(Object.entries(works)),
    members:
      members instanceof Map
        ? new Map(members)
        : new Map(Object.entries(members)),
  };
};

/** THE OPEN WORK, other than `except`, that runs `branch` of `root` on `host`
 *  — rule 5's own test: an open branch work whose key says that root
 *  ({@link rootOf}). A well-formed store holds at most one. */
export const runningOn = (
  works: ReadonlyMap<WorkId, Work>,
  at: { readonly host: string; readonly root: string; readonly branch: string },
  except: WorkId,
): Option.Option<readonly [WorkId, Work]> => {
  for (const [id, work] of works) {
    if (id === except || work.state.kind !== "open") continue;
    if (work.key.kind !== "branch") continue;
    if (work.key.host !== at.host || work.key.branch !== at.branch) continue;
    if (Option.contains(rootOf(work.key), at.root))
      return Option.some([id, work]);
  }
  return Option.none();
};

/** WHAT A RE-KEY DID — see {@link rekeyed}. */
export type Rekey =
  /** The root's id is the work's own: its key is stamped `git` — and, when
   *  the branch already runs as another open work, it was ended. */
  | { readonly kind: "stamped"; readonly ended: boolean }
  /** The work moved to the root's id, in its place, stamped `git`. */
  | { readonly kind: "moved"; readonly to: WorkId }
  /** The root's id is another work's, or the branch already runs as another
   *  open work (`by`): this one keeps its old key and id, `held` from the
   *  root — and, when it was open beside that open work, it was ended. */
  | {
      readonly kind: "held";
      readonly by: WorkId;
      readonly ended: boolean;
    };

/** A BRANCH WORK RE-KEYED TO GIT'S ROOT — the one transition, pure. With `W`
 *  the work at `id`, `N` the id of `W`'s key with `repo` set to `root`, and
 *  RUNNING the open work other than `W` on that host, root and branch, if
 *  any ({@link runningOn}, rule 5's own test):
 *
 *  - `N` is `W`'s own id: the key is stamped `git`. Nothing moves.
 *  - `N` is free and nothing else runs the branch: `W` moves to `N` AT THE
 *    SAME POSITION (a card keeps its place), stamped `git`, and its members
 *    follow.
 *  - `N` is another work's, or the branch already runs as another open
 *    work: `W` keeps its old key and id, `held` from `root`. No other work
 *    is touched.
 *
 *  In every row, an OPEN `W` beside a RUNNING work is also ended — stopped,
 *  by kolu, at `at`, its members leaving with it — because one branch
 *  cannot run as two cards (rule 5).
 *
 *  NOTHING IS EVER REMOVED: no work, open or finished, leaves the value, and
 *  every work but `W` is the same value it was. `id` must be a branch work
 *  the store holds; anything else is a defect. */
export const rekeyed = <M extends WorkMember>(
  store: WorkStoreValue<M>,
  id: WorkId,
  root: string,
  at: string,
): { readonly value: WorkStoreValue<M>; readonly rekey: Rekey } => {
  const work = store.works.get(id);
  if (work === undefined || work.key.kind !== "branch")
    throw new Error(`rekeyed: ${id} is no branch work in the store`);
  const key: BranchKey = work.key;
  const target = workIdOf({ ...key, repo: root });
  const running = runningOn(
    store.works,
    { host: key.host, root, branch: key.branch },
    id,
  );
  const ended = work.state.kind === "open" && Option.isSome(running);
  /** `W` written back under its own id as `next`, ended when it must be. */
  const kept = (next: Work): WorkStoreValue<M> => ({
    works: replaced(
      store.works,
      id,
      id,
      ended
        ? endWork(next, { outcome: { kind: "stopped", by: "kolu" }, at })
        : next,
    ),
    members: ended
      ? new Map([...store.members].filter(([, one]) => one.work !== id))
      : store.members,
  });
  if (target === id)
    return {
      value: kept({ ...work, key: { ...key, repoBy: { kind: "git" } } }),
      rekey: { kind: "stamped", ended },
    };
  const holder = store.works.get(target);
  if (holder === undefined && Option.isNone(running))
    return {
      value: {
        works: replaced(store.works, id, target, {
          ...work,
          key: { ...key, repo: root, repoBy: { kind: "git" } },
        }),
        members: new Map(
          [...store.members].map(([ref, one]) => [
            ref,
            one.work === id ? { ...one, work: target } : one,
          ]),
        ),
      },
      rekey: { kind: "moved", to: target },
    };
  return {
    value: kept({ ...work, key: { ...key, repoBy: { kind: "held", root } } }),
    rekey: {
      kind: "held",
      by: Option.match(running, {
        onNone: () => target,
        onSome: ([other]) => other,
      }),
      ended,
    },
  };
};

/** The works with the one at `from` replaced by `work` under `to`, in the
 *  same place. */
const replaced = (
  works: ReadonlyMap<WorkId, Work>,
  from: WorkId,
  to: WorkId,
  work: Work,
): ReadonlyMap<WorkId, Work> =>
  new Map(
    [...works].map(([id, one]): [WorkId, Work] =>
      id === from ? [to, work] : [id, one],
    ),
  );
