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
import { type PrResult, PrResultSchema } from "@kolu/terminal-vocab/schema";
import { Option, Schema } from "effect";
import { notKeptWhy } from "kolu-common/workFiles";
import { type MemberReading, MemberReadingSchema } from "kolu-common/works";
import type { WorkCodeView } from "kolu-common/works";
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
  parseStore,
  hostOf,
  reopenWork,
  type RequestWords,
  takeOver as takeOverRecord,
  type Work,
  type WorkId,
  type WorkKey,
  type WorkMember,
  type WorkRole,
  WorkRefusal,
  type WorkStoreValue,
  workIdOf,
  workKeyOf,
} from "kolu-work";
import type { Logger } from "pino";
import { dropOpenAsks, type SettledAsk } from "./askNews.ts";
import type { WatchJoin } from "./members.ts";
import {
  joined as joinedMember,
  type Member,
  type MemberStore,
  memberView,
  restoredAll,
} from "./memberStore.ts";
import type { BranchWatch } from "./observation.ts";
import type {
  PersistedMembers,
  PersistedWorkCodeViews,
  PersistedWorks,
} from "./persisted.ts";
import type { RecordWrites } from "./recordWrites.ts";
import type { WorkCodeViewStore } from "./workCodeViewStore.ts";
import { type WorkFiles, workDirOf } from "./workFiles.ts";

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
  /** THE MEMBERS, as the other half of the store's one value: read here,
   *  and every write parsed with the works before it is assigned. */
  readonly members: MemberStore;
  /** The boot read: the remembered works, the members that go with them, and
   *  where each work's Code view stood. */
  readonly load: (
    kept: PersistedWorks,
    members: PersistedMembers,
    views: PersistedWorkCodeViews,
  ) => void;
  /** Every work with its id, in the order they were opened. */
  readonly all: () => ReadonlyArray<readonly [WorkId, Work]>;
  /** The works a READER is given: in progress oldest first, then the finished
   *  ones newest first. */
  readonly read: () => ReadonlyArray<readonly [WorkId, Work]>;
  /** EVERY QUESTION STILL WAITING ON A PERSON, across the works in progress —
   *  ask ids, oldest work first. Derived from the decisions like every other
   *  reading of "what is open", so no second list can disagree with the
   *  cards. Published as the frame's `workAsks`, which a browser hears before
   *  the works' own records arrive. */
  readonly openAsks: () => ReadonlyArray<string>;
  /** The work by that id — none for an id kolu holds no work for, which is
   *  what an agent naming a work it never opened hands in. */
  readonly get: (id: WorkId) => Option.Option<Work>;
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
    readonly request: RequestWords;
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
  /** EVERY WORK, REPLACED — a restored backup, with its members and its
   *  works' Code views. Answers the refs that are no longer members of
   *  anything. */
  readonly restore: (
    kept: PersistedWorks,
    members: PersistedMembers,
    views: PersistedWorkCodeViews,
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
  /** WHAT THE WORK'S OWN PR WATCH READ, kept live and published — the
   *  `workPrs` collection. Held only while the work is an open branch work;
   *  anything else is dropped by the same pass that publishes the works. */
  readonly prRead: (id: WorkId, reading: PrResult) => void;
  /** What the `works` key holds. */
  readonly persisted: () => PersistedWorks;
  /** PUT A WORK'S CODE VIEW WHERE A PERSON LEFT IT — refused for a work kolu
   *  does not hold, so no view is made without its work, as none outlives
   *  one. An equal write is dropped by the view store. */
  readonly setCodeView: (id: WorkId, view: WorkCodeView) => void;
  /** THE PULL-REQUEST WATCH'S SCOPE — every work IN PROGRESS that is a branch
   *  on a machine. Read off the works' own keys, so there is no second list
   *  that can disagree with the cards. */
  readonly branchWatches: () => ReadonlyArray<BranchWatch>;
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
  /** ... and ONE WORK'S LIVE PULL REQUEST — `null` once its work ended or
   *  went. */
  readonly publishPr: (id: WorkId, pr: PrResult | null) => void;
  /** A WORK, A MEMBER ROW OR A READING MOVED — every reader of the `works`
   *  resource is owed a redraw. */
  readonly worksMoved: () => void;
  /** THE WATCH'S SCOPE MAY HAVE MOVED — a member joined or left, or a branch
   *  gained or lost work in flight. Two lists, one sink, because the watcher
   *  re-chooses both from one read; it compares the scope itself, so saying
   *  this when nothing moved costs one comparison. */
  readonly watchScopeMoved: () => void;
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
  /** Where each work's Code view stands — kept exactly as long as its work,
   *  by the store's one rule for a work going (`forgetGone`). */
  readonly views: WorkCodeViewStore;
  readonly log: Logger;
}

