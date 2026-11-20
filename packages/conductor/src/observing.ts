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
  type MergeState,
  prOf,
  type PrReading,
  recordEvent,
  sameHead,
  type Work,
  type WorkEvent,
  type WorkId,
  type Worktree,
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

const sameWatch = Schema.toEquivalence(MemberWatchSchema);

/** WHAT A RING PUTS ON THE TIMELINE, beside waking the conversation — none
 *  for the two readings that put nothing on it. */
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
      return Option.some({
        at,
        by: "kolu",
        kind: "asleep",
        about: aboutMember(ref),
        why: { kind: "none" },
      });
    case "ended":
      return Option.some({
        at,
        by: "kolu",
        kind: "exited",
        about: aboutMember(ref),
        why: { kind: "reason", text: "ended without an agent" },
      });
    case "gone":
      return Option.none();
    case "taken-over":
    case "handed-back":
      return Option.none();
    default:
      return level satisfies never;
  }
};

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
 *  reader and no member has to exist for the work to learn that its PR was
 *  merged.
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
 *  whole of what is watched (`./workStore.ts`'s `prWatches` states the scope):
 *  once a work has ended, kolu stops asking its branch, so a PR that is open
 *  again on the forge says nothing here. Reopen on the card, or `work_open`
 *  on the same key, is the way back. */
export const prEvents = (work: Work, pr: WatchPr, at: string): Work => {
  if (work.state.kind === "ended") return work;
  let next = work;
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
  const about = <E extends { readonly pr: number; readonly head: CheckHead }>(
    last: (one: PrReading) => Option.Option<E>,
  ): Option.Option<E> =>
    Option.filter(
      Option.flatMap(reading, last),
      (one) => one.pr === pr.number && sameHead(one.head, pr.head),
    );
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

  const listing = new Set<string>();

  const listFiles = (
    id: string,
    ref: string,
    at: { host: string; worktree: string },
  ): void => {
    if (listing.has(ref)) return;
    listing.add(ref);
    void deps.workFiles
      .list(at)
      .then(({ paths }) => {
        const found = deps.store.get(id);
        if (Option.isNone(found) || found.value.state.kind !== "open") return;
        const work = found.value;
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
      let saidSomethingNew = false;
      let moved = false;
      let membership = false;
      let rows = false;
      let watched = false;
      let read = false;
      for (const one of seen) {
        const found = deps.store.at(one.ref);
        if (found === undefined) continue;
        const was = found.member;
        const learnt =
          was.worktree.kind === "unread" && one.git !== null
            ? Option.some<Worktree>({
                kind: "read",
                path: one.git.worktree,
              })
            : Option.none<Worktree>();
        const sighting = observed(
          Option.match(learnt, {
            onNone: () => was,
            onSome: (worktree) => ({ ...was, worktree }),
          }),
          one,
        );
        deps.members.set(one.ref, sighting.member);
        if (Option.isSome(learnt)) watched = true;
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
        deps.hostNamed(one.host, one.hostName);
        if (one.level === "working" && !deps.handoverHeld(one.ref))
          deps.withdraw(one.ref);
        if (changed && sighting.ring !== null) {
          const ring = sighting.ring;
          work = Option.match(ringEvent(one.ref, ring, stamp), {
            onNone: () => work,
            onSome: (event) => recordEvent(work, event),
          });
        }
        if (work !== found.work) {
          deps.store.save(found.id, work);
          moved = true;
        }
        if (sighting.drop) {
          deps.store.leave(one.ref, "gone");
          membership = true;
        }
        const where = sighting.member.worktree;
        if (changed && !sighting.drop && where.kind === "read")
          listFiles(found.id, one.ref, {
            host: one.host,
            worktree: where.path,
          });
        if (sighting.ring !== null) {
          deps.ring(sighting.member, one, sighting.ring);
          saidSomethingNew = true;
        }
      }
      if (deps.publishState()) saidSomethingNew = true;
      if (moved) deps.store.changed();
      if (watched) deps.records.schedule("members");
      if (read) deps.store.publishReadings();
      if (membership || rows) deps.worksMoved();
      if (membership) deps.watchScopeMoved();
      if (!saidSomethingNew) return;
      deps.flush();
    },
    observedPr: (id, reading) => {
      const read = prReading(reading);
      if (read.kind === "unknown") return;
      if (read.kind === "broken") {
        deps.log.error({ work: id, why: read.why }, "refused a PR reading");
        return;
      }
      const found = deps.store.get(id);
      if (Option.isNone(found)) return;
      const work = found.value;
      const next = prEvents(work, read.pr, nowIso());
      if (next === work) return;
      deps.store.save(id, next);
      deps.store.changed();
      if (deps.publishState()) deps.flush();
    },
    saidTo: (ref) => {
      const found = deps.store.at(ref);
      if (found === undefined) return;
      deps.withdraw(ref);
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
