/**
 * THE PIECES OF WORK KOLU HOLDS — the map, every rule for moving one, and what
 * a reader is told about them.
 *
 * One module for what used to be four concerns braided through the
 * conversation's closure: the map itself, the end-of-work consequences (keep
 * the files, cap the history, sweep what fell off), the DRIVER lock, and the
 * publish diff. They are one concern wearing four hats — "how kolu holds and
 * announces a set of works" — and they move on one clock.
 *
 * ## Insertion order IS the contract
 *
 * A work sits where it was opened, so a card keeps its place for as long as it
 * is in progress.
 *
 * ## What this module does NOT hold
 *
 * The member's own bookkeeping (`./memberStore.ts`), what an observation MEANS
 * (`./observing.ts`), when news reaches the conversation (`./wakes.ts`). Its
 * one edge to the wake lane is `told`, which reaches it as a port on the
 * member store rather than as an import.
 */

import { Schema } from "effect";
import { type MemberReading, MemberReadingSchema } from "kolu-common/works";
import {
  capFinished,
  deserted,
  driverOf,
  dropAsk,
  endWork,
  filesSeen,
  finished,
  handBack as handBackRecord,
  inProgress,
  joinWork,
  keepFailed,
  keepFiles,
  leaveWork,
  openAsks,
  takeOver as takeOverRecord,
  type Driver,
  type Work,
  type WorkMember,
  type WorkRole,
  WorkRefusal,
} from "kolu-work";
import type { Logger } from "pino";
import { splitFleetTerminalRef } from "kolu-mcp/fleetRef";
import { joinedMember, type WatchJoin } from "./members.ts";
import type { MemberStore } from "./memberStore.ts";
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

/** One member, as a reader outside this package is told about it: the record's
 *  own fields plus what kolu has SEEN in that terminal. */
export interface MemberDetail {
  readonly ref: string;
  readonly work: string;
  readonly role: WorkRole;
  readonly name: string;
  readonly agent: string | null;
  readonly joined: WatchJoin;
}

/** The work a terminal is an ACTIVE member of, and that member. */
export interface MemberAt {
  readonly work: Work;
  readonly member: WorkMember;
}

