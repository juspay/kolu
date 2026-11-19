/**
 * THE THING THAT WAKES THE CONDUCTOR — kolu-server watching the terminals that
 * are MEMBERS of a piece of work in progress, so the conversation itself never
 * has to sit in a wait.
 *
 * The Conductor used to find out that a planner had stopped by CALLING a wait
 * with no time limit, which is a turn that lasts as long as the work does and a
 * person's message queued behind it for all of that. This module is the other
 * half of deleting that: kolu holds the standing subscriptions, and when a
 * member's agent comes up, stops, asks, sleeps or goes away it starts a
 * Conductor turn itself ({@link ConductorHost.observe}).
 *
 * ## Wiring only
 *
 * What a host's frames MEAN is not here. `kolu-conductor`'s `readings.ts` takes
 * padi's urgency fold, a host's roster and the records that were read and
 * answers one observation per member — a function, tested by calling it. What
 * is left in kolu-server is the part that can only be done here: SUBSCRIBING,
 * which needs the host map, its clients and their comings and goings.
 * Following those is not written here either — `kolu-mcp`'s
 * `overConnectedHosts` is the one implementation of "a leg per connected host,
 * re-opened as the map moves", and the fleet face's own folds read through it.
 *
 * ## What a leg subscribes
 *
 * Per host that holds at least one member OR one work's branch, over that
 * host's padi: its `urgency` fold, its `roster` (the standing AND the census
 * of ids, one cell), each member terminal's own record, and — per piece of
 * work in progress whose branch is on this host — padi's `pullRequest` stream
 * for that `(repo, branch)`. What
 * each of them is WORTH is stated where they are read (`kolu-conductor`'s
 * `HostReading`, and its `prReading` for the forge). Nothing else: a screen is
 * read by the Conductor when it decides to look, and a wake carries how
 * something STANDS rather than what it printed.
 *
 * THE PULL REQUEST IS THE WORK'S, not a terminal's. It used to arrive on each
 * member's record, which meant the one fact that ENDS a work — the merge — had
 * no observer from the moment its terminals were closed, and a Conductor-run
 * waterfall closes them seconds after merging (#2376). A work is a branch on a
 * machine, so kolu asks that machine about that branch for as long as the work
 * is open, whether or not a terminal is left; a host that is not answering
 * yields no frame, and nothing is concluded from that.
 *
 * The ANCESTOR WALK is gone with the watch list that needed it. A piece of
 * work used to be guessed from which watched terminals shared a top-level
 * parent, so every leg climbed `child-of` edges to find one; membership is
 * STATED now (the Conductor names the work and the role when it creates or
 * adopts a terminal), so there is nothing above a member worth a subscription.
 *
 * ## Retry, and the three ways a leg ends
 *
 * Every member opens with a SNAPSHOT by contract (`dev/skills/streaming/SKILL.md`),
 * so a re-subscribe is a fresh reading rather than a replay — which is what
 * makes re-opening the honest recovery here rather than a resync protocol. The
 * host map moved, and the whole generation is re-opened against the clients
 * that are current (`overConnectedHosts`); the watch's SCOPE moved
 * ({@link ConductorWatcher.scopeMoved}) — a member joined or left, or a branch
 * gained or lost work in flight — and the legs it chooses are re-chosen; or
 * the stream ENDED on its own — the far end went away without the
 * host map noticing — and that host's leg alone re-opens after
 * {@link REOPEN_DELAY_MS}, its siblings undisturbed. Bounded by the delay
 * rather than an attempt count: a host that is down is retried forever,
 * quietly, because the terminal being watched is still there when it comes back.
 *
 * ## What it refuses to say
 *
 * A reading is produced ONLY for a ref on a CONNECTED host. A host that is not
 * answering says nothing about its terminals, and `gone` for one of them would
 * be a wake telling the Conductor that a machine's work died when all that
 * happened is that the machine stopped answering. Disconnected is not gone.
 */

