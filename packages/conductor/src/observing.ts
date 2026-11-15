/**
 * WHAT AN OBSERVATION MEANS TO A PIECE OF WORK — the padi↔timeline seam, and
 * the one pass that applies it.
 *
 * This is the only code in kolu that knows BOTH vocabularies: a host's record
 * (`pr.checks === "pass"`, a reading of `asleep`) and the model's (`kind:
 * "checks-passed"`, `by: "ci"`). Its mirror image — frames to a reading —
 * is a module with its own test (`./readings.ts`), and its sibling — is this
 * worth waking the Conductor — is another (`./members.ts`).
 *
 * ## One pass per reading
 *
 * {@link Observing.observe} walks a frame's readings ONCE, and each reading
 * moves one work value through every arm in turn: the ring event, the PR, the
 * departure, the worktree, the files.
 *
 * ## What is pure, and why it matters
 *
 * {@link ringEvent}, {@link prEvents} and {@link fileEvents} take a work and
 * answer a work. They are the half that revs with the forge and the
 * `.waterfall` convention, and they are exercised by calling them
 * (`./observing.test.ts`).
 *
 * ## Nothing here ENDS a work for going quiet
 *
 * The only ending this module writes is the forge's: a merge or a close, each
 * carrying the pull request's own number. A terminal that went away LEAVES —
 * the work stays open with no terminals, and the card says exactly that.
 */

import type { PrResult } from "@kolu/terminal-vocab/schema";
import { Schema } from "effect";
import {
  CHECK_STEP,
  checkKey,
  checksSeen,
  endWork,
  filesSeen,
  prOf,
  recordEvent,
  reopenWork,
  type Work,
  type WorkEvent,
  type WorkId,
} from "kolu-work";
import type { ConductorWakeEvent } from "kolu-common/conductor";
import type { Logger } from "pino";
import { MemberWatchSchema, observed, saved, spokenTo } from "./members.ts";
import type { Member, MemberStore } from "./memberStore.ts";
import type { WatchObservation, WatchPr } from "./observation.ts";
import { prReading } from "./readings.ts";
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
      return { at, by: "agent", kind: level, terminal: ref, why: "" };
    case "asleep":
      // Nothing an agent did: a person (or kolu) put the terminal away, and
      // the agent in it went with it.
      return { at, by: "kolu", kind: "asleep", terminal: ref, why: "" };
    case "ended":
      // The command ran and gave the prompt back with NO agent ever in the
      // terminal — the agent the Conductor asked for never came up. For a
      // reader of the timeline that is the same ending as an exit, so it is
      // spelled as one, with the reason saying which kind it was.
      return {
        at,
        by: "kolu",
        kind: "exited",
        terminal: ref,
        why: "ended without an agent",
      };
    case "gone":
      // Not an event of its own: a terminal that went away LEFT the work,
      // and `leaveWork` writes that with its reason.
      return null;
    case "taken-over":
    case "handed-back":
      // Not a reading at all: a person took the keys, and the event for
      // that was written where it happened (`./workStore.ts`'s `handover`).
      return null;
  }
};

/** THE PR, as the timeline learns it — ONE pull request, observed ONCE, by the
 *  WORK.
 *
 *  A WORK HAS ONE PULL REQUEST, and kolu reads it where it lives: the branch.
 *  The reading comes from the work's own watch (`readings.ts`'s `prReading`
 *  over padi's `pullRequest` stream for `(repo, branch)`), so there is one
 *  reader, no member has to exist for the work to learn that its PR was
 *  merged, and the ping-pong two out-of-phase terminal sensors wrote between
 *  them (juspay/kolu#2376: 429 of one real work's 465 events) has no source
 *  left.
 *
 *  A CHECK EVENT IS ABOUT A COMMIT, and the timeline holds at most one per
 *  kind per PR per commit (`kolu-work`'s {@link checkKey}). That is what makes
 *  a reading kolu has already recorded — the same reading after a restart, the
 *  same checks re-run on the same commit — add nothing, while a PUSH adds an
 *  event: a new head's `checks-running` after the old head's `checks-passed`
 *  reads as what it is. The event carries the PR, the head and the failing
 *  gates as FIELDS.
 *
 *  The events are BY kolu / BY ci and name no terminal (`terminal: null`):
 *  nobody's terminal said this, the forge did.
 *
 *  A merge or a close ENDS the work here, because the forge saying so is one
 *  of the only two ways a work ends — whenever kolu next looks, including the
 *  first look after a restart, and whatever its members are doing (they LEAVE
 *  the work with the ending; nothing is killed). */
