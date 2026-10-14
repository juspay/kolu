/**
 * padi's `ciStatus` source — the Inspector's odu CI readout for ONE terminal's
 * checkout.
 *
 * odu's web daemon publishes a board of every run it has recorded (one row per
 * run) and, per run, a stream of the run's nodes. This module is the whole of
 * kolu's odu integration: it dials that daemon DEMAND-DRIVEN, follows the
 * board, folds it down to one checkout, and publishes a full-replacement frame
 * the Inspector paints. Every odu-shaped fact it handles — the contract, the
 * schemas, the socket path, the dial, the node-status vocabulary — is odu's
 * own (`@odu/service-client`, `@odu/run-client`), grafted from the npins `odu`
 * pin; what is kolu's here is the two readings below (which runs belong to a
 * checkout, and how a run's lanes are ordered for a person) and the session
 * that keeps the daemon at arm's length.
 *
 * ## Demand-driven, and ref-counted
 *
 * odu is a per-user singleton that outlives its callers, and it is absent on
 * most machines. So the session dials on the FIRST subscriber, follows the
 * board for as long as somebody is looking, and — after a retire grace — lets
 * the link go when the last one leaves. Nothing dials while nobody is looking
 * (the Inspector is shown-gated on the client side, so a closed panel is not a
 * subscriber), and nothing ever STARTS odu: bootstrapping is `odu web`'s job.
 *
 * ## Why the dial loop is the retry fence
 *
 * The framework's client-side fence (`fenceStream`) exists because a dropped
 * websocket reconnects without re-issuing the in-flight subscriptions. A unix
 * socket has no such layer at all — `unixSocketLink` says so outright ("no
 * reconnect: the link dies with the socket; callers that need reconnect dial a
 * fresh one") — so the re-dial loop here IS the fence, and it re-establishes
 * the subscriptions from scratch: the board is cleared and re-snapshotted (the
 * `deltas` stream opens with a full snapshot, invariant 2), and every
 * subscriber's nodes follow is reopened on the new epoch. A frame a consumer
 * sees after a reconnect is therefore always a fresh snapshot, never a delta
 * appended to a stale accumulator.
 *
 * ## Absence is a value; a broken daemon is not
 *
 * `dialServiceSocket` answers `{ kind: "absent" }` for ENOENT/ECONNREFUSED —
 * the ordinary state of a machine that has never run odu — and this module
 * turns that into `{ kind: "none" }` frames. Everything else (a daemon that
 * answers with a contract this build cannot speak, a socket somebody else
 * owns, a link that cannot speak the wire) is logged at ERROR **and fails the
 * subscription**: the frame stays `none`/`status` and the failure rides the
 * stream's own error channel, so a face draws an explicit failure rather than a
 * blank. A blank is what "there is no odu here" looks like, and a broken
 * install that renders as one is a lie about the machine.
 *
 * ## A KNOWN LIMIT, recorded rather than implied
 *
 * The checkout is resolved from padi's own registry on every frame read, so a
 * terminal that `cd`s re-targets as soon as anything re-derives a frame (an odu
 * board event, a new run) or the subscription re-keys (a focus change, the
 * panel reopening). A `cd` in a focused terminal with a silent odu board is the
 * one window where the readout is about the checkout the terminal just left —
 * narrow, and self-healing on the next event. That is the trade padi's being
 * the single authority on which checkout a terminal is in costs.
 */

import type { StreamingProcedure } from "@kolu/surface/client";
import type { CollectionDeltasMsg } from "@kolu/surface/define";
import { contractIsCompatible } from "@kolu/surface-daemon";
import type { SurfaceReadFace } from "@kolu/surface/project";
import { pollOnEvent, streamFromAbortableSource } from "@kolu/surface/server";
import { runsForCheckout } from "@odu/service-client/board";
import { serviceBind } from "@odu/service-client/endpoint";
import { readServiceCell } from "@odu/service-client/dial";
import {
  dialServiceSocket,
  serviceSocketPath,
} from "@odu/service-client/socket";
import type {
  ServiceSocketConnection,
  ServiceSocketDial,
} from "@odu/service-client/socket";
import {
  SERVICE_CONTRACT_VERSION,
  type NodesFrame,
  type RunNode,
  type RunRow,
  type oduServiceSurface,
} from "@odu/service-client/surface";
import { Effect, type Stream } from "effect";
import type { Logger } from "pino";
import {
  CI_STATUS_RECENT_RUNS,
  type CiStatusFrame,
  type CiStatusInput,
} from "@kolu/padi-client/surface";
import { abortableDelay } from "./abortableDelay.ts";
import { bridgeStream } from "./terminalEndpoint/local.ts";
import { snapshotFor } from "./terminal-registry.ts";

