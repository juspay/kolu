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
 * moves one work value through every arm in turn: the ring event, a watch's
 * own folder, the departure, the files. A branch work's PR and folder are not
 * among them: the work's own watch reads both by its key
 * ({@link Observing.observedPr}, {@link Observing.observedCheckout}).
 *
 * ## What is pure, and why it matters
 *
 * {@link ringEvent}, {@link prEvents}, {@link fileEvents} and
 * {@link toldEvents} take a work and answer a work (or an event). They are
 * the half that revs with the forge, the `.waterfall` convention and the
 * hand-off rule, and they are exercised by calling them
 * (`./observing.test.ts`).
 *
 * ## Nothing here ENDS a work for going quiet
 *
 * The only ending this module writes is the forge's: a merge or a close, each
 * carrying the pull request's own number. A terminal that went away LEAVES —
 * the work stays open with no terminals, and the card says exactly that.
 */

import type { BranchCheckout } from "@kolu/padi-client/surface";
import type { PrResult } from "@kolu/terminal-vocab/schema";
import { Option, Schema } from "effect";
import {
  ABOUT_WORK,
  aboutMember,
  CHECK_STEP,
  type CheckHead,
  endWork,
  linkPr,
  filesSeen,
  holdingOf,
  handsOver,
  hostOf,
  type MergeState,
  prOf,
  type PrReading,
  recordEvent,
  recordWorktree,
  sameHead,
  type Work,
  type WorkEvent,
  type WorkId,
  type Rekey,
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

/** WHAT A RING PUTS ON THE TIMELINE, beside waking the conversation — none
 *  for the two readings that put nothing on it.
 *
 *  The same word in both places wherever there is one: a reader of the card
 *  and the agent reading its wake are told the same thing happened. The two
 *  that differ say why below. */
export const ringEvent = (
  ref: string,
  level: ConductorWakeEvent["level"],
  at: string,
): Option.Option<WorkEvent> => {
  switch (level) {
    case "ready":
    case "stopped":
    case "asking":
    case "exited":
      return Option.some({
        at,
        by: "agent",
        kind: level,
        about: aboutMember(ref),
        why: { kind: "none" },
      });
    case "asleep":
      // Nothing an agent did: a person (or kolu) put the terminal away, and
      // the agent in it went with it.
      return Option.some({
        at,
        by: "kolu",
        kind: "asleep",
        about: aboutMember(ref),
        why: { kind: "none" },
      });
    case "ended":
      // The command ran and gave the prompt back with NO agent ever in the
      // terminal — the agent the Conductor asked for never came up. For a
      // reader of the timeline that is the same ending as an exit, so it is
      // spelled as one, with the reason saying which kind it was.
      return Option.some({
        at,
        by: "kolu",
        kind: "exited",
        about: aboutMember(ref),
        why: { kind: "reason", text: "ended without an agent" },
      });
    case "gone":
      // Not an event of its own: a terminal that went away LEFT the work,
      // and `leaveWork` writes that with its reason.
      return Option.none();
    case "taken-over":
    case "handed-back":
      // Not a reading at all: a person took the keys, and the event for
      // that was written where it happened (`./workStore.ts`'s `handover`).
      return Option.none();
    default:
      return level satisfies never;
  }
};

/** WHAT SPEAKING TO A MEMBER PUTS ON THE TIMELINE — a `told`, exactly when
 *  the word HANDS THE WORK OVER: to a planner or an implementor that is not
 *  holding it. An answer to an agent that is asking, a second word to one
 *  still at work, and any word to an `other` member hand nothing over and
 *  record nothing. Whether it does is `kolu-work`'s one rule (`handsOver`,
 *  over `holdingOf`), never a copy of it. */
export const toldEvents = (work: Work, ref: string, at: string): Work => {
  const told: WorkEvent = {
    at,
    by: "agent",
    kind: "told",
    about: aboutMember(ref),
  };
  return handsOver(holdingOf(work), told) ? recordEvent(work, told) : work;
};

/** Two merge answers say the same thing. */
const sameMerge = (a: MergeState, b: MergeState): boolean => {
  switch (a.kind) {
    case "can":
    case "unsettled":
      return b.kind === a.kind;
    case "cannot":
      return b.kind === "cannot" && a.why === b.why;
    default:
      return a satisfies never;
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
 *  A CHECK EVENT IS ABOUT A COMMIT, and one is recorded when the rollup's
 *  word CHANGES for that PR at that commit — the same rule the merge answer
 *  below follows. So a reading kolu has already recorded (the next poll, the
 *  first look after a restart) adds nothing, while the real CI run turning a
 *  passed rollup back to pending, or a pass → fail → pass on one commit, is
 *  each news; and a PUSH is news because it names another commit. The event
 *  carries the PR, the head and the failing gates as FIELDS.
 *
 *  The events are BY kolu / BY ci and name no terminal (`terminal: null`):
 *  nobody's terminal said this, the forge did.
 *
 *  A merge or a close ENDS the work here, because the forge saying so is one
 *  of the only two ways a work ends — whenever kolu next looks, including the
 *  first look after a restart, and whatever its members are doing (they LEAVE
 *  the work with the ending; nothing is killed).
 *
 *  IT NEVER BRINGS ONE BACK. A reading moves a work IN PROGRESS, which is the
 *  whole of what is watched (`./workStore.ts`'s `branchWatches` states the scope):
 *  once a work has ended, kolu stops asking its branch, so a PR that is open
 *  again on the forge says nothing here. Reopen on the card, or `work_open`
 *  on the same key, is the way back. */
export const prEvents = (work: Work, pr: WatchPr, at: string): Work => {
  // A finished work learns nothing from the forge: it is not even watched,
  // and Reopen is the one way back.
  if (work.state.kind === "ended") return work;
  let next = work;
  // THE FORGE'S ANSWER FOR THIS BRANCH IS THIS WORK'S PULL REQUEST. A number
  // the timeline has not got yet is a PR opening — the first one, or the next
  // one on a branch whose last was closed while kolu was not looking. Its
  // address is kept with it, so the number is a link for as long as the
  // work is kept; a PR recorded before kolu kept addresses learns its own
  // from the first reading that has it (`linkPr`).
  if (!Option.exists(prOf(next), (one) => one.number === pr.number)) {
    next = recordEvent(next, {
      at,
      by: "kolu",
      kind: "pr-opened",
      about: ABOUT_WORK,
      pr: pr.number,
      title: pr.title,
      url: { kind: "link", href: pr.url },
      draft: pr.readiness.kind,
    });
  } else next = linkPr(next, pr.number, pr.url);
  // MARKED READY, OR TURNED BACK INTO A DRAFT: recorded when the forge's word
  // differs from the timeline's, for an open PR — a PR opened before kolu kept
  // the word learns it here too. BEFORE the reading below: the check and merge
  // comparisons must see the merge answer the flip forgot.
  if (
    pr.state === "open" &&
    Option.exists(prOf(next), (one) => one.draft !== pr.readiness.kind)
  ) {
    next = recordEvent(next, {
      at,
      by: "kolu",
      kind: "draft-state",
      about: ABOUT_WORK,
      pr: pr.number,
      draft: pr.readiness.kind,
    });
  }
  const reading = prOf(next);
  /** What the timeline last said about THIS PR at THIS commit. */
  const about = <E extends { readonly pr: number; readonly head: CheckHead }>(
    last: (one: PrReading) => Option.Option<E>,
  ): Option.Option<E> =>
    Option.filter(
      Option.flatMap(reading, last),
      (one) => one.pr === pr.number && sameHead(one.head, pr.head),
    );
  // ONE TABLE for the check correspondence (`kolu-work`'s `CHECK_STEP`): the
  // event this rollup becomes and what the timeline would then read back are
  // the same row, so they cannot disagree about a check.
  if (pr.checks.kind === "rollup") {
    const step = CHECK_STEP[pr.checks.rollup];
    if (
      !Option.exists(
        about((one) => one.lastCheck),
        (last) => last.kind === step.kind,
      )
    ) {
      next = recordEvent(next, {
        at,
        by: "ci",
        kind: step.kind,
        about: ABOUT_WORK,
        pr: pr.number,
        head: pr.head,
        failing: pr.checks.rollup === "fail" ? [...pr.failing] : [],
      });
    }
  }
  // WHETHER THE FORGE WOULD MERGE IT, recorded when the answer CHANGES for
  // this PR at this commit — `unsettled` included, so GitHub recomputing a
  // commit (the base moved) takes back the `can` it had, and a push never
  // inherits the last commit's answer. Only while the PR is open and READY: a
  // draft carries no merge answer (GitHub works one out as if it were ready),
  // and the timeline reads it as `cannot: draft` on its own. A reading with
  // no merge state at all (`unreported`) is a padi older than the field: it
  // says nothing, and the card says GitHub has not answered.
  if (pr.state === "open" && pr.readiness.kind === "ready") {
    const merge = pr.readiness.merge;
    if (
      merge.kind !== "unreported" &&
      !Option.exists(
        about((one) => one.lastMerge),
        (last) => sameMerge(last.merge, merge),
      )
    ) {
      next = recordEvent(next, {
        at,
        by: "kolu",
        kind: "merge-state",
        about: ABOUT_WORK,
        pr: pr.number,
        head: pr.head,
        merge,
      });
    }
  }
  if (
    pr.state === "merged" &&
    !Option.exists(prOf(next), (one) => one.state === "merged")
  ) {
    next = recordEvent(next, {
      at,
      by: "kolu",
      kind: "merged",
      about: ABOUT_WORK,
      pr: pr.number,
    });
    next = endWork(next, { outcome: { kind: "merged", pr: pr.number }, at });
  }
  if (
    pr.state === "closed" &&
    !Option.exists(prOf(next), (one) => one.state === "closed")
  ) {
    next = recordEvent(next, {
      at,
      by: "kolu",
      kind: "pr-closed",
      about: ABOUT_WORK,
      pr: pr.number,
    });
    next = endWork(next, { outcome: { kind: "closed", pr: pr.number }, at });
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
      about: aboutMember(ref),
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
  /** WHAT THE WORK'S OWN CHECKOUT WATCH READ — git's answer for where the
   *  work's branch is checked out on its host. The one writer of a branch
   *  work's folder: `repository` is recorded (the folder, or `absent`); a
   *  path that is no repository, and a git that would not answer, conclude
   *  nothing. */
  readonly observedCheckout: (work: WorkId, checkout: BranchCheckout) => void;
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
  /** RE-KEY A BRANCH WORK TO THE ROOT GIT NAMED — the work store's re-key,
   *  and everything in the conversation that names the work carried along
   *  with it (the host's {@link ConductorHost.rekeyWork}). */
  readonly rekey: (id: WorkId, root: string) => Rekey;
  /** A work, a member row or a reading moved — every reader of the `works`
   *  resource is owed a redraw. */
  readonly worksMoved: () => void;
  /** The watch's SCOPE may have moved — the member set or the branches with
   *  work in flight. */
  readonly watchScopeMoved: () => void;
  /** Everything waiting, out as one turn — if there is a turn to put it in. */
  readonly flush: () => void;
  readonly log: Logger;
}): Observing => {
  const nowIso = (): string => new Date().toISOString();

  /** The works whose `.waterfall/` is being listed RIGHT NOW. One listing per
   *  work at a time: the place listed is the work's, whoever asked. */
  const listing = new Set<WorkId>();

  /** A WORK'S `.waterfall/`, LISTED — in the work's own folder on the key's
   *  host, never a member's — and every path kolu has not seen before put on
   *  the timeline, about the member whose moment asked for it. A work whose
   *  folder git has not answered with lists nothing. */
  const listFiles = (id: WorkId, ref: string): void => {
    const found = deps.store.get(id);
    if (Option.isNone(found)) return;
    const held = found.value;
    if (held.state.kind !== "open" || held.worktree.kind !== "at") return;
    if (listing.has(id)) return;
    listing.add(id);
    void deps.workFiles
      .list({ host: hostOf(held), worktree: held.worktree.path })
      .then(({ paths }) => {
        const now = deps.store.get(id);
        if (Option.isNone(now) || now.value.state.kind !== "open") return;
        const work = now.value;
        const next = fileEvents(work, ref, paths, nowIso());
        if (next === work) return;
        deps.store.save(id, next);
        deps.store.changed();
      })
      .catch((err: unknown) => {
        deps.log.warn(
          { err, work: id },
          "kolu-server: the conductor could not list a work's files",
        );
      })
      .finally(() => {
        listing.delete(id);
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
        // ONE ROW IN, ONE ROW OUT — `observed` carries the whole member, so
        // the model's half is never re-attached by hand here (a field added
        // to it would have been silently dropped on the next host read).
        const sighting = observed(was, one);
        deps.members.set(one.ref, sighting.member);
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
          const ring = sighting.ring;
          work = Option.match(ringEvent(one.ref, ring, stamp), {
            onNone: () => work,
            onSome: (event) => recordEvent(work, event),
          });
        }
        // THE PULL REQUEST IS NOT READ HERE. It belongs to the work's branch
        // and the work's own watch reads it ({@link Observing.observedPr}) —
        // a member terminal's record is no longer a door onto the timeline.
        // NOR IS A BRANCH WORK'S FOLDER: git answers that by the work's key
        // ({@link Observing.observedCheckout}). A WATCH is the one work whose
        // folder is a terminal's — its key IS that terminal — so the reading
        // of the key's own terminal, and no other member, writes it.
        if (
          work.key.kind === "watch" &&
          work.key.host === one.host &&
          work.key.id === one.terminalId &&
          one.git !== null
        )
          work = recordWorktree(work, { kind: "at", path: one.git.worktree });
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
        // comes up is the moment the work's `.waterfall/` may have just
        // changed. Listed in the WORK's folder, wherever this member stands.
        if (changed && !sighting.drop) listFiles(found.id, one.ref);
        if (sighting.ring !== null) {
          deps.ring(sighting.member, one, sighting.ring);
          saidSomethingNew = true;
        }
      }
      if (deps.publishState()) saidSomethingNew = true;
      if (moved) deps.store.changed();
      if (watched) deps.records.schedule("members");
      // HOW EACH MEMBER STANDS, straight from the loop that moved it.
      if (read) deps.store.publishReadings();
      // TWO FACTS, TWO SINKS. Every reader of the rows is owed a redraw when
      // anything about a member moved; the watch re-scopes only when the SET
      // of members did — a rename or an agent appearing must not tear down
      // every host's standing reads.
      if (membership || rows) deps.worksMoved();
      if (membership) deps.watchScopeMoved();
      if (!saidSomethingNew) return;
      deps.flush();
    },
    observedPr: (id, reading) => {
      // THE LIVE PR, published FIRST and whatever it says: the card's mark
      // and its check count move with every reading, including the ones
      // that record nothing on the timeline below (the same word, more
      // checks landed). It is the work's own branch's answer — the one
      // source of a work's live PR.
      deps.store.prRead(id, reading);
      // WHAT THE FORGE SAID, or nothing. Every arm but `ok` is "kolu does not
      // know" — a resolve in flight, a remote no adapter serves, a `gh` that
      // would not answer — and a work must never learn its PR closed because
      // the forge stopped answering. A BROKEN reading is refused for this
      // one work, as an error: the watch goes on serving every other.
      const read = prReading(reading);
      if (read.kind === "unknown") return;
      if (read.kind === "broken") {
        deps.log.error({ work: id, why: read.why }, "refused a PR reading");
        return;
      }
      const found = deps.store.get(id);
      if (Option.isNone(found)) return;
      const work = found.value;
      // A READING MOVES A WORK IN PROGRESS, and nothing else (`prEvents`).
      const next = prEvents(work, read.pr, nowIso());
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
    observedCheckout: (watched, reading) => {
      // GIT'S ANSWER, or nothing: a path that is no repository and a git that
      // would not answer say nothing about where the branch is.
      if (reading.kind !== "repository") return;
      const found = deps.store.get(watched);
      if (Option.isNone(found)) return;
      if (found.value.state.kind !== "open") return;
      if (found.value.key.kind !== "branch") return;
      // A KEY GIT HAS NOT NAMED YET IS RE-KEYED FIRST — to the root this
      // answer names, so a work kept from before the key was git's (or held
      // under its old key) becomes the work of that root and branch — and the
      // folder is recorded on whatever the work is now.
      let id = watched;
      if (found.value.key.repoBy.kind !== "git") {
        const rekey = deps.rekey(watched, reading.root);
        if (rekey.kind === "moved") id = rekey.to;
        if (rekey.kind === "held" && rekey.ended) return;
      }
      const now = deps.store.get(id);
      if (Option.isNone(now)) return;
      const work = now.value;
      const next = recordWorktree(
        work,
        reading.checkout.kind === "at"
          ? { kind: "at", path: reading.checkout.path }
          : { kind: "absent" },
      );
      if (next === work) return;
      deps.store.save(id, next);
      deps.store.changed();
    },
    saidTo: (ref) => {
      const found = deps.store.at(ref);
      // Not a member: the fleet face says this about every `agent_say`, and
      // most terminals on a fleet belong to no work.
      if (found === undefined) return;
      // The news it was about to make is the state the Conductor has just
      // acted on, so it goes — and the member re-baselines at that state.
      deps.withdraw(ref);
      // THE HAND-OFF, on the work's timeline: the stage follows who holds
      // the work, and this is the Conductor handing it over.
      const work = toldEvents(found.work, ref, nowIso());
      if (work !== found.work) {
        deps.store.save(found.id, work);
        deps.store.changed();
      }
      const member = found.member;
      deps.members.set(ref, spokenTo(member));
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
      if (found !== undefined) {
        deps.worksMoved();
        deps.watchScopeMoved();
      }
    },
  };
};
