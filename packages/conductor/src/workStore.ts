import { Option, Schema } from "effect";
import { notKeptWhy } from "kolu-common/workFiles";
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
  type RequestWords,
  takeOver as takeOverRecord,
  type Work,
  type WorkId,
  type WorkKey,
  type WorkMember,
  type WorkRole,
  WorkRefusal,
  workIdOf,
  workKeyOf,
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
import type { PrWatch } from "./observation.ts";
import type { PersistedMembers, PersistedWorks } from "./persisted.ts";
import type { RecordWrites } from "./recordWrites.ts";
import { type WorkFiles, workDirOf } from "./workFiles.ts";

export const FINISHED_KEPT = 20;

export interface MemberDetail {
  readonly ref: string;
  readonly work: WorkId;
  readonly role: WorkRole;
  readonly name: string;
  readonly agent: string | null;
  readonly joined: WatchJoin;
}

export interface MemberAt {
  readonly id: WorkId;
  readonly work: Work;
  readonly member: Member;
}

export interface Opened {
  readonly id: WorkId;
  readonly work: Work;
  readonly created: boolean;
  readonly reopened: boolean;
}

export interface WorkStore {
  readonly load: (kept: PersistedWorks, members: PersistedMembers) => void;
  readonly all: () => ReadonlyArray<readonly [WorkId, Work]>;
  readonly read: () => ReadonlyArray<readonly [WorkId, Work]>;
  readonly openAsks: () => ReadonlyArray<string>;
  readonly get: (id: WorkId) => Option.Option<Work>;
  readonly at: (ref: string) => MemberAt | undefined;
  readonly openAt: (id: WorkId) => Work;
  readonly openFor: (opened: {
    readonly key: WorkKey;
    readonly title: string;
    readonly request: RequestWords;
  }) => Opened;
  readonly save: (id: WorkId, work: Work) => void;
  readonly stop: (id: WorkId, by: "you" | "conductor") => Work;
  readonly reopen: (id: WorkId) => Work;
  readonly endWith: (id: WorkId, outcome: Outcome) => void;
  readonly leave: (ref: string, why: "closed" | "released" | "gone") => void;
  readonly join: (
    id: WorkId,
    ref: string,
    role: WorkRole,
    joined: WatchJoin,
  ) => void;
  readonly declined: (id: WorkId) => boolean;
  readonly driven: (ref: string) => MemberAt & { readonly driver: Driver };
  readonly handover: (ref: string, what: "taken-over" | "handed-back") => void;
  readonly restore: (
    kept: PersistedWorks,
    members: PersistedMembers,
  ) => ReadonlyArray<string>;
  readonly memberRefs: () => ReadonlyArray<string>;
  readonly membersDetail: () => ReadonlyArray<MemberDetail>;
  readonly changed: () => void;
  readonly publishWorks: () => void;
  readonly publishReadings: () => void;
  readonly persisted: () => PersistedWorks;
  readonly sweepFiles: () => void;
  readonly prWatches: () => ReadonlyArray<PrWatch>;
}