/** The board, as odu publishes it: run id → row. */
type Board = ReadonlyMap<string, RunRow>;

/** odu's service face, as KOLU reads it.
 *
 *  `oduServiceClientOver` hands back the framework's `SurfaceReadFace`, which
 *  deliberately declines COLLECTIONS — it exists for a projection's `deps`,
 *  which consumes cells and streams and never walks a collection — and the board
 *  IS a collection: kolu follows `runs.deltas`. So the one verb kolu needs is
 *  spelled here, on the sides the face actually mints it (encoded in, decoded
 *  out), exactly as `@kolu/padi-client/dial` spells padi's own collection verbs
 *  for the same reason. One cast per connection, and it is a cast over a value
 *  odu itself built with `buildSurfaceFace`. */
type OduServiceFace = {
  readonly surface: SurfaceReadFace<typeof oduServiceSurface.spec> & {
    runs: {
      deltas: StreamingProcedure<
        undefined,
        CollectionDeltasMsg<string, RunRow>
      >;
    };
  };
};

/** The dial retry ladder while nothing is listening. Two seconds is fast enough
 *  that starting `odu web` beside an open Inspector shows up on its own, and a
 *  failing connect to a path with nothing on it is a syscall rather than a
 *  process, so the cost of the floor is not the cost of a spawn. */
const DIAL_RETRY_MIN_MS = 2_000;

/** The ceiling, and the cadence a REFUSAL is re-checked at (a contract skew is
 *  not transient, so it must not spin at the floor). */
const DIAL_RETRY_MAX_MS = 60_000;

/** How long the session outlives its LAST subscriber (juspay/kolu#2286). The
 *  Inspector re-keys its subscription onto the focused terminal, so a focus
 *  switch between two terminals of one checkout unsubscribes and resubscribes
 *  in the same tick; without a grace window that is a dial torn down and
 *  rebuilt — and everything the new subscription asked for would be answered
 *  from a board it has not read yet. 30s is past any focus cadence and far
 *  short of "nobody is looking any more". */
const RETIRE_GRACE_MS = 30_000;

/** The shared odu session — ONE dial and ONE board follow for the whole daemon,
 *  however many subscriptions are looking at it. */
interface OduSession {
  /** Look at the board; the returned function looks away (idempotent). */
  attach(onChange: () => void): () => void;
  board(): Board;
  /** Bumped on every (re)connect, so a subscriber can tell that the link under
   *  its nodes follow is a different link. */
  epoch(): number;
  /** The live face, or null while nothing is serving. */
  connection(): ServiceSocketConnection | null;
  /** The port the connected daemon ANSWERS ON — its own greeting's origin, not
   *  a default re-derived here. The port is the daemon's fact (its env, its
   *  flags), it is what a link to its page has to dial, and the one channel that
   *  has already reached it is the greeting. Null while nothing is connected. */
  originPort(): number | null;
  /** The last FATAL dial failure — a daemon that answered and could not be used
   *  — or null when the session is merely absent or connected. A subscriber
   *  FAILS with it rather than rendering nothing: absence is a state a face
   *  draws nothing for, and a broken install is not. */
  failure(): Error | null;
  /** Let the session go: stop the loop and drop any link it holds. */
  dispose(): Promise<void>;
}

/** A dial's answer, and what the daemon said about ITSELF when it answered —
 *  the port it is actually bound on, which no reader can derive. */
export interface Dialed {
  dial: ServiceSocketDial;
  /** Null for an absence: nothing answered, so nothing named an address. */
  originPort: number | null;
}