import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import {
  type PadiRoster,
  type PadiTerminal,
  type PadiUrgency,
  rosterIsEstablished,
} from "@kolu/padi-client/surface";
import type { PrResult } from "@kolu/terminal-vocab/schema";
import { Cause, Effect, Fiber, Queue, Schedule, Stream } from "effect";
import {
  type ConductorHost,
  type HostView,
  type PrWatch,
  readingsOf,
} from "kolu-conductor";
import type { WorkId } from "kolu-work";
import { type FleetHosts, overConnectedHosts } from "kolu-mcp";
import { splitFleetTerminalRef } from "kolu-mcp/fleetRef";
import type { Logger } from "pino";

/** How long a leg whose stream ended on its own waits before re-opening.
 *
 *  A few seconds, because what is on the other side is a daemon restarting or
 *  an ssh link re-dialling, and a tighter loop would be this process spinning
 *  against a machine that is busy coming back. Nothing is lost by the wait: the
 *  re-open leads with a snapshot, so the first frame after it is the world as
 *  it stands rather than the edge that was missed. */
const REOPEN_DELAY_MS = 3_000;

export interface ConductorWatcher {
  /** THE SCOPE MOVED — the member refs or the branches with work in flight.
   *  Re-read it and re-open the legs it now names. Cheap enough to call on
   *  every move: the scope is compared before anything is torn down, and a
   *  leg is a subscription that opens with a snapshot, so the first frame
   *  after one is a full reading. */
  readonly scopeMoved: () => void;
  /** Stop watching everything, for the shutdown. */
  readonly dispose: () => Promise<void>;
}

/** One frame off one leg, before it is folded into a view. */
type Frame =
  | { readonly kind: "urgency"; readonly urgency: PadiUrgency }
  | { readonly kind: "roster"; readonly roster: PadiRoster }
  | {
      readonly kind: "record";
      readonly id: string;
      readonly record: PadiTerminal;
    };

/** EVERYTHING ONE LEG CARRIES — a host's own reading of its member terminals,
 *  or the forge's reading of one work's branch on that host. Two questions
 *  asked of one padi over one subscription generation, so they arrive as one
 *  stream and are told apart here rather than by two consumers. */
type WatchFrame =
  | { readonly kind: "view"; readonly view: HostView }
  | {
      readonly kind: "pr";
      readonly work: WorkId;
      readonly pr: PrResult;
    };

/** Everything the fold needs, as the frames arrive — the two that are `null`
 *  until their first frame being exactly why nothing is reported before then. */
interface Accumulated {
  urgency: PadiUrgency | null;
  roster: PadiRoster | null;
  readonly records: Map<string, PadiTerminal>;
}

/**
 * EVERYTHING ONE HOST SAYS about the member terminals on it, as one stream of
 * {@link HostView}s. Nothing is emitted until padi's fold AND its roster have
 * both landed: "in none of the four lists" means nothing before the first fold,
 * and a list means nothing before padi says it has finished adopting.
 *
 * That roster is padi's own (`padiSurface`'s `roster` cell, 7.4) — the fact its
 * attention folds already gated their serve-time empty seed on, now served as
 * data, WITH THE CENSUS ON THE SAME FRAME. It decides which ARM this leg emits,
 * and therefore whether `gone` is a word anybody may say about this host's
 * terminals: a padi that has not finished adopting is `settling`, not ready
 * with an empty roster. Reading it wrong is what ended a work as abandoned on a
 * redeploy (#2376).
 *
 * THE IDS COME OFF THAT CELL, not off `terminals.keys` beside it, and the
 * second half of #2376 is why. This leg does not read padi directly: it reads
 * kolu-server's per-host MIRROR, which marks its session connected on the first
 * folded CELL frame — so a leg opened then was told `established` by the cell
 * and an EMPTY LIST by a collection that had not folded yet, and said `gone`
 * about a terminal adopted and alive half a second earlier. A standing and a
 * list on two members can be delivered apart by any projection between here and
 * the daemon; one member cannot.
 *
 * One record per MEMBER and nothing above it: which piece of work a terminal
 * belongs to is STATED when it joins, so the ancestor walk this used to run
 * (re-deriving a grouping off `child-of` edges, a subscription per link) has
 * nothing left to answer. A record is for the member's NAME, agent and git —
 * never for whether it is there, which the census answers.
 *
 * The emitted view SHARES the accumulator's record map rather than copying
 * it — the consumer below hands it straight to a pure function and keeps
 * nothing, while a copy per frame would be one allocation of every member's
 * record per foreground sample, for nobody.
 */