const sentenceOf = (err: unknown): string => {
  if (typeof err === "object" && err !== null && "why" in err) {
    const { why } = err;
    if (typeof why === "string" && why !== "") return why;
  }
  return err instanceof Error ? err.message : String(err);
};

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
  readonly worksMoved: () => void;
  readonly watchScopeMoved: () => void;
  readonly ended: (settled: ReadonlyArray<SettledAsk>) => void;
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

  const worktreeOf = (
    id: WorkId,
  ): Option.Option<{ host: string; worktree: string }> => {
    for (const [ref, member] of deps.members.ofWork(id)) {
      const host = splitFleetTerminalRef(ref)?.host;
      if (member.worktree.kind === "read" && host !== undefined)
        return Option.some({ host, worktree: member.worktree.path });
    }
    return Option.none();
  };

  const closeOut = async (
    id: WorkId,
    at: Option.Option<{ host: string; worktree: string }>,
  ): Promise<void> => {
    const ending = works.get(id);
    if (ending === undefined || ending.state.kind !== "ended") return;
    const paths = new Set(filesSeen(ending));
    let more = false;
    if (Option.isSome(at)) {
      try {
        const listed = await deps.workFiles.list(at.value);
        for (const path of listed.paths) paths.add(path);
        more = listed.more;
      } catch (err) {
        deps.log.warn(
          { err, work: id },
          "kolu-server: the conductor could not list a finished work's files",
        );
      }
    }
    const ended = works.get(id);
    if (ended !== undefined && Option.isSome(at) && paths.size > 0) {
      try {
        const done = await deps.workFiles.keep({
          ...at.value,
          work: workDirOf(id),
          paths: [...paths],
        });
        const kept = keepFiles(ended, { files: done.kept, at: nowIso() });
        works.set(
          id,
          Option.match(notKeptWhy({ tooBig: done.tooBig, more }), {
            onNone: () => kept,
            onSome: (why) => keepFailed(kept, why, nowIso()),
          }),
        );
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

  const save = (id: WorkId, work: Work): void => {
    const before = works.get(id);
    works.set(id, work);
    if (before === undefined || before.state.kind !== "open") return;
    if (work.state.kind !== "ended") return;
    const at = worktreeOf(id);
    const dropped = deps.members.dropWork(id);
    const asks = dropOpenAsks(id, work, nowIso());
    if (asks.settled.length > 0) {
      works.set(id, asks.work);
      changed();
      deps.ended(asks.settled);
    }
    if (dropped.length > 0) deps.records.schedule("members");
    deps.worksMoved();
    deps.watchScopeMoved();
    void closeOut(id, at);
  };

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

  const prWatches = (): ReadonlyArray<PrWatch> => {
    const watches: PrWatch[] = [];
    for (const [id, work] of works) {
      if (work.state.kind !== "open") continue;
      const key = workKeyOf(id);
      if (Option.isNone(key) || key.value.kind !== "branch") continue;
      watches.push({
        work: id,
        host: key.value.host,
        repo: key.value.repo,
        branch: key.value.branch,
      });
    }
    return watches;
  };

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
    deps.worksMoved();
    deps.watchScopeMoved();
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
    get: (id) => Option.fromUndefinedOr(works.get(id)),
    at,
    openAt,
    leave,
    save,
    changed,
    publishWorks,
    publishReadings,
    sweepFiles,
    memberRefs: activeRefs,
    prWatches,
    persisted: () => Object.fromEntries(works),
    read: () => [...inProgress(everyWork()), ...finished(everyWork())],
    openAsks: () =>
      inProgress(everyWork()).flatMap(([, work]) => openAsks(work)),
    openFor: ({ key, title, request }) => {
      const id = workIdOf(key);
      const held = works.get(id);
      if (held !== undefined) {
        if (held.state.kind === "open")
          return { id, work: held, created: false, reopened: false };
        const again = reopenWork(held, nowIso());
        works.set(id, again);
        changed();
        deps.worksMoved();
        deps.watchScopeMoved();
        return { id, work: again, created: false, reopened: true };
      }
      const work = openWork({ key, title, at: nowIso(), request });
      works.set(id, work);
      changed();
      deps.worksMoved();
      deps.watchScopeMoved();
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
      deps.worksMoved();
      deps.watchScopeMoved();
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
      const happened = work.events.some(
        (one) => one.kind === "joined" || one.kind === "pr-opened",
      );
      if (happened) return false;
      works.delete(id);
      deps.members.dropWork(id);
      changed();
      sweepFiles();
      deps.records.now("works");
      deps.worksMoved();
      deps.watchScopeMoved();
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
      sweepFiles();
      deps.records.now("works");
      deps.records.now("members");
      deps.worksMoved();
      deps.watchScopeMoved();
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
      if (already?.work === id) return;
      const taken = deps.members.inRole(id, role);
      if (taken !== undefined && role !== "other") {
        throw new WorkRefusal(
          "role-taken",
          `«${work.title}» already has ${taken} as its ${role} — a piece of work has one planner and one implementor. Give this terminal the other role, or open a piece of work of its own for it.`,
        );
      }
      if (already !== undefined) leave(ref, "released");
      const at = nowIso();
      save(id, joinWork(works.get(id) ?? work, { terminal: ref, role, at }));
      deps.members.set(
        ref,
        joinedMember(
          { work: id, role, joinedAt: at, worktree: { kind: "unread" } },
          how,
        ),
      );
      changed();
      deps.records.schedule("members");
      deps.worksMoved();
      deps.watchScopeMoved();
    },
    driven: (ref) => {
      const found = at(ref);
      const driver = Option.match(Option.fromUndefinedOr(found), {
        onNone: (): Driver => "nobody",
        onSome: (one) => driverOf(one.work, ref, Option.some(one.member)),
      });
      if (found === undefined || driver === "nobody") {
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