/** How long a dial AND its contract handshake may take before the session gives
 *  up on that attempt. Loopback answers in microseconds and odu's own dial
 *  bounds its first open at 3 s, so this is the same order of magnitude: a
 *  bound-but-wedged daemon (a socket that accepts and then says nothing) must
 *  not hold the loop open forever. */
const DIAL_DEADLINE_MS = 3_000;

/** Dial the daemon and REFUSE one this build cannot speak.
 *
 *  The comparison is odu's own handshake predicate, over the version the
 *  daemon publishes about itself — never string equality, because an odu that
 *  only ADDED a member is still speakable by this reader and refusing it would
 *  make every additive odu change a flag day. */
async function dialChecked(): Promise<Dialed> {
  const dialed = await dialServiceSocket();
  if (dialed.kind === "absent") return { dial: dialed, originPort: null };
  try {
    const cell = await Effect.runPromise(readServiceCell(dialed.client));
    if (
      !contractIsCompatible(
        SERVICE_CONTRACT_VERSION,
        cell.identity.protocolVersion,
      )
    ) {
      throw new Error(
        `padi: the odu daemon at ${dialed.socketPath} speaks service contract ` +
          `${cell.identity.protocolVersion}, this build reads ` +
          `${SERVICE_CONTRACT_VERSION} — upgrade the daemon or this kolu.`,
      );
    }
    return { dial: dialed, originPort: serviceBind(cell.identity.origin).port };
  } catch (err) {
    // A link nobody will use still holds the dial, ping and response fibers.
    await dialed.dispose();
    throw err;
  }
}

/** {@link dialChecked}, bounded and interruptible — `null` when the deadline or
 *  the session's stop won the race. A dial that finishes AFTER either of those
 *  has nobody to hand its link to, so it disposes it rather than leaking it. */
function dialWithin(
  signal: AbortSignal,
  dial: () => Promise<Dialed>,
): Promise<Dialed | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (): boolean => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      return true;
    };
    const onAbort = (): void => {
      if (done()) resolve(null);
    };
    const timer = setTimeout(() => {
      if (done()) resolve(null);
    }, DIAL_DEADLINE_MS);
    timer.unref?.();
    signal.addEventListener("abort", onAbort, { once: true });
    dial().then(
      (dialed) => {
        if (!done()) {
          if (dialed.dial.kind === "connected") void dialed.dial.dispose();
          return;
        }
        resolve(dialed);
      },
      (err) => {
        if (done()) reject(err);
      },
    );
  });
}