const hostViews = (
  host: string,
  hostName: string,
  padi: PadiSurfaceClient,
  watched: readonly string[],
): Stream.Stream<HostView, unknown> => {
  const members: Stream.Stream<Frame, unknown>[] = [
    Stream.map(
      padi.surface.urgency.get(undefined),
      (urgency): Frame => ({ kind: "urgency", urgency }),
    ),
    Stream.map(
      padi.surface.roster.get(undefined),
      (roster): Frame => ({ kind: "roster", roster }),
    ),
    ...watched.map((id) =>
      Stream.map(
        padi.surface.terminals.get({ key: id }),
        (record): Frame => ({ kind: "record", id, record }),
      ),
    ),
  ];
  return Stream.mapAccum(
    Stream.mergeAll(members, { concurrency: "unbounded" }),
    (): Accumulated => ({
      urgency: null,
      roster: null,
      records: new Map(),
    }),
    (at, frame) => {
      if (frame.kind === "urgency") at.urgency = frame.urgency;
      else if (frame.kind === "roster") at.roster = frame.roster;
      else at.records.set(frame.id, frame.record);
      const { urgency, roster } = at;
      if (urgency === null || roster === null) return [at, []] as const;
      // The ARM, and the only place one is chosen: padi's own word for whether
      // its roster is a census, read through the one fold both sides share,
      // and whether its attention fold is evidence yet (`settled: false`
      // while a redeploy reads its survivors, whose empty lists mean nobody
      // has looked). A settling host is emitted — it is a real thing this leg
      // has learned — and says nothing about any terminal, because the fold
      // it would be read by has nothing on that arm to read.
      const view: HostView =
        rosterIsEstablished(roster) && urgency.settled
        ? {
            kind: "ready",
            host,
            hostName,
            watched,
            roster: new Set(roster.ids),
            urgency,
            records: at.records,
          }
        : { kind: "settling", host, hostName, watched };
      return [at, [view]] as const;
    },
  );
};

