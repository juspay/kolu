/**
 * THE PIECES OF WORK KOLU HOLDS — the map, every rule for moving one, and what
 * a reader is told about them.
 *
 * ## A work is its key, and the map is keyed by it
 *
 * `works` is a map from {@link WorkId} (the string encoding of a
 * {@link WorkKey}) to the record. So a second card for one branch is not
 * something a caller can create: {@link WorkStore.openFor} of a key that
 * exists answers THAT work, reopening it if it had ended. That is the whole
 * of the defect this round was opened for — three cards, one branch — and it
 * is closed by the shape rather than by a check.
 *
 * ## Members are a map of their own, and ending takes them with it
 *
 * Membership lives in `./memberStore.ts`, keyed by terminal, so a terminal is
 * in at most one work. A work that ENDS drops its members in the same step,
 * in this one writer — which is why a finished card has nowhere to draw a
 * terminal, a lock or an open question.
 *
 * ## Losing terminals never ends a work
 *
 * A work whose members have all gone is an OPEN work with no terminals: the
 * card says so, and the Conductor is woken ONCE with exactly that
 * ({@link WorkStoreDeps.noTerminals}). The only endings are the forge's two
 * and a Stop.
 *
 * ## Insertion order IS the contract
 *
 * A work sits where it was opened, so a card keeps its place for as long as
 * it is in progress.
 */

import { Schema } from "effect";
import { type MemberReading, MemberReadingSchema } from "kolu-common/works";
import {
  capFinished,
  type Driver,
  driverOf,
  endWork,
  filesSeen,
  finished,
  handBack as handBackRecord,
  inProgress,
  joinWork,
  keepFailed,
  keepFiles,
  leaveWork,
  type Outcome,
  openAsks,
  openWork,
  reopenWork,
  takeOver as takeOverRecord,
  type Work,
  type WorkId,
  type WorkKey,
  type WorkMember,
  type WorkRole,
  WorkRefusal,
  workDirOf,
  workIdOf,
} from "kolu-work";
import type { Logger } from "pino";
import { splitFleetTerminalRef } from "kolu-mcp/fleetRef";
import { dropOpenAsks, type SettledAsk } from "./askNews.ts";
import type { WatchJoin } from "./members.ts";
import {
  joined as joinedMember,
  type Member,
  type MemberStore,
} from "./memberStore.ts";
import type { PersistedMembers, PersistedWorks } from "./persisted.ts";
import type { RecordWrites } from "./recordWrites.ts";
import type { WorkFiles } from "./workFiles.ts";

/** HOW MANY FINISHED WORKS KOLU KEEPS — with their files.
 *
 *  The host's number, not the model's: it is a budget on the state root this
 *  process writes under (every kept work holds a directory of copied files
 *  beside the record), and a retention rule living inside a package about what
 *  a work IS would be a storage decision no reader could find. */
export const FINISHED_KEPT = 20;

/** One member, as a reader outside this package is told about it. */
export interface MemberDetail {
  readonly ref: string;
  readonly work: WorkId;
  readonly role: WorkRole;
  readonly name: string;
  readonly agent: string | null;
  readonly joined: WatchJoin;
}

/** The work a terminal is a member of, and that member. */
export interface MemberAt {
  readonly id: WorkId;
  readonly work: Work;
  readonly member: Member;
}

/** What opening a key answered: the work, and whether this call is what
 *  created it. A caller asking for a key that already exists is told so, and
 *  asks only the setup questions that have no answer. */
export interface Opened {
  readonly id: WorkId;
  readonly work: Work;
  readonly created: boolean;
  /** Whether this call brought an ended work back. */
  readonly reopened: boolean;
}