function createOduSession(
  log: Logger,
  dial: () => Promise<Dialed>,
): OduSession {
  const listeners = new Set<() => void>();
  let board: Board = new Map();
  let epoch = 0;
  let connection: ServiceSocketConnection | null = null;
  /** The connected daemon's own bound port ({@link OduSession.originPort}). */
  let originPort: number | null = null;
  let failure: Error | null = null;
  let live: AbortController | null = null;
  let loop: Promise<void> | null = null;
  /** Which loop is CURRENT. A loop that has been superseded (a retire that a
   *  new subscriber raced) must not publish: its `finally` would otherwise
   *  clear the board and the link its successor had just established. */
  let generation = 0;
  let retire: NodeJS.Timeout | null = null;

  const announce = (): void => {
    for (const listener of [...listeners]) listener();
  };

  /** Hand over to a link (or to none) — the ONE place the connection, its
   *  address and the board it published change together. The board goes with
   *  the link in both directions: a fresh link's first frame is a full
   *  snapshot, so this is a reset rather than a gap, and a dead daemon must not
   *  keep painting a live board. `epoch` is what tells a nodes follow the link
   *  under it is not the link it opened. */
  const relink = (
    next: ServiceSocketConnection | null,
    port: number | null,
  ): void => {
    connection = next;
    originPort = next === null ? null : port;
    board = new Map();
    epoch += 1;
    announce();
  };

  /** The dial-and-follow loop. One iteration is one link's lifetime: dial,
   *  follow the board until the link or the stream dies, then start over. */
  async function follow(signal: AbortSignal, gen: number): Promise<void> {
    // Once per session, at debug: a readout that renders nothing must be
    // diagnosable ("is odu even installed here?") without a debugger.
    log.debug(
      { socketPath: serviceSocketPath() },
      "padi: odu ciStatus — dialling odu's service socket",
    );
    const current = (): boolean => gen === generation && !signal.aborted;
    let delayMs = DIAL_RETRY_MIN_MS;
    while (!signal.aborted) {
      let dialed: Dialed | null = null;
      try {
        dialed = await dialWithin(signal, dial);
      } catch (err) {
        // A daemon that ANSWERED and could not be used: a contract this build
        // cannot speak, a socket somebody else owns, a link that cannot speak
        // the wire. NOT absence — a subscriber fails with it rather than
        // drawing nothing, and it is re-checked at the ceiling rather than the
        // floor because the condition is not transient.
        if (current()) {
          log.error(
            { err },
            "padi: odu ciStatus — the daemon refused this build",
          );
          failure = err instanceof Error ? err : new Error(String(err));
          announce();
        }
        delayMs = DIAL_RETRY_MAX_MS;
      }
      if (dialed === null) {
        // The deadline or the stop won. Nothing changed hands; retry.
        if (signal.aborted) return;
        await abortableDelay(delayMs, signal);
        delayMs = Math.min(delayMs * 2, DIAL_RETRY_MAX_MS);
        continue;
      }
      if (dialed.dial.kind === "absent") {
        if (current()) {
          // The daemon is GONE now, which is a different fact from the one an
          // earlier iteration recorded. A failure kept past an absence would
          // render "odu CI unavailable" on a machine where odu is simply not
          // installed — forever, since the session lives as long as padi does
          // and nothing else would ever clear it.
          failure = null;
        }
        if (current() && connection !== null) relink(null, null);
        await abortableDelay(delayMs, signal);
        delayMs = Math.min(delayMs * 2, DIAL_RETRY_MAX_MS);
        continue;
      }
      if (!current()) {
        // Stopped while dialling: the link is nobody's now.
        await dialed.dial.dispose();
        return;
      }
      delayMs = DIAL_RETRY_MIN_MS;
      failure = null;
      relink(dialed.dial, dialed.originPort);
      try {
        await bridgeStream(
          (dialed.dial.client as unknown as OduServiceFace).surface.runs.deltas(
            undefined,
          ),
          signal,
          (message) => {
            if (!current()) return;
            board = applyBoard(board, message);
            announce();
          },
          // `bridgeStream` routes a stream failure here and keeps its promise,
          // so this is the ordinary end of a subscription — an `odu web` that
          // was stopped, not a defect in this process.
          (err) =>
            log.warn(
              { err },
              "padi: odu ciStatus — the runs stream ended; re-dialling",
            ),
        );
      } finally {
        await dialed.dial.dispose();
        // The drop edge is the connect edge's mirror — `relink(null, null)`.
        if (current()) relink(null, null);
      }
      if (signal.aborted) return;
      await abortableDelay(delayMs, signal);
    }
  }

  /** Let the session go: stop the loop and wait for it, so an `attach` racing
   *  this cannot start a second loop over the first one's teardown. */
  async function stopSession(): Promise<void> {
    const running = loop;
    generation += 1;
    const stopping = live;
    live = null;
    stopping?.abort();
    if (running !== null) await running;
    if (loop === running) loop = null;
  }

  return {
    originPort: () => originPort,
    attach(onChange) {
      if (retire !== null) {
        clearTimeout(retire);
        retire = null;
      }
      listeners.add(onChange);
      if (live === null) {
        live = new AbortController();
        loop = follow(live.signal, ++generation);
      }
      let detached = false;
      return () => {
        if (detached) return;
        detached = true;
        listeners.delete(onChange);
        if (listeners.size > 0) return;
        retire = setTimeout(() => {
          retire = null;
          void stopSession();
        }, RETIRE_GRACE_MS);
        retire.unref?.();
      };
    },
    board: () => board,
    epoch: () => epoch,
    connection: () => connection,
    failure: () => failure,
    dispose: stopSession,
  };
}

