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
 * owns, a link that cannot speak the wire) is logged at ERROR and never
 * rendered as "no odu here": a face that hid a broken install behind a blank
 * panel would be lying about the machine.
 *
 * ## A KNOWN LIMIT, recorded rather than implied
 *
 * The checkout is resolved from padi's own registry on every frame read, so a
 * terminal that `cd`s re-targets as soon as anything re-derives a frame (an odu
 * board event, a new run) or the subscription re-keys (a focus change, the
 * panel reopening). A `cd` in a focused terminal with a silent odu board is the
 * one window where the readout is about the checkout the terminal just left —
 * narrow, and self-healing on the next event, which is the trade the brief's
 * "resolve the terminal's checkout" design makes in exchange for padi being the
 * single authority on which checkout a terminal is in.
 */

import type { StreamingProcedure } from "@kolu/surface/client";
import type { CollectionDeltasMsg } from "@kolu/surface/define";
import { contractIsCompatible } from "@kolu/surface-daemon";
import type { SurfaceReadFace } from "@kolu/surface/project";
import { pollOnEvent, streamFromAbortableSource } from "@kolu/surface/server";
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
  STATUS_META,
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
}

/** Dial the daemon and REFUSE one this build cannot speak.
 *
 *  The comparison is odu's own handshake predicate, over the version the
 *  daemon publishes about itself — never string equality, because an odu that
 *  only ADDED a member is still speakable by this reader and refusing it would
 *  make every additive odu change a flag day. */
async function dialChecked(): Promise<ServiceSocketDial> {
  const dialed = await dialServiceSocket();
  if (dialed.kind === "absent") return dialed;
  const cell = await Effect.runPromise(readServiceCell(dialed.client));
  if (
    !contractIsCompatible(
      SERVICE_CONTRACT_VERSION,
      cell.identity.protocolVersion,
    )
  ) {
    await dialed.dispose();
    throw new Error(
      `padi: the odu daemon at ${dialed.socketPath} speaks service contract ` +
        `${cell.identity.protocolVersion}, this build reads ` +
        `${SERVICE_CONTRACT_VERSION} — upgrade the daemon or this kolu.`,
    );
  }
  return dialed;
}