export const workStore = (deps: WorkStoreDeps): WorkStore => {
  /** THE WORKS AND THEIR MEMBERS, AS ONE VALUE — replaced whole, and only by
   *  {@link commit}, which parses it first. A next value that breaks one of
   *  the store's rules (`kolu-work`'s `parseStore`) is a thrown defect and is
   *  never assigned: a transition that forgets an ordering is found at the
   *  write that made it, not at the next boot's recovery screen. */
  let value: WorkStoreValue<Member> = parseStore(new Map(), new Map());
  const commit = (
    works: ReadonlyMap<WorkId, Work>,
    members: ReadonlyMap<string, Member>,
  ): void => {
    value = parseStore(works, members);
  };
  /** One work written back, the members as they stand. */
  const setWork = (id: WorkId, work: Work): void => {
    const next = new Map(value.works);
    next.set(id, work);
    commit(next, value.members);
  };
  /** The works as they are, minus `gone`, and every member of each with
   *  them — in the one commit, so no member outlives its work. */
  const dropWorks = (gone: ReadonlyArray<WorkId>): void => {
    if (gone.length === 0) return;
    const dropped = new Set(gone);
    commit(
      new Map([...value.works].filter(([id]) => !dropped.has(id))),
      new Map([...value.members].filter(([, one]) => !dropped.has(one.work))),
    );
  };
  /** The members' face onto the same value. */
  const members = memberView(
    () => value.members,
    (next) => commit(value.works, next),
  );
  const publishedWorks = new Map<WorkId, Work>();
  const publishedMembers = new Map<string, WorkMember>();
  const publishedReadings = new Map<string, MemberReading>();
  const sameReading = Schema.toEquivalence(MemberReadingSchema);
  /** EACH OPEN BRANCH WORK'S PR, as its watch last read it — the forge's
   *  answer for the work's own key, never a member's. */
  const livePrs = new Map<WorkId, PrResult>();
  const publishedPrs = new Map<WorkId, PrResult>();
  const samePr = Schema.toEquivalence(PrResultSchema);
  const nowIso = (): string => new Date().toISOString();

  const everyWork = (): ReadonlyArray<readonly [WorkId, Work]> => [
    ...value.works,
  ];

  /** THE LIVE PRs, PUBLISHED — after dropping every one whose work is no
   *  longer an open branch work, so an ended work's mark goes with it. */
  const publishPrs = (): void => {
    for (const id of [...livePrs.keys()]) {
      const work = value.works.get(id);
      if (work?.state.kind !== "open" || work.key.kind !== "branch")
        livePrs.delete(id);
    }
    publishMoved(publishedPrs, livePrs, samePr, deps.publishPr);
  };

  const publishWorks = (): void => {
    publishMoved(
      publishedWorks,
      value.works,
      (was, now) => was === now,
      deps.publishWork,
    );
    publishMoved(
      publishedMembers,
      new Map(
        [...members.all()].map(([ref, one]) => [
          ref,
          { work: one.work, role: one.role, joinedAt: one.joinedAt },
        ]),
      ),
      (was, now) =>
        was.work === now.work &&
        was.role === now.role &&
        was.joinedAt === now.joinedAt,
      deps.publishMember,
    );
    publishPrs();
  };
  const publishReadings = (): void => {
    publishMoved(
      publishedReadings,
      members.readings(),
      sameReading,
      deps.publishReading,
    );
  };
  const changed = (): void => {
    publishWorks();
    deps.records.schedule("works");
  };

  /** NO VIEW WITHOUT ITS WORK — the half of the rule that lets a view go.
   *  Every place the works are replaced or lose one asks it. */
  const viewsKeepTheirWorks = (): void =>
    deps.views.keepOnly(new Set(value.works.keys()));

  /** THE RULE FOR EVERY WAY A WORK GOES — the finished cap, a declined card,
   *  a restored backup that lacks it: what it left behind goes too. Its kept
   *  files are swept, and its Code view is forgotten, so neither outlives the
   *  work. Said here once; the three places a work goes each ask it. */
  const forgetGone = (): void => {
    viewsKeepTheirWorks();
    void deps.workFiles
      .sweep([...value.works.keys()].map(workDirOf))
      .catch((err: unknown) => {
        deps.log.warn(
          { err },
          "kolu-server: the conductor could not delete the files of works it no longer keeps",
        );
      });
  };

  /** WHERE A WORK'S FILES ARE — the folder git last named for the work's own
   *  key, on the key's host, which outlives its terminals. */
  const worktreeOf = (
    work: Work,
  ): Option.Option<{ host: string; worktree: string }> =>
    work.worktree.kind === "at"
      ? Option.some({ host: hostOf(work), worktree: work.worktree.path })
      : Option.none();

  /** THE WORK IS OVER — keep its files, then cap the history. */
  const closeOut = async (
    id: WorkId,
    at: Option.Option<{ host: string; worktree: string }>,
  ): Promise<void> => {
    const ending = value.works.get(id);
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
    const ended = value.works.get(id);
    if (ended !== undefined && Option.isSome(at) && paths.size > 0) {
      try {
        const done = await deps.workFiles.keep({
          ...at.value,
          work: workDirOf(id),
          paths: [...paths],
        });
        const kept = keepFiles(ended, { files: done.kept, at: nowIso() });
        setWork(
          id,
          Option.match(notKeptWhy({ tooBig: done.tooBig, more }), {
            onNone: () => kept,
            onSome: (why) => keepFailed(kept, why, nowIso()),
          }),
        );
      } catch (err) {
        setWork(id, keepFailed(ended, sentenceOf(err), nowIso()));
      }
    }
    dropWorks(
      capFinished(everyWork(), FINISHED_KEPT).dropped.map(
        ([dropped]) => dropped,
      ),
    );
    forgetGone();
    changed();
    deps.records.now("works");
  };

  /** WRITE A WORK BACK — and close it out when this is the change that ended
   *  it. The members go WITH the ending, in this one commit: that is what
   *  makes "a finished work has no terminals" true rather than checked. */
  const save = (id: WorkId, work: Work): void => {
    const before = value.works.get(id);
    if (before?.state.kind !== "open" || work.state.kind !== "ended") {
      setWork(id, work);
      return;
    }
    const at = worktreeOf(work);
    // THE QUESTIONS GO WITH IT — the one edge where a question stops being
    // answerable, because the work it is about is over. Recorded HERE rather
    // than handed back to the module that asks: the ending, the dropping and
    // the members leaving are one write by the one writer, so nothing
    // re-enters this function while the work is half-ended.
    const asks = dropOpenAsks(id, work, nowIso());
    const nextWorks = new Map(value.works);
    nextWorks.set(id, asks.work);
    const nextMembers = new Map(
      [...value.members].filter(([, one]) => one.work !== id),
    );
    const dropped = value.members.size - nextMembers.size;
    commit(nextWorks, nextMembers);
    if (asks.settled.length > 0) {
      changed();
      deps.ended(asks.settled);
    }
    // THE WATCH'S SCOPE MOVED — this work is no longer in progress, so its
    // branch's pull request is no longer watched, and any terminals it had
    // left with the ending. Said whether or not there were any to lose:
    // a work whose PR was merged after its terminals were already closed is
    // the case this round exists for, and the scope moved all the same.
    if (dropped > 0) deps.records.schedule("members");
    deps.worksMoved();
    deps.watchScopeMoved();
    void closeOut(id, at);
  };

  /** The work a terminal is a member of, if it is one. */
  const at = (ref: string): MemberAt | undefined => {
    const member = members.at(ref);
    if (member === undefined) return undefined;
    const work = value.works.get(member.work);
    if (work === undefined || work.state.kind !== "open") return undefined;
    return { id: member.work, work, member };
  };

  const openAt = (id: WorkId): Work => {
    const work = value.works.get(id);
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
    [...members.all()]
      .filter(([, one]) => value.works.get(one.work)?.state.kind === "open")
      .map(([ref]) => ref);

  /** THE SCOPE OF PR OBSERVATION, and the only statement of it: the branches
   *  whose pull requests are watched are the works IN PROGRESS whose key is a
   *  branch on a machine, and nothing else.
   *
   *  A FINISHED WORK IS NOT WATCHED. The forge can end a work (a merge, a
   *  close) but it cannot bring one back: once a work is over, kolu stops
   *  asking about its branch, and the only ways back are a person pressing
   *  Reopen on the card and `work_open` on the same key. The alternative —
   *  a leg per finished branch, polling a forge every 30 s for twenty works
   *  nobody is doing — buys a transition nobody asked for.
   *
   *  The key IS the answer — it carries the host, the repository and the
   *  branch — so nothing here re-derives a work's identity from a member's
   *  record. */
  const branchWatches = (): ReadonlyArray<BranchWatch> => {
    const watches: BranchWatch[] = [];
    for (const [id, work] of value.works) {
      if (work.state.kind !== "open") continue;
      const key = workKeyOf(id);
      // An id that is no work key at all cannot be watched, and neither can a
      // WATCH: a pull request is a fact about a branch.
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

  /** THE LAST TERMINAL WENT — said once, and never as an ending. */
  const emptied = (id: WorkId): void => {
    const work = value.works.get(id);
    if (work === undefined || work.state.kind !== "open") return;
    if (members.ofWork(id).length > 0) return;
    deps.noTerminals(id, work);
  };

  const leave = (ref: string, why: "closed" | "released" | "gone"): void => {
    const found = at(ref);
    members.forget(ref);
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
    members,
    all: everyWork,
    get: (id) => Option.fromUndefinedOr(value.works.get(id)),
    at,
    openAt,
    leave,
    save,
    changed,
    publishWorks,
    publishReadings,
    prRead: (id, reading) => {
      const work = value.works.get(id);
      if (work?.state.kind !== "open" || work.key.kind !== "branch") return;
      livePrs.set(id, reading);
      publishPrs();
    },
    setCodeView: (id, view) => {
      if (!value.works.has(id)) {
        throw new WorkRefusal(
          "unknown-work",
          `kolu holds no piece of work called ${JSON.stringify(id)}, so there is no Code view of it to keep — it may have ended and dropped off the finished list, or been declined.`,
        );
      }
      deps.views.set(id, view);
    },
    memberRefs: activeRefs,
    branchWatches,
    persisted: () => Object.fromEntries(value.works),
    read: () => [...inProgress(everyWork()), ...finished(everyWork())],
    openAsks: () =>
      inProgress(everyWork()).flatMap(([, work]) => openAsks(work)),
    openFor: ({ key, title, request }) => {
      const id = workIdOf(key);
      const held = value.works.get(id);
      if (held !== undefined) {
        // THE SAME WORK, AS IT STANDS. An ended one comes back open, decisions
        // and timeline whole; an open one is handed back untouched, and the
        // caller asks only the setup questions that have no answer.
        if (held.state.kind === "open")
          return { id, work: held, created: false, reopened: false };
        const again = reopenWork(held, nowIso());
        setWork(id, again);
        changed();
        // A WORK IN PROGRESS AGAIN: it has no members (the ending took them),
        // and its branch's pull request is watched from now on — so the watch
        // re-chooses its legs off a move nothing else would announce.
        deps.worksMoved();
        deps.watchScopeMoved();
        return { id, work: again, created: false, reopened: true };
      }
      const work = openWork({ key, title, at: nowIso(), request });
      setWork(id, work);
      changed();
      // ... and the same for a work that has just come into being: it has no
      // members yet, and its PR is watched before it ever gets one.
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
      const work = value.works.get(id);
      if (work === undefined) return openAt(id);
      const again = reopenWork(work, nowIso());
      setWork(id, again);
      changed();
      deps.worksMoved();
      deps.watchScopeMoved();
      return again;
    },
    endWith: (id, outcome) => {
      const work = value.works.get(id);
      if (work === undefined || work.state.kind !== "open") return;
      save(id, endWork(work, { outcome, at: nowIso() }));
      changed();
    },
    declined: (id) => {
      const work = value.works.get(id);
      if (work === undefined) return false;
      // NOTHING HAS HAPPENED IN IT: no terminal ever joined, and no pull
      // request was ever seen. A work like that is not an ENDING anybody
      // wants to read about — it is a card that should never have been drawn.
      const happened = work.events.some(
        (one) => one.kind === "joined" || one.kind === "pr-opened",
      );
      if (happened) return false;
      dropWorks([id]);
      changed();
      forgetGone();
      deps.records.now("works");
      // The card never existed, and neither does its watch.
      deps.worksMoved();
      deps.watchScopeMoved();
      return true;
    },
    load: (kept, held, views) => {
      commit(new Map(Object.entries(kept)), restoredAll(held));
      deps.views.load(views);
      // A view whose work the file no longer holds has nothing to stand in.
      viewsKeepTheirWorks();
    },
    restore: (kept, held, views) => {
      const before = [...members.all().keys()];
      commit(new Map(Object.entries(kept)), restoredAll(held));
      deps.views.restore(views);
      publishWorks();
      publishReadings();
      // The kept files of works this snapshot never had are unreachable from
      // here on, and a view whose work the snapshot lacks has nothing to
      // stand in: the one rule takes both.
      forgetGone();
      // NOT on the throttle: a restore's whole point is that what was there is
      // gone, and a window where the file still holds it is a window where the
      // next boot undoes the restore.
      deps.records.now("works");
      deps.records.now("members");
      deps.worksMoved();
      deps.watchScopeMoved();
      const still = new Set(activeRefs());
      return before.filter((ref) => !still.has(ref));
    },
    membersDetail: () =>
      [...members.all()]
        .filter(([, one]) => value.works.get(one.work)?.state.kind === "open")
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
      const already = members.at(ref);
      // A TERMINAL ALREADY IN THIS WORK KEEPS THE ROLE IT WAS GIVEN FIRST, and
      // keeps what kolu already knows about it.
      if (already?.work === id) return;
      // ONE PLANNER, ONE IMPLEMENTOR. Refused rather than written: a store
      // with two is one `parseStore` would not read back, and the caller is
      // owed the sentence that says which terminal already has the part.
      const taken = members.inRole(id, role);
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
      save(
        id,
        joinWork(value.works.get(id) ?? work, { terminal: ref, role, at }),
      );
      members.set(ref, joinedMember({ work: id, role, joinedAt: at }, how));
      changed();
      deps.records.schedule("members");
      deps.worksMoved();
      deps.watchScopeMoved();
    },
    /** One sentence for every way a take over can be about the wrong terminal:
     *  it belongs to no work in progress, it has left, or its work is a
     *  `watch` (the person's own terminal, which kolu never types into) or has
     *  no mode decided yet. */
    driven: (ref) => {
      const found = at(ref);
      // NOBODY drives a terminal that is a member of nothing — the same word
      // the record's own reading answers for a work kolu does not run.
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
