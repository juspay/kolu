/**
 * WHAT AN OBSERVATION MEANS TO A PIECE OF WORK — the padi↔timeline seam, and
 * the one pass that applies it.
 *
 * This is the only code in kolu that knows BOTH vocabularies: a host's record
 * (`pr.checks === "pass"`, a reading of `asleep`) and the model's (`kind:
 * "checks-passed"`, `by: "ci"`). Its mirror image — frames to a reading —
 * is a module with its own test (`./readings.ts`), and its sibling — is this
 * worth waking the Conductor — is another (`./members.ts`). This half used to
 * be four closures inside the host, reachable only by standing one up.
 *
 * ## One pass per reading
 *
 * {@link Observing.observe} walks a frame's readings ONCE, and each reading
 * moves one work value through every arm in turn: the ring event, the PR, the
 * departure, the worktree, the files. Split per event family it would be
 * three writers to one work and "a PR recorded once" would become three
 * derivations of the same answer.
 *
 * ## What is pure, and why it matters
 *
 * {@link ringEvent}, {@link prEvents} and {@link fileEvents} take a work and
 * answer a work. They are the half that revs with the forge and the
 * `.waterfall` convention, and they are exercised by calling them
 * (`./observing.test.ts`). The loop around them is the impure half: a clock, a
 * store, a directory listing on another machine.
 */

import { Schema } from "effect";
import {
  CHECK_STEP,
  checkDetail,
  checkKey,
  checksSeen,
  endWork,
  filesSeen,
  prOf,
  recordEvent,
  sawWorktree,
  type Work,
  type WorkEvent,
} from "kolu-work";
import type { ConductorWakeEvent } from "kolu-common/conductor";
import type { Logger } from "pino";
import {
  MemberWatchSchema,
  observed,
  saved,
  spokenTo,
  type MemberState,
} from "./members.ts";
import type { MemberStore } from "./memberStore.ts";
import type { WatchObservation, WatchPr } from "./observation.ts";
import type { RecordWrites } from "./recordWrites.ts";
import type { WorkFiles } from "./workFiles.ts";
import type { WorkStore } from "./workStore.ts";

/** Two members' WRITTEN halves, compared by what they say — derived from the
 *  schema, so a field the watch grows is compared without an edit here. What
 *  it decides is whether the `members` key is owed a write. */
const sameWatch = Schema.toEquivalence(MemberWatchSchema);

/** WHAT A RING PUTS ON THE TIMELINE, beside waking the conversation.
 *
 *  The same word in both places wherever there is one: a reader of the card
 *  and the agent reading its wake are told the same thing happened. The two
 *  that differ say why below. */
export const ringEvent = (
  ref: string,
  level: ConductorWakeEvent["level"],
  at: string,
): WorkEvent | null => {
  switch (level) {
    case "ready":
    case "stopped":
    case "asking":
    case "exited":
      return { at, by: "agent", kind: level, terminal: ref, detail: "" };
    case "asleep":
      // Nothing an agent did: a person (or kolu) put the terminal away, and
      // the agent in it went with it.
      return { at, by: "kolu", kind: "asleep", terminal: ref, detail: "" };
    case "ended":
      // The command ran and gave the prompt back with NO agent ever in the
      // terminal — the agent the Conductor asked for never came up. For a
      // reader of the timeline that is the same ending as an exit, so it is
      // spelled as one, with the detail saying which kind it was. By kolu,
      // because there was no agent there to do it.
      return {
        at,
        by: "kolu",
        kind: "exited",
        terminal: ref,
        detail: "ended without an agent",
      };
    case "gone":
      // Not an event of its own: a terminal that went away LEFT the work,
      // and `leaveWork` writes that with its reason.
      return null;
    case "taken-over":
    case "handed-back":
      // Not a reading at all: a person took the keys, and the event for
      // that was written where it happened (`./workStore.ts`'s `handover`).
      // No reading ever produces one of these.
      return null;
  }
};