function createOduSession(
  log: Logger,
  dial: () => Promise<ServiceSocketDial>,
): OduSession {
  const listeners = new Set<() => void>();
  let board: Board = new Map();
  let epoch = 0;
  let connection: ServiceSocketConnection | null = null;
  let holders = 0;
  let controller: AbortController | null = null;
  let loop: Promise<void> | null = null;
  let retire: NodeJS.Timeout | null = null;

  const announce = (): void => {
    for (const listener of [...listeners]) listener();
  };

  /** The dial-and-follow loop. One iteration is one link's lifetime: dial,
   *  follow the board until the link or the stream dies, then start over. */
  async function follow(signal: AbortSignal): Promise<void> {
    // Once per session, at debug: a readout that renders nothing must be
    // diagnosable ("is odu even installed here?") without a debugger.
    log.debug(
      { socketPath: serviceSocketPath() },
      "padi: odu ciStatus — dialling odu's service socket",
    );
    let delayMs = DIAL_RETRY_MIN_MS;
    while (!signal.aborted) {
      let dialed: ServiceSocketDial | null = null;
      try {
        dialed = await dial();
      } catch (err) {
        // A daemon that ANSWERED and could not be used. Not absence, and not
        // transient: loud, and re-checked at the ceiling rather than the floor.
        log.error(
          { err },
          "padi: odu ciStatus — the daemon refused this build",
        );
        delayMs = DIAL_RETRY_MAX_MS;
      }
      if (dialed === null || dialed.kind === "absent") {
        if (connection !== null) {
          connection = null;
          board = new Map();
          epoch += 1;
          announce();
        }
        await abortableDelay(delayMs, signal);
        delayMs = Math.min(delayMs * 2, DIAL_RETRY_MAX_MS);
        continue;
      }
      delayMs = DIAL_RETRY_MIN_MS;
      connection = dialed;
      // A fresh link starts from a fresh board: the `deltas` stream's first
      // frame is a full snapshot, so this is a reset rather than a gap.
      board = new Map();
      epoch += 1;
      announce();
      try {
        await bridgeStream(
          (dialed.client as unknown as OduServiceFace).surface.runs.deltas(
            undefined,
          ),
          signal,
          (message) => {
            board = applyBoard(board, message);
            announce();
          },
          (err) =>
            log.error(
              { err },
              "padi: odu ciStatus — the runs stream failed; re-dialling",
            ),
        );
      } catch (err) {
        if (!signal.aborted) {
          log.warn(
            { err },
            "padi: odu ciStatus — the runs stream dropped; re-dialling",
          );
        }
      } finally {
        connection = null;
        await dialed.dispose();
      }
      if (signal.aborted) return;
      await abortableDelay(delayMs, signal);
    }
  }

  const stopSession = (): void => {
    controller?.abort();
    controller = null;
    loop = null;
  };

  return {
    attach(onChange) {
      if (retire !== null) {
        clearTimeout(retire);
        retire = null;
      }
      listeners.add(onChange);
      holders += 1;
      if (loop === null) {
        controller = new AbortController();
        loop = follow(controller.signal);
      }
      let detached = false;
      return () => {
        if (detached) return;
        detached = true;
        listeners.delete(onChange);
        holders -= 1;
        if (holders > 0) return;
        retire = setTimeout(() => {
          retire = null;
          stopSession();
        }, RETIRE_GRACE_MS);
        retire.unref?.();
      };
    },
    board: () => board,
    epoch: () => epoch,
    connection: () => connection,
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

/** One checkout's runs, NEWEST `createdAt` first.
 *
 *  This equality is the whole join between the two systems: odu's `repoRoot` is
 *  the absolute checkout a run was started in, which is the same value padi's
 *  own git fact carries for a terminal (`git rev-parse --show-toplevel`).
 *  `runId` breaks a `createdAt` tie so the order is TOTAL — two runs registered
 *  in the same millisecond must not swap places between two reads of one board,
 *  because the Inspector re-derives on every delta and a list that reshuffles
 *  without anything having changed reads as activity. */
function runsForCheckout(board: Board, checkoutRoot: string): RunRow[] {
  const mine: RunRow[] = [];
  for (const row of board.values()) {
    if (row.repoRoot === checkoutRoot) mine.push(row);
  }
  return mine.sort(
    (a, b) => b.createdAt - a.createdAt || (a.runId < b.runId ? -1 : 1),
  );
}

/** A run's nodes in TRIAGE order — what broke, what is still moving, what is
 *  done — each rank in the run's own scheduling order (`frame.order`, the order
 *  odu promises a dashboard paints). odu's own faces deliberately keep roster
 *  order; this ordering exists for the Inspector's lane list, and it is applied
 *  HERE so the wire order is the painted order and no consumer re-sorts.
 *
 *  "Red" is `STATUS_META`'s own `isRed` column — odu's assignment, not kolu's
 *  copy of it. */
function laneTriage(frame: NodesFrame): RunNode[] {
  const byId = new Map(frame.nodes.map((node) => [node.id, node]));
  const ordered: RunNode[] = [];
  for (const id of frame.order) {
    const node = byId.get(id);
    if (node !== undefined) ordered.push(node);
  }
  const listed = new Set(frame.order);
  for (const node of frame.nodes) if (!listed.has(node.id)) ordered.push(node);
  const rank = (node: RunNode): number =>
    STATUS_META[node.status].isRed ? 0 : node.status === "running" ? 1 : 2;
  return ordered.sort((a, b) => rank(a) - rank(b));
}

/** The checkout a terminal is in, off padi's OWN registry (`snapshotFor`, the
 *  source of truth for that mapping) — never re-derived from the filesystem
 *  here. Null when the terminal is unknown, or has no git repo (yet). */
function checkoutRootOf(terminalId: string): string | null {
  const git = snapshotFor(terminalId)?.git;
  return git?.kind === "repo" ? git.info.repoRoot : null;
}

/** The `ciStatus` stream backing shape — the `source` thunk padi wires. */
export interface CiStatusSourceDeps {
  source: (input: CiStatusInput) => Stream.Stream<CiStatusFrame>;
}

/** Build the `ciStatus` source. ONE session per padi, created here, shared by
 *  every subscription. */
export function createCiStatusSource(deps: {
  log: Logger;
}): CiStatusSourceDeps {
  const session = createOduSession(deps.log, dialChecked);
  return {
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
                lanes = laneTriage(frame);
                serial += 1;
                notify();
              },
              (err) =>
                deps.log.error(
                  { err, runId: wanted },
                  "padi: odu ciStatus — the nodes stream failed",
                ),
            );
          };

          /** The frame, derived from what the session and this subscription
           *  currently hold. The checkout is resolved HERE, on every read, so a
           *  terminal that moved is picked up by the next event rather than
           *  cached into the subscription's life. */
          const frame = (): CiStatusFrame => {
            const checkoutRoot = checkoutRootOf(input.terminalId);
            if (checkoutRoot === null) return { kind: "none" };
            const runs = runsForCheckout(session.board(), checkoutRoot);
            const latest = runs[0];
            if (latest === undefined) return { kind: "none" };
            return {
              kind: "status",
              latest: { run: latest, lanes },
              recent: runs.slice(0, CI_STATUS_RECENT_RUNS),
            };
          };

          const unsubscribe = session.attach(() => {
            const checkoutRoot = checkoutRootOf(input.terminalId);
            const runs =
              checkoutRoot === null
                ? []
                : runsForCheckout(session.board(), checkoutRoot);
            syncNodes(runs[0] ?? null);
            serial += 1;
            notify();
          });

          try {
            for await (const item of pollOnEvent<{
              serial: number;
              frame: CiStatusFrame;
            }>({
              read: async () => ({ serial, frame: frame() }),
              // The frame is a fold of everything above, so "did anything
              // move" is the serial and nothing else. One redundant frame per
              // unrelated board tick is the price of never re-emitting a frame
              // whose inputs did not change.
              isEqual: (a, b) => a.serial === b.serial,
              install: (onEvent) => {
                notify = onEvent;
                // The subscription's own opening read of the board: `install`
                // runs BEFORE the initial read, so the first frame is derived
                // from the board as it stands and with its nodes follow already
                // opened.
                const checkoutRoot = checkoutRootOf(input.terminalId);
                const runs =
                  checkoutRoot === null
                    ? []
                    : runsForCheckout(session.board(), checkoutRoot);
                syncNodes(runs[0] ?? null);
                return unsubscribe;
              },
              signal: sig,
              onReadError: (err) =>
                deps.log.error(
                  { err },
                  "padi: odu ciStatus — a frame read failed",
                ),
            })) {
              yield item.frame;
            }
          } finally {
            stopNodes();
            unsubscribe();
          }
        })(),
      ),
  };
}