export interface WorkStore {
  /** The boot read: the remembered works (every question they had open
   *  dropped — the conversation that asked it is gone) and the member
   *  bookkeeping that goes with their active members. */
  readonly load: (kept: PersistedWorks, was: PersistedMembers) => void;
  /** Every work, in the order they were opened. */
  readonly all: () => ReadonlyArray<Work>;
  /** The works a READER is given: in progress oldest first, then the finished
   *  ones newest first. */
  readonly read: () => ReadonlyArray<Work>;
  readonly get: (id: string) => Work | undefined;
  readonly at: (ref: string) => MemberAt | undefined;
  /** A work that exists and has not ended, or the refusal that says which of
   *  the two it failed. */
  readonly openAt: (id: string) => Work;
  /** Mint a work and put it in the map. */
  readonly open: (work: Work) => void;
  /** Write a work back — and close it out when this is the change that ended
   *  it. */
  readonly save: (work: Work) => void;
  /** A member leaves; the work with the departure recorded. */
  readonly leave: (
    work: Work,
    ref: string,
    why: "closed" | "released" | "gone",
  ) => Work;
  /** A terminal joins a work in a role, leaving whatever else it was doing. */
  readonly join: (
    id: string,
    ref: string,
    role: WorkRole,
    joined: WatchJoin,
  ) => void;
  /** A MEMBER TERMINAL THE CONDUCTOR DRIVES, and who is driving it — or the
   *  refusal that says it is none. */
  readonly driven: (ref: string) => MemberAt & { readonly driver: Driver };
  /** The keys changed hands: the act, on the work's timeline. */
  readonly handover: (ref: string, what: "taken-over" | "handed-back") => void;
  /** Every question every work in progress has open, dropped — the wipe. */
  readonly dropOpenAsks: (at: string) => void;
  /** EVERY WORK, REPLACED — a restored backup. Answers the refs that are no
   *  longer members of anything, so the caller can drop what it was holding
   *  about them. */
  readonly restore: (
    kept: PersistedWorks,
    was: PersistedMembers,
  ) => ReadonlyArray<string>;
  /** THE WATCHER'S SCOPE — the active members of every work in progress. */
  readonly memberRefs: () => ReadonlyArray<string>;
  /** ... and the same members with what kolu knows about each. */
  readonly membersDetail: () => ReadonlyArray<MemberDetail>;
  /** The works moved: every reader told, and the file owed a write. */
  readonly changed: () => void;
  /** Just the readers — for the edges that write the file themselves. */
  readonly publishWorks: () => void;
  /** ... and the same for how the member terminals stand, on its own clock: a
   *  level change is not a change to the record. */
  readonly publishReadings: () => void;
  /** What the `works` key holds. */
  readonly persisted: () => PersistedWorks;
  /** THE KEPT FILES, RECONCILED TO THE WORKS — one rule, run wherever the set
   *  of works can shrink. */
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
 *
 * Two collections, one rule: a key whose value is not what was last sent goes
 * out, a key that has gone is removed, and everything else is silence. The
 * equivalence is the argument because the two values answer it differently and
 * both answers are right — a work is an IMMUTABLE value, so identity is the
 * cheap correct test, while a reading is a fresh pair every observation and is
 * compared by what it says (through its own schema, so a field added to it is
 * compared without an edit here).
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

export const workStore = (deps: {
  readonly workFiles: WorkFiles;
  readonly publishWork: (id: string, work: Work | null) => void;
  readonly publishReading: (
    terminal: string,
    reading: MemberReading | null,
  ) => void;
  readonly membersMoved: (membership: boolean) => void;
  readonly records: RecordWrites<"works" | "members">;
  readonly members: MemberStore;
  readonly log: Logger;
}): WorkStore => {
  const works = new Map<string, Work>();
  const publishedWorks = new Map<string, Work>();
  const publishedReadings = new Map<string, MemberReading>();
  const sameReading = Schema.toEquivalence(MemberReadingSchema);
  const nowIso = (): string => new Date().toISOString();

  const everyWork = (): ReadonlyArray<Work> => [...works.values()];

  const publishWorks = (): void => {
    publishMoved(
      publishedWorks,
      works,
      (was, now) => was === now,
      deps.publishWork,
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
    void deps.workFiles.sweep([...works.keys()]).catch((err: unknown) => {
      deps.log.warn(
        { err },
        "kolu-server: the conductor could not delete the files of works it no longer keeps",
      );
    });
  };

  /** WHERE A WORK'S FILES ARE — the first member whose record named a
   *  worktree, host and all.
   *
   *  Any member will do and the first is as good as the last: a work's members
   *  share a worktree by construction (the planner opens it, the implementor
   *  is a split in the same one), and a member whose terminal is long gone
   *  still remembers the path — which is the case this is written for, because
   *  a work usually ends after its terminals have. */
  const worktreeOf = (
    work: Work,
  ): { host: string; worktree: string } | null => {
    for (const member of work.members) {
      const host = splitFleetTerminalRef(member.terminal)?.host;
      if (member.worktree !== null && host !== undefined)
        return { host, worktree: member.worktree };
    }
    return null;
  };

  /** THE WORK IS OVER — keep its files, then cap the history.
   *
   *  The files are gathered from both ends: what kolu SAW appear
   *  (`filesSeen`) and what is in `.waterfall/` right now, because a file
   *  written while nothing changed level was never observed and is still the
   *  plan somebody will want to read next month. A copy that fails is SAID on
   *  the timeline rather than swallowed — the files are the half of a work
   *  that outlives its worktree, and a person has to know they did not.
   *
   *  Then the cap: the {@link FINISHED_KEPT} most recently finished works are
   *  kept and the rest are forgotten, kept files and all. Written immediately
   *  rather than on the throttle — an end and a cap are the two movements
   *  whose whole point is that what was there is gone. */
  const closeOut = async (id: string): Promise<void> => {
    const ending = works.get(id);
    if (ending === undefined || ending.endedAt === null) return;
    const at = worktreeOf(ending);
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
          work: id,
          paths: [...paths],
        });
        works.set(id, keepFiles(ended, { files: kept, at: nowIso() }));
      } catch (err) {
        works.set(id, keepFailed(ended, sentenceOf(err), nowIso()));
      }
    }
    for (const dropped of capFinished(everyWork(), FINISHED_KEPT).dropped)
      works.delete(dropped.id);
    sweepFiles();
    changed();
    deps.records.now("works");
  };

  /** WRITE A WORK BACK — and close it out when this is the change that ended
   *  it.
   *
   *  Two endings are decided here rather than at each call site, because both
   *  are consequences of a change rather than things anybody asks for: a work
   *  whose every member has gone is ABANDONED, and a work that has just ended
   *  (however it ended) owes its files a copy and the history a cap. */
  const save = (work: Work): void => {
    const before = works.get(work.id);
    const ended =
      work.endedAt === null && deserted(work)
        ? endWork(work, { outcome: "abandoned", at: nowIso() })
        : work;
    works.set(ended.id, ended);
    if (
      before !== undefined &&
      before.endedAt === null &&
      ended.endedAt !== null
    )
      void closeOut(ended.id);
  };

  /** The work a terminal is an ACTIVE member of, if it is one — and only ever
   *  a work IN PROGRESS. A finished work's members are history, and a reading
   *  that arrived late must not re-open one. */
  const at = (ref: string): MemberAt | undefined => {
    for (const work of works.values()) {
      if (work.endedAt !== null) continue;
      const member = work.members.find(
        (one) => one.terminal === ref && one.leftAt === null,
      );
      if (member !== undefined) return { work, member };
    }
    return undefined;
  };

  const leave = (
    work: Work,
    ref: string,
    why: "closed" | "released" | "gone",
  ): Work => {
    deps.members.forget(ref);
    return leaveWork(work, { terminal: ref, at: nowIso(), why });
  };

  const openAt = (id: string): Work => {
    const work = works.get(id);
    if (work === undefined) {
      throw new WorkRefusal(
        "unknown-work",
        `There is no piece of work called ${JSON.stringify(id)} — read the \`works\` resource for the ones kolu is keeping, and open one with \`work_open\` if this is new.`,
      );
    }
    if (work.endedAt !== null) {
      throw new WorkRefusal(
        "work-ended",
        `«${work.title}» has ended (${work.outcome ?? "ended"}), so nothing more joins it, is asked about it or is noted on it. Open a new piece of work for what comes next.`,
      );
    }
    return work;
  };

  const activeRefs = (): ReadonlyArray<string> =>
    everyWork().flatMap((work) =>
      work.endedAt !== null
        ? []
        : work.members
            .filter((one) => one.leftAt === null)
            .map((one) => one.terminal),
    );

  /** EVERY OPEN QUESTION GOES, at the edge that found it: the conversation
   *  holding that promise is gone, so nobody can answer it any more and a
   *  decision left `null` would make the card say a person is being waited on
   *  for ever. */
  const withoutOpenAsks = (work: Work, at: string): Work =>
    openAsks(work).reduce((one, askId) => dropAsk(one, askId, at), work);

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
    persisted: everyWork,
    read: () => [...inProgress(everyWork()), ...finished(everyWork())],
    open: (work) => {
      save(work);
    },
    load: (kept, was) => {
      const at = nowIso();
      for (const work of kept) works.set(work.id, withoutOpenAsks(work, at));
      deps.members.reseed(activeRefs(), was);
    },
    restore: (kept, was) => {
      const at = nowIso();
      const before = Object.keys(deps.members.saved());
      works.clear();
      for (const work of kept) works.set(work.id, withoutOpenAsks(work, at));
      const refs = activeRefs();
      deps.members.reseed(refs, was);
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
      // A terminal the snapshot does not have as a member has nothing left to
      // read — and nothing left to say about it either, which is the caller's
      // to act on.
      const still = new Set(refs);
      return before.filter((ref) => !still.has(ref));
    },
    membersDetail: () =>
      everyWork().flatMap((work) =>
        work.endedAt !== null
          ? []
          : work.members
              .filter((one) => one.leftAt === null)
              .map((one) => {
                const member = deps.members.at(one.terminal);
                return {
                  ref: one.terminal,
                  work: work.id,
                  role: one.role,
                  name: member?.name ?? "",
                  agent: member?.agent ?? null,
                  joined: member?.joined ?? "asked",
                };
              }),
      ),
    join: (id, ref, role, joined) => {
      const work = openAt(id);
      const already = at(ref);
      // A TERMINAL ALREADY IN THIS WORK KEEPS THE ROLE IT WAS GIVEN FIRST, and
      // keeps what kolu already knows about it — what it was told, whether
      // anything has been said to it, whether its command ran.
      if (already?.work.id === id) return;
      // ... and one doing something ELSE leaves that first: a terminal does
      // one piece of work at a time, and a member of two works is two cards
      // claiming the same agent.
      if (already !== undefined) save(leave(already.work, ref, "released"));
      save(
        joinWork(works.get(id) ?? work, {
          terminal: ref,
          role,
          at: nowIso(),
        }),
      );
      deps.members.set(ref, joinedMember(joined));
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
      const driver = found === undefined ? null : driverOf(found.work, ref);
      if (found === undefined || driver === null) {
        throw new WorkRefusal(
          "not-driven",
          `kolu's Conductor is not driving ${ref}, so there is nothing to take over or hand back — only an active member of a piece of work in progress that kolu runs (mode full or trivial) is driven.`,
        );
      }
      return { ...found, driver };
    },
    handover: (ref, what) => {
      const found = at(ref);
      if (found === undefined) return;
      const stamp = nowIso();
      save(
        what === "taken-over"
          ? takeOverRecord(found.work, ref, stamp)
          : handBackRecord(found.work, ref, stamp),
      );
    },
    dropOpenAsks: (at) => {
      for (const work of inProgress(everyWork())) {
        const dropped = withoutOpenAsks(work, at);
        if (dropped !== work) save(dropped);
      }
    },
  };
};