export function startConductorWatcher(deps: {
  readonly hosts: FleetHosts;
  /** The conversation, as a THUNK — read per call, and never called merely to
   *  find out whether anything is watched: building the host reads the
   *  remembered record, which is bookkeeping, while a wake is what may start
   *  the agent ({@link ConductorHost.observe} → the host's own flush). */
  readonly conductor: () => ConductorHost;
  readonly log: Logger;
}): ConductorWatcher {
  const { hosts, conductor, log } = deps;

  /** Pushes a scope move into the stream below — `null` until the stream is
   *  running. A move that lands in that gap is not lost: the stream's first
   *  act is to READ the scope, so it opens on whatever it says by then. */
  let moved: (() => void) | null = null;
  const moves = Stream.callback<void>((queue) =>
    Effect.gen(function* () {
      // The current scope goes out BEFORE the trigger is armed, for the
      // reason the roster's own stream states: a stream that only spoke on
      // CHANGE would never open a leg at boot.
      Queue.offerUnsafe(queue, undefined);
      moved = () => {
        Queue.offerUnsafe(queue, undefined);
      };
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          moved = null;
        }),
      );
    }),
  );

  /** THE MEMBERSHIP, or NOTHING — never a throw.
   *
   *  `memberRefs` reads the saved works, and a store this build cannot decode
   *  raises `UnreadablePersisted` (round 3's recovery screen is what answers
   *  that, elsewhere). Every read below runs inside the stream that IS the
   *  watch, where a throw is a DEFECT: it killed the whole fiber, and nothing
   *  re-opens it — "nothing will wake the Conductor until kolu-server
   *  restarts", observed in an e2e whose store was deliberately seeded
   *  unreadable. An unreadable store means kolu does not know who the members
   *  are, which is exactly a watch with nothing to watch: no legs, no readings,
   *  nothing concluded about anybody's terminals. Said once per generation
   *  rather than swallowed, and it re-reads on the next membership move — so
   *  the recovery that fixes the store also revives the watch. */
  const memberRefs = (): readonly string[] => {
    try {
      return conductor().memberRefs();
    } catch (err) {
      log.warn(
        { err },
        "kolu-server: the Conductor's saved works cannot be read — the watch is standing by and will conclude nothing about any terminal until they can",
      );
      return [];
    }
  };

  /** THE BRANCHES WHOSE PULL REQUESTS ARE WATCHED, or nothing — never a throw,
   *  for the reason stated just above: this is read inside the stream that IS
   *  the watch. A store kolu cannot decode means kolu does not know which
   *  branches have work in flight, which is a watch with nothing to ask about
   *  and nothing concluded about anybody's pull request. */
  const prWatches = (): ReadonlyArray<PrWatch> => {
    try {
      return conductor().prWatches();
    } catch {
      // Said once, above, by the read that runs beside this one in the same
      // generation — a second sentence about one unreadable store is noise.
      return [];
    }
  };

  /** THE SCOPE, AS ONE STRING — every member ref and every watched branch.
   *
   *  What the legs are chosen from, so what a re-open has to be justified by.
   *  The conversation announces a move wherever it moves a work or a member,
   *  and most of those moves change no subscription at all (a terminal was
   *  renamed, a work recorded an event); re-opening on each of them would tear
   *  down every host's standing reads several times a minute and ask every
   *  branch's forge again with them. */
  const scopeOf = (): string =>
    JSON.stringify([
      memberRefs(),
      prWatches().map((one) => [one.host, one.repo, one.branch]),
    ]);

  /** The moves that are actually a different watch. The FIRST one always
   *  passes — nothing has been opened yet, and `moves` leads with the current
   *  scope so a boot opens its legs. */
  let openedScope: string | null = null;
  const scopeMoves = Stream.filter(moves, () => {
    const now = scopeOf();
    if (now === openedScope) return false;
    openedScope = now;
    return true;
  });

  /** The ids to watch on one host — the ACTIVE members of the works in
   *  progress (`ConductorHost.memberRefs`), which is the whole of what a
   *  terminal being watched means now. A ref whose host is not a member of
   *  this fleet is simply not here: works are saved with the state root and a
   *  host can be removed from the pool under them, which is not a terminal
   *  going away — nothing can be said about a machine kolu no longer holds. */
  const membersOn = (host: string): readonly string[] => {
    const ids: string[] = [];
    for (const ref of memberRefs()) {
      const split = splitFleetTerminalRef(ref);
      if (split !== null && split.host === host) ids.push(split.id);
    }
    return ids;
  };

  /** The hosts that hold a member terminal and are NOT answering, as frames —
   *  one per generation of the host map, in the same `[host, frame]` shape a
   *  leg's own frames arrive in.
   *
   *  The watcher knows this and nothing else did: `overConnectedHosts` opens a
   *  leg only over a host that is connected, so an unreachable one used to be
   *  an absence of frames. Stating it is what makes {@link HostView} total —
   *  every host a work's membership names is in exactly one of its three
   *  states — and it says nothing about any terminal, by construction. A work
   *  whose BRANCH is on such a host gets no frame at all, which is the same
   *  answer said the other way: nothing is concluded about a pull request kolu
   *  could not ask about.  */
  const unreachableFrames = (
    live: readonly string[],
  ): ReadonlyArray<readonly [string, WatchFrame]> => {
    const out: Array<readonly [string, WatchFrame]> = [];
    for (const ref of memberRefs()) {
      const split = splitFleetTerminalRef(ref);
      if (split === null || live.includes(split.host)) continue;
      if (out.some(([host]) => host === split.host)) continue;
      out.push([
        split.host,
        {
          kind: "view",
          view: {
            kind: "unreachable",
            host: split.host,
            hostName: hosts.display(split.host),
            watched: membersOn(split.host),
          },
        },
      ]);
    }
    return out;
  };

  const legs = Stream.switchMap(scopeMoves, () =>
    overConnectedHosts(
      hosts,
      (host, padi) => {
        const watched = membersOn(host);
        const branches = prWatches().filter((one) => one.host === host);
        // A connected host with neither a member nor a work's branch on it
        // gets no leg at all.
        if (watched.length === 0 && branches.length === 0) return null;
        // TWO THINGS THIS HOST IS ASKED, on ONE leg: how its member terminals
        // stand, and what the forge says about each work's branch. They are
        // merged rather than opened separately because they share a fate — the
        // same host map, the same re-open delay, the same generation — and a
        // work with NO members is exactly the case the second one exists for.
        const views = Stream.map(
          hostViews(host, hosts.display(host), padi, watched),
          (view): WatchFrame => ({ kind: "view", view }),
        );
        const branchPrs = branches.map((one) =>
          Stream.map(
            padi.surface.pullRequest.get({
              repoPath: one.repo,
              branch: one.branch,
            }),
            (pr): WatchFrame => ({ kind: "pr", work: one.work, pr }),
          ),
        );
        const leg = Stream.tapError(
          Stream.mergeAll([views, ...branchPrs], {
            concurrency: "unbounded",
          }),
          (err) =>
            Effect.sync(() => {
              log.warn(
                { err, host },
                "kolu-server: the conductor's watch over a host stopped; re-opening",
              );
            }),
        );
        // `repeat` is the leg that ENDED, `retry` the leg that FAILED, and both
        // wait the same few seconds. Per host, inside the generation, so one
        // machine coming back does not disturb the others' subscriptions.
        return Stream.retry(
          Stream.repeat(leg, Schedule.spaced(REOPEN_DELAY_MS)),
          Schedule.spaced(REOPEN_DELAY_MS),
        );
      },
      // A host that holds members and is NOT answering is said OUT LOUD, once
      // per generation, in the same vocabulary its frames arrive in — rather
      // than being a silence the fold below could mistake for a quiet host. It
      // yields no reading (there is nothing on that arm to read), which is the
      // whole point: a machine kolu cannot reach is not a machine whose
      // terminals died — and nothing at all is concluded about the pull
      // request of a work whose branch is on it.
      (live, frames) =>
        Stream.concat(Stream.fromIterable(unreachableFrames(live)), frames),
    ),
  );

  // Every frame is either a reading of a whole host or the forge's reading of
  // one work's branch, and what is NEWS about either is the conversation's own
  // to decide (`kolu-conductor`'s per-member wake rules; its timeline for a
  // pull request). A reading about a ref that has just left its work — or
  // about a work that has just ended — is ordinary: the legs re-open
  // asynchronously, and the conversation drops it.
  //
  // A leg's own failure is retried above, so the only way this fiber ends on
  // its own is a DEFECT — a throw out of `observe` or the fold. Nothing re-opens
  // it after that, and a watch that is gone means a Conductor nobody wakes, so
  // it is said at `error` with its cause rather than ending in silence.
  const fiber = Effect.runFork(
    Effect.onExit(
      Stream.runForEach(legs, ([, frame]) =>
        Effect.sync(() => {
          if (frame.kind === "pr") {
            conductor().observedPr(frame.work, frame.pr);
            return;
          }
          const seen = readingsOf(frame.view);
          if (seen.length > 0) conductor().observe(seen);
        }),
      ),
      (exit) =>
        Effect.sync(() => {
          if (exit._tag === "Success" || Cause.hasInterruptsOnly(exit.cause))
            return;
          log.error(
            { err: Cause.squash(exit.cause) },
            "kolu-server: the conductor's watch died — nothing will wake the Conductor until kolu-server restarts",
          );
        }),
    ),
  );

  return {
    scopeMoved: () => moved?.(),
    dispose: async () => {
      // One interrupt for the whole watch: every leg and the host-map
      // subscription under them are this fiber's scope. It is AWAITED
      // so a shutdown does not race the streams it is ending, and an interrupt
      // that itself FAILS is said out loud — the process is on its way out and
      // there is nobody left to throw at, so the log is the only place a
      // teardown that did not go cleanly can be read afterwards.
      await Effect.runPromise(Fiber.interrupt(fiber)).catch((err: unknown) => {
        log.warn(
          { err },
          "kolu-server: the conductor's watch did not shut down cleanly",
        );
      });
    },
  };
}