/** THE PR, as the timeline learns it — ONE pull request, observed once,
 *  however many members can see it.
 *
 *  A WORK HAS ONE PULL REQUEST. The timeline's first `pr-opened` says which,
 *  and a reading carrying any other number is not this work's PR: it moves
 *  nothing. (Two members in two worktrees on two branches can each report a
 *  number; alternating between them would be the same defect as the one
 *  below, told about the PR instead of its checks.)
 *
 *  A CHECK EVENT IS ABOUT A COMMIT, and the timeline holds at most one per
 *  kind per commit (`kolu-work`'s {@link checkKey}). That is what makes two
 *  members who DISAGREE — same worktree, same PR, one polled `gh` thirty
 *  seconds before the other, so one says pending and one says pass — write
 *  two events between them rather than one per frame for as long as they
 *  disagree (juspay/kolu#2376: 429 of one real work's 465 events were that
 *  ping-pong, 327 of them inside one minute). The comparison used to be
 *  against the LAST check event, which is a reading of whoever spoke last and
 *  not a fact about the pull request.
 *
 *  What it costs: checks re-run on the SAME commit are not news a second
 *  time, and the first red reading of a commit is the failing list the
 *  timeline keeps. Both are deliberate — nothing about the work moved — and
 *  the card's live tally (read off the member's own record, not the timeline)
 *  still shows what the forge says right now. A PUSH is news: a new head's
 *  `checks-running` after the old head's `checks-passed` reads as what it is.
 *
 *  A merge or a close ENDS the work here, because the PR is the one thing
 *  that says a piece of work is finished rather than merely quiet. */
export const prEvents = (
  work: Work,
  ref: string,
  pr: WatchPr,
  at: string,
): Work => {
  let next = work;
  const known = prOf(next);
  // NOT THIS WORK'S PULL REQUEST. Said plainly rather than recorded: the work
  // the timeline is about already has one.
  if (known !== null && known.number !== pr.number) return work;
  if (known === null) {
    next = recordEvent(next, {
      at,
      by: "agent",
      kind: "pr-opened",
      terminal: ref,
      detail: `#${pr.number} ${pr.title}`,
    });
  }
  // ONE TABLE for the check correspondence (`kolu-work`'s `CHECK_STEP`): the
  // event this rollup becomes and what the timeline would then read back are
  // the same row, so they cannot disagree about a check.
  if (pr.checks !== null) {
    const step = CHECK_STEP[pr.checks];
    if (!checksSeen(next).has(checkKey(step.kind, pr.head))) {
      next = recordEvent(next, {
        at,
        by: "ci",
        kind: step.kind,
        terminal: ref,
        detail: checkDetail(pr.head, pr.checks === "fail" ? pr.failing : []),
      });
    }
  }
  if (pr.state === "merged" && prOf(next)?.state !== "merged") {
    next = recordEvent(next, {
      at,
      by: "kolu",
      kind: "merged",
      terminal: ref,
      detail: `#${pr.number}`,
    });
    next = endWork(next, { outcome: "merged", at });
  }
  if (pr.state === "closed" && prOf(next)?.state !== "closed") {
    next = recordEvent(next, {
      at,
      by: "kolu",
      kind: "pr-closed",
      terminal: ref,
      detail: `#${pr.number}`,
    });
    next = endWork(next, { outcome: "closed", at });
  }
  return next;
};

/** THE FILES A LISTING FOUND, as the timeline learns them — every path kolu
 *  has not seen before, and nothing for the ones it has. */
export const fileEvents = (
  work: Work,
  ref: string,
  paths: ReadonlyArray<string>,
  at: string,
): Work => {
  const already = filesSeen(work);
  let next = work;
  for (const path of paths) {
    if (already.has(path)) continue;
    next = recordEvent(next, {
      at,
      by: "agent",
      kind: "file",
      terminal: ref,
      detail: path,
    });
  }
  return next;
};

export interface Observing {
  /** WHAT THE WATCHER SAW, for refs on CONNECTED hosts only. */
  readonly observe: (seen: ReadonlyArray<WatchObservation>) => void;
  /** The Conductor just spoke to the agent in this terminal. */
  readonly saidTo: (ref: string) => void;
  /** ... and just closed it. */
  readonly closedTerminal: (ref: string) => void;
}