/** One board delta folded in. The snapshot arm REPLACES (it is what a fresh or
 *  re-established subscription opens with); the delta arm upserts and removes. */
function applyBoard(
  board: Board,
  message: CollectionDeltasMsg<string, RunRow>,
): Board {
  const next = new Map(board);
  if (message.kind === "snapshot") {
    next.clear();
    for (const [key, row] of message.entries) next.set(key, row);
    return next;
  }
  for (const [key, row] of message.upserts) next.set(key, row);
  for (const key of message.removes) next.delete(key);
  return next;
}

/** A run's nodes, flattened into the run's own scheduling order (`frame.order`,
 *  the order odu promises a dashboard paints), with any node the order does not
 *  mention appended.
 *
 *  SHAPE only, no rank: what a reader wants first is the Inspector's preference
 *  and belongs to the Inspector, where the tile list's own triage order already
 *  lives. This is the one place a `NodesFrame` — a shape that never crosses the
 *  wire — becomes the array every frame carries. */
function orderedNodes(frame: NodesFrame): RunNode[] {
  const byId = new Map(frame.nodes.map((node) => [node.id, node]));
  const ordered: RunNode[] = [];
  for (const id of frame.order) {
    const node = byId.get(id);
    if (node !== undefined) ordered.push(node);
  }
  const listed = new Set(frame.order);
  for (const node of frame.nodes) if (!listed.has(node.id)) ordered.push(node);
  return ordered;
}

/** The checkout a terminal is in, off padi's OWN registry (`snapshotFor`, the
 *  source of truth for that mapping) — never re-derived from the filesystem
 *  here. Null when the terminal is unknown, or has no git repo (yet). */
function checkoutRootOf(terminalId: string): string | null {
  const git = snapshotFor(terminalId)?.git;
  return git?.kind === "repo" ? git.info.repoRoot : null;
}

/** The `ciStatus` stream backing shape — the `source` thunk padi wires, plus
 *  the session's teardown for the daemon's own lifetime (`servePadi`'s
 *  `disposeStanding`: the session owns a ref'd socket handle, and a rebuild —
 *  a test's, a restart's — must let the prior one go). */
export interface CiStatusSourceDeps {
  source: (input: CiStatusInput) => Stream.Stream<CiStatusFrame>;
  dispose: () => Promise<void>;
}

/** Build the `ciStatus` source. ONE session per padi, created here, shared by
 *  every subscription.
 *
 *  `dial` is the seam the suite drives: counting dials, dropping a link
 *  mid-session and staging a refusal are all facts about the SESSION, and the
 *  real socket cannot stage them. Production uses {@link dialChecked}. */