export const prEvents = (work: Work, pr: WatchPr, at: string): Work => {
  let next = work;
  const known = prOf(next);
  // THE FORGE'S ANSWER FOR THIS BRANCH IS THIS WORK'S PULL REQUEST. A number
  // the timeline has not got yet is a PR opening — the first one, or the next
  // one on a branch whose last was closed while kolu was not looking.
  if (known === null || known.number !== pr.number) {
    next = recordEvent(next, {
      at,
      by: "kolu",
      kind: "pr-opened",
      terminal: null,
      pr: pr.number,
      title: pr.title,
    });
  }
  // ONE TABLE for the check correspondence (`kolu-work`'s `CHECK_STEP`): the
  // event this rollup becomes and what the timeline would then read back are
  // the same row, so they cannot disagree about a check.
  if (pr.checks !== null) {
    const step = CHECK_STEP[pr.checks];
    if (!checksSeen(next).has(checkKey(step.kind, pr.number, pr.head))) {
      next = recordEvent(next, {
        at,
        by: "ci",
        kind: step.kind,
        terminal: null,
        pr: pr.number,
        head: pr.head,
        failing: pr.checks === "fail" ? [...pr.failing] : [],
      });
    }
  }
  if (pr.state === "merged" && prOf(next)?.state !== "merged") {
    next = recordEvent(next, {
      at,
      by: "kolu",
      kind: "merged",
      terminal: null,
      pr: pr.number,
    });
    next = endWork(next, { outcome: { kind: "merged", pr: pr.number }, at });
  }
  if (pr.state === "closed" && prOf(next)?.state !== "closed") {
    next = recordEvent(next, {
      at,
      by: "kolu",
      kind: "pr-closed",
      terminal: null,
      pr: pr.number,
    });
    next = endWork(next, { outcome: { kind: "closed", pr: pr.number }, at });
  }
  // THE FORGE SAYS IT IS OPEN AGAIN. The other way back from Ended, beside a
  // person pressing Reopen: a PR that was merged or closed and is open once
  // more is the same piece of work, decisions and timeline whole. Only an
  // ending the FORGE wrote is undone this way — a work somebody stopped
  // stays stopped until they open it again themselves.
  const ending = next.state;
  if (
    pr.state === "open" &&
    ending.kind === "ended" &&
    ending.outcome.kind !== "stopped" &&
    ending.outcome.pr === pr.number
  ) {
    next = reopenWork(next, at);
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
      path,
    });
  }
  return next;
};

export interface Observing {
  /** WHAT THE WATCHER SAW, for refs on CONNECTED hosts only. */
  readonly observe: (seen: ReadonlyArray<WatchObservation>) => void;
  /** WHAT THE WORK'S OWN PULL-REQUEST WATCH READ — one reading of the branch's
   *  PR, from the host the work is on. Not a reading of any terminal: it
   *  arrives for works with no members at all, and it is what ends a work the
   *  Conductor merged seconds before closing its terminals. */
  readonly observedPr: (work: WorkId, pr: PrResult) => void;
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
    member: Member,
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
   *  listing per terminal at a time. */
  const listing = new Set<string>();