export interface WorkStore {
  /** The boot read: the remembered works and the members that go with them. */
  readonly load: (kept: PersistedWorks, members: PersistedMembers) => void;
  /** Every work with its id, in the order they were opened. */
  readonly all: () => ReadonlyArray<readonly [WorkId, Work]>;
  /** The works a READER is given: in progress oldest first, then the finished
   *  ones newest first. */
  readonly read: () => ReadonlyArray<readonly [WorkId, Work]>;
  /** EVERY QUESTION STILL WAITING ON A PERSON, across the works in progress —
   *  ask ids, oldest work first. Derived from the decisions like every other
   *  reading of "what is open", so no second list can disagree with the
   *  cards: it is what the bell, the OS badge and the panel's count all read,
   *  through the published frame. */
  readonly openAsks: () => ReadonlyArray<string>;
  readonly get: (id: WorkId) => Work | undefined;
  readonly at: (ref: string) => MemberAt | undefined;
  /** A work that exists and has not ended, or the refusal that says which of
   *  the two it failed. */
  readonly openAt: (id: WorkId) => Work;
  /** OPEN THE WORK FOR THIS KEY — idempotent. A key kolu already holds
   *  answers that work (brought back to Open if it had ended); a key it does
   *  not holds a new one. */
  readonly openFor: (opened: {
    readonly key: WorkKey;
    readonly title: string;
    readonly request: string;
  }) => Opened;
  /** Write a work back. */
  readonly save: (id: WorkId, work: Work) => void;
  /** STOP a work — the one ending nobody observed. */
  readonly stop: (id: WorkId, by: "you" | "conductor") => Work;
  /** ... and bring one back. */
  readonly reopen: (id: WorkId) => Work;
  /** THE FORGE SAID SO: merged, or closed. */
  readonly endWith: (id: WorkId, outcome: Outcome) => void;
  /** A member leaves. The work stays as it is — losing terminals is not an
   *  ending — and the Conductor is woken once when the last one goes. */
  readonly leave: (ref: string, why: "closed" | "released" | "gone") => void;
  /** A terminal joins a work in a role, leaving whatever else it was doing.
   *  Refuses a role this work already has (one planner, one implementor). */
  readonly join: (
    id: WorkId,
    ref: string,
    role: WorkRole,
    joined: WatchJoin,
  ) => void;
  /** THE WORK NOTHING HAS HAPPENED IN, DECLINED — removed rather than ended.
   *  Answers whether it went. */
  readonly declined: (id: WorkId) => boolean;
  /** A MEMBER TERMINAL THE CONDUCTOR DRIVES, and who is driving it — or the
   *  refusal that says it is none. */
  readonly driven: (ref: string) => MemberAt & { readonly driver: Driver };
  /** The keys changed hands: the act, on the work's timeline. */
  readonly handover: (ref: string, what: "taken-over" | "handed-back") => void;
  /** EVERY WORK, REPLACED — a restored backup. Answers the refs that are no
   *  longer members of anything. */
  readonly restore: (
    kept: PersistedWorks,
    members: PersistedMembers,
  ) => ReadonlyArray<string>;
  /** THE WATCHER'S SCOPE — every member terminal of a work in progress. */
  readonly memberRefs: () => ReadonlyArray<string>;
  /** ... and the same members with what kolu knows about each. */
  readonly membersDetail: () => ReadonlyArray<MemberDetail>;
  /** The works moved: every reader told, and the file owed a write. */
  readonly changed: () => void;
  /** Just the readers — for the edges that write the file themselves. */
  readonly publishWorks: () => void;
  /** ... and the same for how the member terminals stand, on its own clock. */
  readonly publishReadings: () => void;
  /** What the `works` key holds. */
  readonly persisted: () => PersistedWorks;
  /** THE KEPT FILES, RECONCILED TO THE WORKS. */
  readonly sweepFiles: () => void;
}

/** The sentence behind a thrown thing — the harness's refusals and the wire
 *  errors carry a WHOLE SENTENCE in `why`, and that is the half a reader is
 *  shown. */
const sentenceOf = (err: unknown): string => {
  if (typeof err === "object" && err !== null && "why" in err) {
    const { why } = err;
    if (typeof why === "string" && why !== "") return why;
  }
  return err instanceof Error ? err.message : String(err);
};

/**
 * WHAT MOVED, PUBLISHED — one helper, parameterised by what "moved" means for
 * the thing in it.
 */
const publishMoved = <K, T>(
  published: Map<K, T>,
  now: ReadonlyMap<K, T>,
  same: (a: T, b: T) => boolean,
  out: (key: K, value: T | null) => void,
): void => {
  for (const [key, value] of now) {
    const was = published.get(key);
    if (was !== undefined && same(was, value)) continue;
    published.set(key, value);
    out(key, value);
  }
  for (const key of [...published.keys()]) {
    if (now.has(key)) continue;
    published.delete(key);
    out(key, null);
  }
};