export function createCiStatusSource(deps: {
  log: Logger;
  dial?: () => Promise<Dialed>;
}): CiStatusSourceDeps {
  const session = createOduSession(deps.log, deps.dial ?? dialChecked);
  return {
    dispose: () => session.dispose(),
    // An async generator so teardown rides its `finally` — it fires whether the
    // subscription ends by the framework's abort OR by the consumer stopping
    // iteration (the stream signal is `AbortSignal | undefined`, so tying
    // teardown to it alone would leak when no signal is passed). A LOCAL abort,
    // chained from the framework signal, ends the nodes follow.
    source: (input) =>
      streamFromAbortableSource<CiStatusFrame>((signal) =>
        (async function* ciStatusFrames(): AsyncGenerator<CiStatusFrame> {
          const localAbort = new AbortController();
          if (signal.aborted) localAbort.abort();
          else
            signal.addEventListener("abort", () => localAbort.abort(), {
              once: true,
            });
          const sig = localAbort.signal;

          /** Which run's lanes this subscription is following, and on which
           *  link epoch — the pair that decides when the follow must be
           *  reopened. */
          let followedRunId: string | null = null;
          let followedEpoch = -1;
          let lanes: RunNode[] = [];
          let nodesAbort: AbortController | null = null;
          /** Bumped by everything that could move the derived frame, so the
           *  poll loop's change test is a comparison rather than a deep walk of
           *  a frame whose rows are odu's own structures. */
          let serial = 0;
          let notify: () => void = () => {};

          const stopNodes = (): void => {
            nodesAbort?.abort();
            nodesAbort = null;
            followedRunId = null;
            followedEpoch = -1;
            lanes = [];
          };

          /** Keep ONE nodes follow open: reopen it when the run it watches is
           *  no longer this checkout's latest, or when the link under it is a
           *  different link. */
          const syncNodes = (latest: RunRow | null): void => {
            const wanted = latest?.runId ?? null;
            const epoch = session.epoch();
            if (wanted === followedRunId && epoch === followedEpoch) return;
            stopNodes();
            followedRunId = wanted;
            followedEpoch = epoch;
            const connection = session.connection();
            if (wanted === null || connection === null) return;
            const ac = new AbortController();
            nodesAbort = ac;
            if (sig.aborted) ac.abort();
            else
              sig.addEventListener("abort", () => ac.abort(), { once: true });
            void bridgeStream(
              (
                connection.client as unknown as OduServiceFace
              ).surface.nodes.get({
                runId: wanted,
              }),
              ac.signal,
              (frame) => {
                lanes = orderedNodes(frame);
                serial += 1;
                notify();
              },
              (err) => {
                deps.log.error(
                  { err, runId: wanted },
                  "padi: odu ciStatus — the nodes stream failed",
                );
                // Forget what was being followed, or the guard above would
                // block every reopen and freeze the lanes while the chip went
                // on reporting the run. The next board event (or epoch) retries.
                // The abort is a no-op on a stream that has already failed, so
                // the reset is the one `stopNodes` spells.
                if (nodesAbort === ac) stopNodes();
              },
            );
          };

          /** The checkout's runs, newest first, off what the session currently
           *  holds. The checkout is resolved HERE, on every read, so a terminal
           *  that moved is picked up by the next event rather than cached into
           *  the subscription's life; the runs come from the board the session
           *  publishes. */
          const runs = (): RunRow[] => {
            const checkoutRoot = checkoutRootOf(input.terminalId);
            return checkoutRoot === null
              ? []
              : runsForCheckout(session.board().values(), checkoutRoot);
          };

          /** The frame, derived from those runs and the lanes being followed. */
          const frame = (): CiStatusFrame => {
            const mine = runs();
            const latest = mine[0];
            if (latest === undefined) return { kind: "none" };
            const port = session.originPort();
            if (port === null) {
              // A board cannot outlive the link that published it, and a link
              // cannot exist without the port its own greeting named.
              throw new Error(
                "padi: odu ciStatus — a board arrived with no link behind it",
              );
            }
            return {
              kind: "status",
              port,
              latest: { run: latest, lanes },
              recent: mine.slice(0, CI_STATUS_RECENT_RUNS),
            };
          };

          const unsubscribe = session.attach(() => {
            syncNodes(runs()[0] ?? null);
            serial += 1;
            notify();
          });

          try {
            for await (const _tick of pollOnEvent<number>({
              read: async () => serial,
              // The frame is a fold of everything above, so "did anything
              // move" is the serial and nothing else. One redundant frame per
              // unrelated board tick is the price of never re-emitting a frame
              // whose inputs did not change.
              isEqual: (a, b) => a === b,
              install: (onEvent) => {
                notify = onEvent;
                // The subscription's own opening read of the board: `install`
                // runs BEFORE the initial read, so the first frame is derived
                // from the board as it stands and with its nodes follow already
                // opened.
                syncNodes(runs()[0] ?? null);
                return unsubscribe;
              },
              signal: sig,
              onReadError: (err) =>
                deps.log.error(
                  { err },
                  "padi: odu ciStatus — a frame read failed",
                ),
            })) {
              // A daemon that answered and cannot be read is NOT "nothing to
              // show": the subscription fails with it, and the Inspector draws
              // that failure rather than a blank.
              const fatal = session.failure();
              if (fatal !== null) throw fatal;
              yield frame();
            }
          } finally {
            stopNodes();
            unsubscribe();
          }
        })(),
      ),
  };
}
