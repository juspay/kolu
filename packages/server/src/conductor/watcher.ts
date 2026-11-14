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
 * Per host that holds at least one member, over that host's padi: its
 * `urgency` fold, its `terminals` keys, and each member terminal's own record.
 * What each of them is WORTH is stated where they are read
 * (`kolu-conductor`'s `HostReading`). Nothing else: a screen is read by the
 * Conductor when it decides to look, and a wake carries how something STANDS
 * rather than what it printed — and the record carries the git and PR facts a
 * work's timeline is written from.
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
 * that are current (`overConnectedHosts`); membership moved
 * ({@link ConductorWatcher.membersMoved}), and the legs it chooses are
 * re-chosen; or the stream ENDED on its own — the far end went away without the
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
import type { PadiTerminal, PadiUrgency } from "@kolu/padi-client/surface";
import { Cause, Effect, Fiber, Queue, Schedule, Stream } from "effect";
import {
  type ConductorHost,
  type HostReading,
  readingsOf,
} from "kolu-conductor";
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
  /** Membership moved — re-read it and re-open the legs it now names. Cheap
   *  enough to call on every move: a leg is a subscription that opens with a
   *  snapshot, and the first frame after it is a full reading. */
  readonly membersMoved: () => void;
  /** Stop watching everything, for the shutdown. */
  readonly dispose: () => Promise<void>;
}

/** One frame off one leg, before it is folded into a reading. */
type Frame =
  | { readonly kind: "urgency"; readonly urgency: PadiUrgency }
  | { readonly kind: "roster"; readonly keys: ReadonlySet<string> }
  | {
      readonly kind: "record";
      readonly id: string;
      readonly record: PadiTerminal;
    };

/** Everything the fold needs, as the frames arrive — the two that are `null`
 *  until their first frame being exactly why nothing is reported before then. */
interface Accumulated {
  urgency: PadiUrgency | null;
  keys: ReadonlySet<string> | null;
  readonly records: Map<string, PadiTerminal>;
}

/**
 * EVERYTHING ONE HOST SAYS about the member terminals on it, as one stream of
 * complete readings. Nothing is emitted until padi's fold AND the roster have
 * both landed: `gone` is only decidable against a roster that was actually
 * read, and "in none of the four lists" means nothing before the first fold.
 *
 * One record per MEMBER and nothing above it: which piece of work a terminal
 * belongs to is STATED when it joins, so the ancestor walk this used to run
 * (re-deriving a grouping off `child-of` edges, a subscription per link) has
 * nothing left to answer.
 *
 * The emitted reading SHARES the accumulator's record map rather than copying
 * it — the consumer below hands it straight to a pure function and keeps
 * nothing, while a copy per frame would be one allocation of every member's
 * record per foreground sample, for nobody.
 */
const hostReadings = (
  host: string,
  hostName: string,
  padi: PadiSurfaceClient,
  watched: readonly string[],
): Stream.Stream<HostReading, unknown> => {
  const members: Stream.Stream<Frame, unknown>[] = [
    Stream.map(
      padi.surface.urgency.get(undefined),
      (urgency): Frame => ({ kind: "urgency", urgency }),
    ),
    Stream.map(
      padi.surface.terminals.keys(undefined),
      (keys): Frame => ({ kind: "roster", keys: new Set(keys) }),
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
    (): Accumulated => ({ urgency: null, keys: null, records: new Map() }),
    (at, frame) => {
      if (frame.kind === "urgency") at.urgency = frame.urgency;
      else if (frame.kind === "roster") at.keys = frame.keys;
      else at.records.set(frame.id, frame.record);
      const { urgency, keys } = at;
      return [
        at,
        urgency === null || keys === null
          ? []
          : [{ host, hostName, watched, urgency, keys, records: at.records }],
      ] as const;
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

  /** Pushes a membership move into the stream below — `null` until the stream
   *  is running. A move that lands in that gap is not lost: the stream's first
   *  act is to READ the membership, so it opens on whatever it says by then. */
  let moved: (() => void) | null = null;
  const membershipMoves = Stream.callback<void>((queue) =>
    Effect.gen(function* () {
      // The current membership goes out BEFORE the trigger is armed, for the
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

  /** The ids to watch on one host — the ACTIVE members of the works in
   *  progress (`ConductorHost.memberRefs`), which is the whole of what a
   *  terminal being watched means now. A ref whose host is not a member of
   *  this fleet is simply not here: works are saved with the state root and a
   *  host can be removed from the pool under them, which is not a terminal
   *  going away — nothing can be said about a machine kolu no longer holds. */
  const membersOn = (host: string): readonly string[] => {
    const ids: string[] = [];
    for (const ref of conductor().memberRefs()) {
      const split = splitFleetTerminalRef(ref);
      if (split !== null && split.host === host) ids.push(split.id);
    }
    return ids;
  };

  const legs = Stream.switchMap(membershipMoves, () =>
    overConnectedHosts(
      hosts,
      (host, padi) => {
        const watched = membersOn(host);
        // A connected host with no member on it gets no leg at all.
        if (watched.length === 0) return null;
        const reading = Stream.tapError(
          hostReadings(host, hosts.display(host), padi, watched),
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
          Stream.repeat(reading, Schedule.spaced(REOPEN_DELAY_MS)),
          Schedule.spaced(REOPEN_DELAY_MS),
        );
      },
      (_live, frames) => frames,
    ),
  );

  // Every frame is a reading of a whole host, and what is NEWS about it is the
  // conversation's own to decide (`kolu-conductor`'s per-member wake rules). A
  // reading about a ref that has just left its work is ordinary — the legs
  // re-open asynchronously — and the conversation drops it.
  //
  // A leg's own failure is retried above, so the only way this fiber ends on
  // its own is a DEFECT — a throw out of `observe` or the fold. Nothing re-opens
  // it after that, and a watch that is gone means a Conductor nobody wakes, so
  // it is said at `error` with its cause rather than ending in silence.
  const fiber = Effect.runFork(
    Effect.onExit(
      Stream.runForEach(legs, ([, reading]) =>
        Effect.sync(() => {
          const seen = readingsOf(reading);
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
    membersMoved: () => moved?.(),
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