  /** A MEMBER'S `.waterfall/`, LISTED — and every path kolu has not seen
   *  before put on the timeline. */
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
        if (work === undefined || work.state.kind !== "open") return;
        const next = fileEvents(work, ref, paths, nowIso());
        if (next === work) return;
        deps.store.save(id, next);
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
      // FOUR DIFFERENT QUESTIONS, and none of them is the others.
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
        const was = found.member;
        const sighting = observed(was, one);
        // WHERE IT IS WORKING, kept on the MEMBER the first time a record
        // says it: a work's files outlive the terminal that wrote them, and
        // the member row is where the path belongs now that membership is a
        // map of its own. The first answer sticks.
        const worktree = was.worktree ?? one.git?.worktree ?? null;
        deps.members.set(one.ref, {
          ...sighting.member,
          work: was.work,
          role: was.role,
          joinedAt: was.joinedAt,
          worktree,
        });
        if (worktree !== was.worktree) watched = true;
        // THE LEVEL CHANGED, as THIS PROCESS saw it.
        const changed = was.last?.level !== one.level;
        if (changed) read = true;
        const stamp = nowIso();
        let work = found.work;
        if (
          sighting.member.name !== was.name ||
          sighting.member.agent !== was.agent
        )
          rows = true;
        if (!sameWatch(saved(sighting.member), saved(was))) watched = true;
        // WHAT A PERSON CALLS THIS HOST, remembered for a wake that is not
        // about a reading.
        deps.hostNamed(one.host, one.hostName);
        // BACK TO WORKING WITHDRAWS WHAT IT WAS GOING TO SAY.
        if (one.level === "working" && !deps.handoverHeld(one.ref))
          deps.withdraw(one.ref);
        if (changed && sighting.ring !== null) {
          const event = ringEvent(one.ref, sighting.ring, stamp);
          if (event !== null) work = recordEvent(work, event);
        }
        // THE PULL REQUEST IS NOT READ HERE. It belongs to the work's branch
        // and the work's own watch reads it ({@link Observing.observedPr}) —
        // a member terminal's record is no longer a door onto the timeline.
        if (work !== found.work) {
          deps.store.save(found.id, work);
          moved = true;
        }
        // A TERMINAL THAT WENT AWAY LEAVES — and the work does not end for
        // it. `leave` writes the departure, drops the member row and wakes
        // the Conductor ONCE if that was the last one.
        if (sighting.drop) {
          deps.store.leave(one.ref, "gone");
          membership = true;
        }
        // THE FILES, off a level change: the moment an agent stops, asks or
        // comes up is the moment its `.waterfall/` has just changed, and a
        // member that has gone has no worktree left to read.
        if (changed && !sighting.drop && worktree !== null)
          listFiles(found.id, one.ref, { host: one.host, worktree });
        if (sighting.ring !== null) {
          deps.ring(
            {
              ...sighting.member,
              work: was.work,
              role: was.role,
              joinedAt: was.joinedAt,
              worktree,
            },
            one,
            sighting.ring,
          );
          saidSomethingNew = true;
        }
      }
      if (deps.publishState()) saidSomethingNew = true;
      if (moved) deps.store.changed();
      if (watched) deps.records.schedule("members");
      // HOW EACH MEMBER STANDS, straight from the loop that moved it.
      if (read) deps.store.publishReadings();
      if (membership || rows) deps.membersMoved(membership);
      if (!saidSomethingNew) return;
      deps.flush();
    },
    observedPr: (id, reading) => {
      // WHAT THE FORGE SAID, or nothing. Every arm but `ok` is "kolu does not
      // know" — a resolve in flight, a remote no adapter serves, a `gh` that
      // would not answer — and a work must never learn its PR closed because
      // the forge stopped answering.
      const pr = prReading(reading);
      if (pr === null) return;
      const work = deps.store.get(id);
      if (work === undefined) return;
      // THE WORKS A READING MOVES: one in progress, or one the FORGE ended —
      // the second is how a PR that is open again brings its work back. A work
      // somebody STOPPED stays stopped until they open it again themselves.
      const state = work.state;
      if (state.kind === "ended" && state.outcome.kind === "stopped") return;
      const next = prEvents(work, pr, nowIso());
      // IDEMPOTENT BY CONSTRUCTION: the reading is compared with the TIMELINE,
      // so the same reading twice — the next poll, the first look after a
      // restart — is the same work value back and nothing is written.
      if (next === work) return;
      // `save` is what ends it: the members go with the ending in that one
      // write (they LEAVE the work; no terminal is killed), the open questions
      // are dropped, and the files are kept.
      deps.store.save(id, next);
      deps.store.changed();
      if (deps.publishState()) deps.flush();
    },
    saidTo: (ref) => {
      const found = deps.store.at(ref);
      // Not a member: the fleet face says this about every `agent_say`, and
      // most terminals on a fleet belong to no work.
      if (found === undefined) return;
      // The news it was about to make is the state the Conductor has just
      // acted on, so it goes — and the member re-baselines at that state.
      deps.withdraw(ref);
      const member = found.member;
      deps.members.set(ref, {
        ...spokenTo(member),
        work: member.work,
        role: member.role,
        joinedAt: member.joinedAt,
        worktree: member.worktree,
      });
      deps.publishState();
      deps.records.schedule("members");
    },
    closedTerminal: (ref) => {
      const found = deps.store.at(ref);
      const withdrew = deps.withdraw(ref);
      if (found === undefined && !withdrew) return;
      if (found !== undefined) {
        deps.store.leave(ref, "closed");
        deps.records.schedule("members");
      }
      deps.publishState();
      deps.store.changed();
      if (found !== undefined) deps.membersMoved(true);
    },
  };
};