export interface WorkStoreDeps {
  readonly workFiles: WorkFiles;
  readonly publishWork: (id: WorkId, work: Work | null) => void;
  readonly publishMember: (terminal: string, member: WorkMember | null) => void;
  readonly publishReading: (
    terminal: string,
    reading: MemberReading | null,
  ) => void;
  readonly membersMoved: (membership: boolean) => void;
  /** THIS CHANGE ENDED THE WORK, and these are the questions that went with
   *  it — recorded as dropped by this writer in the same step as the ending,
   *  because nobody can answer a question about a work that is over. Each one
   *  arrives settled: what its transcript row now says, and what the
   *  Conductor is woken with. A work with no open question does not call it.
   */
  readonly ended: (settled: ReadonlyArray<SettledAsk>) => void;
  /** THE LAST TERMINAL WENT. Called ONCE per emptying, with the work that is
   *  still open and now has nobody doing it — which is the whole of what the
   *  Conductor is told (never "gone, so I ended it"). */
  readonly noTerminals: (id: WorkId, work: Work) => void;
  readonly records: RecordWrites<"works" | "members">;
  readonly members: MemberStore;
  readonly log: Logger;
}

export const workStore = (deps: WorkStoreDeps): WorkStore => {
  const works = new Map<WorkId, Work>();
  const publishedWorks = new Map<WorkId, Work>();
  const publishedMembers = new Map<string, WorkMember>();
  const publishedReadings = new Map<string, MemberReading>();
  const sameReading = Schema.toEquivalence(MemberReadingSchema);
  const nowIso = (): string => new Date().toISOString();

  const everyWork = (): ReadonlyArray<readonly [WorkId, Work]> => [...works];

  const publishWorks = (): void => {
    publishMoved(
      publishedWorks,
      works,
      (was, now) => was === now,
      deps.publishWork,
    );
    publishMoved(
      publishedMembers,
      new Map(
        [...deps.members.all()].map(([ref, one]) => [
          ref,
          {
            work: one.work,
            role: one.role,
            joinedAt: one.joinedAt,
            worktree: one.worktree,
          },
        ]),
      ),
      (was, now) =>
        was.work === now.work &&
        was.role === now.role &&
        was.joinedAt === now.joinedAt &&
        was.worktree === now.worktree,
      deps.publishMember,
    );
  };
  const publishReadings = (): void => {
    publishMoved(
      publishedReadings,
      deps.members.readings(),
      sameReading,
      deps.publishReading,
    );
  };
  const changed = (): void => {
    publishWorks();
    deps.records.schedule("works");
  };

  const sweepFiles = (): void => {
    void deps.workFiles
      .sweep([...works.keys()].map(workDirOf))
      .catch((err: unknown) => {
        deps.log.warn(
          { err },
          "kolu-server: the conductor could not delete the files of works it no longer keeps",
        );
      });
  };

  /** WHERE A WORK'S FILES ARE — the first member whose record named a
   *  worktree, host and all. Read before the members are dropped. */
  const worktreeOf = (
    id: WorkId,
  ): { host: string; worktree: string } | null => {
    for (const [ref, member] of deps.members.ofWork(id)) {
      const host = splitFleetTerminalRef(ref)?.host;
      if (member.worktree !== null && host !== undefined)
        return { host, worktree: member.worktree };
    }
    return null;
  };

  /** THE WORK IS OVER — keep its files, then cap the history. */
  const closeOut = async (
    id: WorkId,
    at: { host: string; worktree: string } | null,
  ): Promise<void> => {
    const ending = works.get(id);
    if (ending === undefined || ending.state.kind !== "ended") return;
    const paths = new Set(filesSeen(ending));
    if (at !== null) {
      try {
        for (const path of await deps.workFiles.list(at)) paths.add(path);
      } catch (err) {
        deps.log.warn(
          { err, work: id },
          "kolu-server: the conductor could not list a finished work's files",
        );
      }
    }
    const ended = works.get(id);
    if (ended !== undefined && at !== null && paths.size > 0) {
      try {
        const kept = await deps.workFiles.keep({
          ...at,
          work: workDirOf(id),
          paths: [...paths],
        });
        works.set(id, keepFiles(ended, { files: kept, at: nowIso() }));
      } catch (err) {
        works.set(id, keepFailed(ended, sentenceOf(err), nowIso()));
      }
    }
    for (const [dropped] of capFinished(everyWork(), FINISHED_KEPT).dropped)
      works.delete(dropped);
    sweepFiles();
    changed();
    deps.records.now("works");
  };

  /** WRITE A WORK BACK — and close it out when this is the change that ended
   *  it. The members go WITH the ending, in this one step: that is what makes
   *  "a finished work has no terminals" true rather than checked. */
  const save = (id: WorkId, work: Work): void => {
    const before = works.get(id);
    works.set(id, work);
    if (before === undefined || before.state.kind !== "open") return;
    if (work.state.kind !== "ended") return;
    const at = worktreeOf(id);
    const dropped = deps.members.dropWork(id);
    // THE QUESTIONS GO WITH IT — the one edge where a question stops being
    // answerable, because the work it is about is over. Recorded HERE rather
    // than handed back to the module that asks: the ending and the dropping
    // are one write by the one writer, so nothing re-enters this function
    // while the work is half-ended.
    const asks = dropOpenAsks(id, work, nowIso());
    if (asks.settled.length > 0) {
      works.set(id, asks.work);
      changed();
      deps.ended(asks.settled);
    }
    if (dropped.length > 0) {
      deps.records.schedule("members");
      deps.membersMoved(true);
    }
    void closeOut(id, at);
  };

  /** The work a terminal is a member of, if it is one. */
  const at = (ref: string): MemberAt | undefined => {
    const member = deps.members.at(ref);
    if (member === undefined) return undefined;
    const work = works.get(member.work);
    if (work === undefined || work.state.kind !== "open") return undefined;
    return { id: member.work, work, member };
  };

  const openAt = (id: WorkId): Work => {
    const work = works.get(id);
    if (work === undefined) {
      throw new WorkRefusal(
        "unknown-work",
        `There is no piece of work called ${JSON.stringify(id)} — read the \`works\` resource for the ones kolu is keeping, and open one with \`work_open\` (host, repo and branch) if this is new.`,
      );
    }
    if (work.state.kind !== "open") {
      throw new WorkRefusal(
        "work-ended",
        `«${work.title}» has ended (${work.state.outcome.kind}), so nothing joins it or is noted on it until it is opened again — \`work_open\` on the same host, repo and branch brings it back as it stands.`,
      );
    }
    return work;
  };

  const activeRefs = (): ReadonlyArray<string> =>
    [...deps.members.all()]
      .filter(([, one]) => works.get(one.work)?.state.kind === "open")
      .map(([ref]) => ref);

  /** THE LAST TERMINAL WENT — said once, and never as an ending. */
  const emptied = (id: WorkId): void => {
    const work = works.get(id);
    if (work === undefined || work.state.kind !== "open") return;
    if (deps.members.ofWork(id).length > 0) return;
    deps.noTerminals(id, work);
  };

  const leave = (ref: string, why: "closed" | "released" | "gone"): void => {
    const found = at(ref);
    deps.members.forget(ref);
    deps.records.schedule("members");
    deps.membersMoved(true);
    if (found === undefined) {
      changed();
      return;
    }
    save(found.id, leaveWork(found.work, { terminal: ref, why, at: nowIso() }));
    changed();
    emptied(found.id);
  };

  return {
    all: everyWork,
    get: (id) => works.get(id),
    at,
    openAt,
    leave,
    save,
    changed,
    publishWorks,
    publishReadings,
    sweepFiles,
    memberRefs: activeRefs,
    persisted: () => Object.fromEntries(works),
    read: () => [...inProgress(everyWork()), ...finished(everyWork())],
    openAsks: () =>
      inProgress(everyWork()).flatMap(([, work]) => openAsks(work)),
    openFor: ({ key, title, request }) => {
      const id = workIdOf(key);
      const held = works.get(id);
      if (held !== undefined) {
        // THE SAME WORK, AS IT STANDS. An ended one comes back open, decisions
        // and timeline whole; an open one is handed back untouched, and the
        // caller asks only the setup questions that have no answer.
        if (held.state.kind === "open")
          return { id, work: held, created: false, reopened: false };
        const again = reopenWork(held, nowIso());
        works.set(id, again);
        changed();
        return { id, work: again, created: false, reopened: true };
      }
      const work = openWork({ key, title, at: nowIso(), request });
      works.set(id, work);
      changed();
      return { id, work, created: true, reopened: false };
    },
    stop: (id, by) => {
      const work = openAt(id);
      const stopped = endWork(work, {
        outcome: { kind: "stopped", by },
        at: nowIso(),
      });
      save(id, stopped);
      changed();
      return stopped;
    },
    reopen: (id) => {
      const work = works.get(id);
      if (work === undefined) return openAt(id);
      const again = reopenWork(work, nowIso());
      works.set(id, again);
      changed();
      return again;
    },
    endWith: (id, outcome) => {
      const work = works.get(id);
      if (work === undefined || work.state.kind !== "open") return;
      save(id, endWork(work, { outcome, at: nowIso() }));
      changed();
    },
    declined: (id) => {
      const work = works.get(id);
      if (work === undefined) return false;
      // NOTHING HAS HAPPENED IN IT: no terminal ever joined, and no pull
      // request was ever seen. A work like that is not an ENDING anybody
      // wants to read about — it is a card that should never have been drawn.
      const happened = work.events.some(
        (one) => one.kind === "joined" || one.kind === "pr-opened",
      );
      if (happened) return false;
      works.delete(id);
      deps.members.dropWork(id);
      changed();
      sweepFiles();
      deps.records.now("works");
      return true;
    },
    load: (kept, members) => {
      for (const [id, work] of Object.entries(kept)) works.set(id, work);
      deps.members.load(members);
    },
    restore: (kept, members) => {
      const before = [...deps.members.all().keys()];
      works.clear();
      for (const [id, work] of Object.entries(kept)) works.set(id, work);
      deps.members.load(members);
      publishWorks();
      publishReadings();
      // The kept files of works this snapshot never had are unreachable from
      // here on, and the one sweep rule is what deletes them.
      sweepFiles();
      // NOT on the throttle: a restore's whole point is that what was there is
      // gone, and a window where the file still holds it is a window where the
      // next boot undoes the restore.
      deps.records.now("works");
      deps.records.now("members");
      deps.membersMoved(true);
      const still = new Set(activeRefs());
      return before.filter((ref) => !still.has(ref));
    },
    membersDetail: () =>
      [...deps.members.all()]
        .filter(([, one]) => works.get(one.work)?.state.kind === "open")
        .map(([ref, one]) => ({
          ref,
          work: one.work,
          role: one.role,
          name: one.name,
          agent: one.agent,
          joined: one.joined,
        })),
    join: (id, ref, role, how) => {
      const work = openAt(id);
      const already = deps.members.at(ref);
      // A TERMINAL ALREADY IN THIS WORK KEEPS THE ROLE IT WAS GIVEN FIRST, and
      // keeps what kolu already knows about it.
      if (already?.work === id) return;
      // ONE PLANNER, ONE IMPLEMENTOR. Refused rather than written: a store
      // with two is one `parseStore` would not read back, and the caller is
      // owed the sentence that says which terminal already has the part.
      const taken = deps.members.inRole(id, role);
      if (taken !== undefined && role !== "other") {
        throw new WorkRefusal(
          "role-taken",
          `«${work.title}» already has ${taken} as its ${role} — a piece of work has one planner and one implementor. Give this terminal the other role, or open a piece of work of its own for it.`,
        );
      }
      // ... and one doing something ELSE leaves that first: a terminal does
      // one piece of work at a time, and a member of two works is two cards
      // claiming the same agent.
      if (already !== undefined) leave(ref, "released");
      const at = nowIso();
      save(id, joinWork(works.get(id) ?? work, { terminal: ref, role, at }));
      deps.members.set(
        ref,
        joinedMember({ work: id, role, joinedAt: at, worktree: null }, how),
      );
      changed();
      deps.records.schedule("members");
      deps.membersMoved(true);
    },
    /** One sentence for every way a take over can be about the wrong terminal:
     *  it belongs to no work in progress, it has left, or its work is a
     *  `watch` (the person's own terminal, which kolu never types into) or has
     *  no mode decided yet. */
    driven: (ref) => {
      const found = at(ref);
      const driver =
        found === undefined ? null : driverOf(found.work, ref, found.member);
      if (found === undefined || driver === null) {
        throw new WorkRefusal(
          "not-driven",
          `kolu's Conductor is not driving ${ref}, so there is nothing to take over or hand back — only a member of a piece of work in progress that kolu runs (mode full or trivial) is driven.`,
        );
      }
      return { ...found, driver };
    },
    handover: (ref, what) => {
      const found = at(ref);
      if (found === undefined) return;
      const stamp = nowIso();
      save(
        found.id,
        what === "taken-over"
          ? takeOverRecord(found.work, ref, stamp)
          : handBackRecord(found.work, ref, stamp),
      );
      changed();
    },
  };
};