export const observing = (deps: {
  readonly store: WorkStore;
  readonly members: MemberStore;
  readonly workFiles: WorkFiles;
  readonly records: RecordWrites<"works" | "members">;
  /** One terminal's news, held and flushed when there is somebody to tell. */
  readonly ring: (
    member: MemberState,
    seen: WatchObservation,
    level: ConductorWakeEvent["level"],
  ) => void;
  /** Take back what a terminal was about to say; answers whether anything was
   *  waiting. */
  readonly withdraw: (ref: string) => boolean;
  /** Whether what is waiting about a terminal is a HAND-OVER rather than an
   *  agent state. */
  readonly handoverHeld: (ref: string) => boolean;
  /** What a person calls this host, remembered for a wake that is not about a
   *  reading (a take over). */
  readonly hostNamed: (host: string, name: string) => void;
  /** Publish the conversation's own frame; answers whether anybody would see
   *  something different. */
  readonly publishState: () => boolean;
  readonly membersMoved: (membership: boolean) => void;
  /** Everything waiting, out as one turn — if there is a turn to put it in. */
  readonly flush: () => void;
  readonly log: Logger;
}): Observing => {
  const nowIso = (): string => new Date().toISOString();

  /** The member terminals whose `.waterfall/` is being listed RIGHT NOW. One
   *  listing per terminal at a time: a burst of level changes must not pile up
   *  reads of one directory on a machine that is answering slowly. */
  const listing = new Set<string>();

  /** A MEMBER'S `.waterfall/`, LISTED — and every path kolu has not seen
   *  before put on the timeline.
   *
   *  Off a level change rather than a timer: the moment an agent stops, asks
   *  or comes up is the moment its files have just changed, and a poll would
   *  be kolu reading a directory on every host for ever. A listing that FAILS
   *  is logged and nothing else — the next level change asks again, and a
   *  timeline that announced "could not list files" every few seconds would
   *  bury the events a person is reading it for. */
  const listFiles = (
    id: string,
    ref: string,
    at: { host: string; worktree: string },
  ): void => {
    if (listing.has(ref)) return;
    listing.add(ref);
    void deps.workFiles
      .list(at)
      .then((paths) => {
        const work = deps.store.get(id);
        if (work === undefined || work.endedAt !== null) return;
        const next = fileEvents(work, ref, paths, nowIso());
        if (next === work) return;
        deps.store.save(next);
        deps.store.changed();
      })
      .catch((err: unknown) => {
        deps.log.warn(
          { err, ref },
          "kolu-server: the conductor could not list a work's files",
        );
      })
      .finally(() => {
        listing.delete(ref);
      });
  };

  return {
    observe: (seen) => {
      // FOUR DIFFERENT QUESTIONS, and none of them is the others. What a
      // READER of the conversation sees is `publishState`'s to answer. What
      // the WORKS say is published whenever one of them moved. What the
      // member FILE must hold is the watch's bookkeeping, which carries facts
      // no frame shows (`told`, `spoken`, `ran`). What an in-process FOLLOWER
      // needs is the membership moving, apart from the rows.
      let saidSomethingNew = false;
      let moved = false;
      let membership = false;
      let rows = false;
      let watched = false;
      let read = false;
      for (const one of seen) {
        const found = deps.store.at(one.ref);
        // Not a member (any more): the watcher re-scopes asynchronously, so a
        // frame in flight across a departure is ordinary rather than a fault.
        if (found === undefined) continue;
        const was = deps.members.at(one.ref);
        if (was === undefined) continue;
        const sighting = observed(was, one);
        deps.members.set(one.ref, sighting.member);
        // THE LEVEL CHANGED, as THIS PROCESS saw it — which is what the
        // timeline is written from. `told` can already hold the level (a
        // restart re-reading the same stop), and that stop is still the first
        // one this process observed.
        const changed = was.last?.level !== one.level;
        if (changed) read = true;
        const stamp = nowIso();
        let work = found.work;
        if (
          sighting.member.name !== was.name ||
          sighting.member.agent !== was.agent
        )
          rows = true;
        // The member's own bookkeeping moved in ways no reader sees — `told`
        // reset, `ran` recorded, a name refreshed — and the FILE still owes
        // them: a restart that forgot `told` rings about every member again.
        if (!sameWatch(saved(sighting.member), saved(was))) watched = true;
        // WHAT A PERSON CALLS THIS HOST, remembered for a wake that is not
        // about a reading.
        deps.hostNamed(one.host, one.hostName);
        // BACK TO WORKING WITHDRAWS WHAT IT WAS GOING TO SAY: held news
        // describes how something STOOD, and this one has stopped standing
        // that way. A terminal that goes away keeps its news — that it went
        // away is exactly the thing to say, and so is a terminal a person has
        // taken over: that news is about WHO MAY TYPE, which an agent going
        // back to work does not answer.
        if (one.level === "working" && !deps.handoverHeld(one.ref))
          deps.withdraw(one.ref);
        if (changed && sighting.ring !== null) {
          const event = ringEvent(one.ref, sighting.ring, stamp);
          if (event !== null) work = recordEvent(work, event);
        }
        // THE PR IS COMPARED WITH THE TIMELINE, not with the last reading —
        // so two members looking at one PR record it once, and a restart
        // records nothing twice.
        if (one.pr !== null) work = prEvents(work, one.ref, one.pr, stamp);
        // WHERE IT IS WORKING, kept on the member the first time a record
        // says it: the files of a work outlive the terminal that wrote them.
        const worktree = one.git?.worktree;
        if (worktree !== undefined) work = sawWorktree(work, one.ref, worktree);
        if (sighting.drop) {
          work = deps.store.leave(work, one.ref, "gone");
          membership = true;
        }
        if (work !== found.work) {
          deps.store.save(work);
          moved = true;
        }
        // THE FILES, off a level change: the moment an agent stops, asks or
        // comes up is the moment its `.waterfall/` has just changed, and a
        // member that has gone has no worktree left to read.
        const where =
          work.members.find(
            (member) => member.terminal === one.ref && member.leftAt === null,
          )?.worktree ?? null;
        if (changed && !sighting.drop && where !== null)
          listFiles(work.id, one.ref, { host: one.host, worktree: where });
        if (sighting.ring !== null) {
          deps.ring(sighting.member, one, sighting.ring);
          saidSomethingNew = true;
        }
      }
      if (deps.publishState()) saidSomethingNew = true;
      if (moved) deps.store.changed();
      if (watched) deps.records.schedule("members");
      // HOW EACH MEMBER STANDS, straight from the loop that moved it: a level
      // change is not a change to the record, and publishing it through the
      // works' own path made a reading wait for a work to move.
      if (read) deps.store.publishReadings();
      if (membership || rows) deps.membersMoved(membership);
      // Nothing anybody can act on: no new news, nothing a reader would see.
      // The flush below is what may START A TURN, so it runs on movement
      // only — a poll that read the same thing again must not wake anybody.
      if (!saidSomethingNew) return;
      // Idle right now? Then nothing is waiting for a turn to end, and the
      // news goes out at once — which is the ordinary case: the Conductor
      // says what it is doing and ends its turn.
      deps.flush();
    },
    saidTo: (ref) => {
      const member = deps.members.at(ref);
      // Not a member: the fleet face says this about every `agent_say`, and
      // most terminals on a fleet belong to no work.
      if (member === undefined || deps.store.at(ref) === undefined) return;
      // The news it was about to make is the state the Conductor has just
      // acted on, so it goes — and the member re-baselines at that state.
      deps.withdraw(ref);
      deps.members.set(ref, spokenTo(member));
      deps.publishState();
      deps.records.schedule("members");
      // NO `membersMoved`: nothing moved that a reader outside can act on —
      // `spoken` is this module's own bookkeeping about a member that is still
      // the same terminal, in the same work, with the same role.
    },
    closedTerminal: (ref) => {
      const found = deps.store.at(ref);
      const withdrew = deps.withdraw(ref);
      if (found === undefined && !withdrew) return;
      if (found !== undefined) {
        deps.store.save(deps.store.leave(found.work, ref, "closed"));
        deps.records.schedule("members");
      }
      deps.publishState();
      deps.store.changed();
      if (found !== undefined) deps.membersMoved(true);
    },
  };
};
