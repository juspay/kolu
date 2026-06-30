/**
 * The `pulam` daemon — dial a kaval, run the terminal-awareness sensors for
 * every PTY kaval owns, and serve the result as one `snapshots` collection.
 *
 * `pulam` is *ephemeral* by design: awareness is always re-derivable from live
 * taps + the current host fs, so unlike kaval it sheds all the durability
 * machinery — no single-instance gate, no PTY ownership, no persisted list, no
 * adoption. Every (re)start just re-runs the sensors and recomputes from now.
 * It borrows kaval's terminal inventory (a polled `terminal.list`) and dials
 * kaval as a plain `ptyHostSurface` client, exactly like kaval-tui — adding
 * zero awareness/git/gh logic to kaval.
 *
 *   dial kaval ─► per terminal: bridge taps → startAwareness → publish slice
 *                                                       │
 *                                          serve `snapshots` collection
 *                                          (local socket, or stdio for ssh)
 */

import {
  terminalWorkspaceSurface,
  type TerminalId,
} from "@kolu/terminal-workspace/surface";
import { pulamSocketPath } from "@kolu/terminal-workspace/socket";
import { isContractVersionCompatible } from "@kolu/surface/define";
import {
  type UnixSocketConnection,
  unixSocketLink,
} from "@kolu/surface/links/unix-socket";
import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import { serveOverStdio } from "@kolu/surface/peer-server";
import {
  type Channel,
  implementSurface,
  inMemoryChannel,
  inMemoryChannelByName,
  pollOnEvent,
} from "@kolu/surface/server";
import { serveOverUnixSocket } from "@kolu/surface/unix-socket";
import {
  bridgeKavalTaps,
  foldSnapshot,
  serveTerminalEvents,
  type TerminalEvent,
  type TerminalSnapshot,
  seedSnapshot,
  startSensors,
} from "@kolu/terminal-workspace";
import { createTerminalWorkspaceEndpoint } from "@kolu/terminal-workspace/endpoint";
import { serveTerminalWorkspace } from "@kolu/terminal-workspace/serveTerminalWorkspace";
import { implement } from "@orpc/server";
import {
  PTY_HOST_CONTRACT_VERSION,
  type PtyHostListEntry,
  ptyHostSurface,
  resolveRunningKavalSocket,
} from "kaval";
import type { Logger } from "pino";
import { createActivityTracker, sameActivitySet } from "./activity.ts";

/** How pulam exposes the awareness surface. `socket` binds a unix socket (the
 *  default, the local case); `stdio` serves over stdin/stdout — what an ssh
 *  dial speaks to (the P2 transport, built now and independently testable). */
export type PulamServe =
  | { kind: "socket"; socketPath?: string }
  | { kind: "stdio" };

export interface PulamDaemonOptions {
  /** The kaval socket to dial. Default: the running kaval, **discovered** — a
   *  standalone `kaval` or a kolu-server (which namespaces its daemon by listen
   *  port). Set explicitly (`--kaval`) only to override discovery or to pick one
   *  when several daemons are up. */
  kavalSocket?: string;
  serve: PulamServe;
  log: Logger;
  /** External stop signal (tests; a supervisor tearing it down without a real
   *  OS signal). Aborting it ends the daemon. */
  signal?: AbortSignal;
  /** Fired once the surface is being served — the readiness point a test awaits
   *  before dialing. */
  onReady?: (info: PulamReady) => void;
  /** How often to poll kaval's `terminal.list` to pick up new / departed
   *  terminals. Default 1000ms. */
  pollIntervalMs?: number;
}

export type PulamReady =
  | { kind: "socket"; socketPath: string }
  | { kind: "stdio" };

const DEFAULT_POLL_MS = 1000;

/** The kaval socket pulam dials. The selection policy (explicit wins; else
 *  discover; one→use it; many→ambiguous; none→default) plus the candidate labels
 *  live in `kaval`'s `resolveRunningKavalSocket` — beside the namespace
 *  construction they invert — so here pulam only renders the `many` case as its
 *  own `--kaval`-flavored error. */
export function resolveKavalSocket(explicit: string | undefined): string {
  const resolved = resolveRunningKavalSocket(explicit);
  if (resolved.kind === "many") {
    // Each candidate, ready to paste back after `--kaval`; the label tells a
    // port-namespaced kolu-server apart from a standalone daemon.
    const { candidates } = resolved;
    const options = candidates.map(
      ({ socket, label }) => `  --kaval ${socket}    (${label})`,
    );
    throw new Error(
      `more than one kaval is running on this host — say which to read by re-running with --kaval:\n${options.join(
        "\n",
      )}\n(e.g. pulam-tui --host <ssh> --kaval ${candidates[0]?.socket})`,
    );
  }
  return resolved.socket;
}

/** Run the pulam daemon to completion. Resolves when the serve link ends
 *  (stdio) or a stop signal fires (socket). */
export async function runPulamDaemon(opts: PulamDaemonOptions): Promise<void> {
  const { log, signal } = opts;
  const kavalSocket = resolveKavalSocket(opts.kavalSocket);

  // ── Dial kaval (upstream) and confirm a compatible contract ─────────
  let kaval: UnixSocketConnection<typeof ptyHostSurface.contract>;
  try {
    kaval = await unixSocketLink<typeof ptyHostSurface.contract>({
      socketPath: kavalSocket,
    });
  } catch (err) {
    throw new Error(
      `could not reach kaval at ${kavalSocket} (${(err as Error).message}) — is it running? Start it with \`kaval\`.`,
    );
  }
  try {
    const { contractVersion } = await kaval.client.surface.system.version({});
    if (
      !isContractVersionCompatible(contractVersion, PTY_HOST_CONTRACT_VERSION)
    ) {
      throw new Error(
        `kaval speaks pty-host ${contractVersion}, pulam needs ${PTY_HOST_CONTRACT_VERSION} — run them from the same build.`,
      );
    }
  } catch (err) {
    kaval.dispose();
    throw err instanceof Error ? err : new Error(String(err));
  }
  log.info({ kavalSocket }, "pulam: dialed kaval");

  // ── Live-output activity — the set of terminals moving bytes right now, fed
  //    from kaval's raw output tap (below) and served as the `activity` stream
  //    (snapshot-then-deltas, the whole live set per frame). The flow primitive
  //    beside the stateful collection + cell.
  const activity = createActivityTracker();

  // ── The host-side fs/git wrapper, served on the SAME surface (R6) ──
  // pulam is the remote home of `@kolu/terminal-workspace`: it serves the fs/git
  // reads (procedures) + change-pulses (watcher streams) beside awareness, off
  // the one impl kolu drives in-process — so a remote kolu (R8) mirrors the
  // whole workspace from one dial. fs/git is host-scoped (keyed by repoPath),
  // not per-terminal, so it rides outside the per-terminal sensor loop below.
  const workspace = createTerminalWorkspaceEndpoint(log);

  // ── The served workspace surface — awareness collection + version cell +
  //    activity, plus the fs/git procedures + watcher streams (R6) — assembled by
  //    the ONE shared `serveTerminalWorkspace` factory that kolu-server also calls.
  //    pulam injects only its volatile backings: the cache-backed `snapshots`
  //    store and a LIVE `activity` source over its tracker. ──
  const cache = new Map<TerminalId, TerminalSnapshot>();
  // The raw observation stream per terminal — the framed `terminalEvents` source
  // serves it (snapshot-then-deltas), so a remote kolu folds memory + recency from
  // the SAME events kolu folds locally. Distinct from the `snapshots` cache, which
  // is the LOSSY fold output (it drops the `commandRun` mark): a producer publishes
  // every emit here, then folds into the cache below. One bus per watched terminal,
  // torn down on departure.
  const eventBuses = new Map<TerminalId, Channel<TerminalEvent>>();
  const fragment = implementSurface(terminalWorkspaceSurface, {
    channel: inMemoryChannelByName(),
    ...serveTerminalWorkspace({
      snapshots: {
        readAll: () => cache,
        upsert: (key, value) => {
          cache.set(key, value);
        },
        remove: (key) => {
          cache.delete(key);
        },
      },
      // The framed event stream for one terminal — snapshot-then-deltas with a
      // per-subscription `seq`, served live off that terminal's bus + its current
      // snapshot. A subscribe for a terminal no longer watched yields one empty
      // snapshot frame and ends (the honest "nothing to stream for this id"), never
      // a hang or a throw.
      terminalEvents: {
        source: ({ terminalId }, signal) => {
          const events = eventBuses.get(terminalId);
          if (!events) {
            return (async function* () {
              yield { phase: "snapshot", events: [] } as const;
            })();
          }
          return serveTerminalEvents({
            events,
            currentSnapshot: () => cache.get(terminalId) ?? seedSnapshot(""),
            signal,
          });
        },
      },
      // Poll-on-event over the live set: yield the current set, then re-yield
      // whenever a terminal lights up or goes quiet. `sameActivitySet` suppresses
      // the redundant yield when a timer re-arm left the set unchanged.
      activity: {
        source: (_input, signal) =>
          pollOnEvent({
            read: async () => activity.snapshot(),
            isEqual: sameActivitySet,
            install: (onEvent) => activity.onChange(onEvent),
            signal,
            onReadError: () => {},
          }),
      },
      endpoint: workspace,
      log,
    }),
  });
  const router = implement(terminalWorkspaceSurface.contract).router({
    ...fragment.router,
    // biome-ignore lint/suspicious/noExplicitAny: implementSurface's Lazy<Router> spread isn't accepted by oRPC's Router<any,T> input type; the runtime shape is valid (the remote-process-monitor demo + kolu's server use the same cast).
  }) as any;

  // ── Per-terminal sensors, started on first sight, stopped on departure ──
  const watched = new Map<TerminalId, () => void>();

  /** Run the memoryless awareness PRODUCER for one terminal and accumulate its
   *  observation stream into the served `TerminalSnapshot`, publishing each update into
   *  the collection. pulam is a DASHBOARD: it remembers nothing (no recency, no
   *  resume target), so it folds only the OBSERVED half (`foldSnapshot`) — the same
   *  last-write-wins kolu's fold uses, minus the memory. Returns a stop fn. */
  const watchTerminal = (
    id: TerminalId,
    entry: PtyHostListEntry,
  ): (() => void) => {
    const abort = new AbortController();
    // The accumulated observation — seeded from the spawn-time cwd, then folded by
    // each emitted observation. Shallow-clone on publish so the collection stores an
    // independent snapshot rather than aliasing the live value.
    let snapshot: TerminalSnapshot = seedSnapshot(entry.cwd);
    // This terminal's raw event bus — every producer emission lands here (incl. the
    // `commandRun` mark the snapshot fold drops), so the framed `terminalEvents`
    // stream can replay it. Registered for the source to find; dropped on departure.
    const events = inMemoryChannel<TerminalEvent>();
    eventBuses.set(id, events);
    // Guard the upsert at the publish boundary: the emit below folds (`snapshot =
    // next`) BEFORE publishing, so a throwing awareness subscriber must not propagate
    // back into the producer's sensor loop (it would freeze the sensor) — the accepted
    // `snapshot` stays in sync regardless, and the next fold re-publishes. This keeps
    // the producer's `emit` infallible (see `startSensors`).
    const publish = (): void => {
      try {
        fragment.ctx.collections.snapshots.upsert(id, { ...snapshot });
      } catch (err) {
        log.error({ err, terminal: id }, "pulam awareness upsert threw");
      }
    };
    // Seed the collection immediately so a subscriber sees the terminal before any
    // tap fires.
    publish();

    const signals = bridgeKavalTaps(kaval.client, id, abort.signal, log);
    const stopAwareness = startSensors(
      id,
      {
        pid: entry.pid,
        cwd: entry.cwd,
        signals,
        readScreenText: async (tailLines) =>
          (
            await kaval.client.surface.terminal.getScreenText({
              id,
              extent: { kind: "tail", lines: tailLines },
            })
          ).text,
        log,
      },
      (o) => {
        // Broadcast every raw emission to the framed event stream FIRST — incl. the
        // `commandRun` mark and an `unknown` agent, which the snapshot fold no-ops
        // below: the event stream is the fold's INPUT, the cache its lossy output.
        events.publish(o);
        const next = foldSnapshot(snapshot, o);
        if (next === snapshot) return; // an `unknown` / memory-mark no-op
        snapshot = next;
        publish();
      },
    );

    // Tap raw output to drive the live-activity set (the green dot). We want only
    // the *fact* of new bytes, never the bytes themselves: skip the snapshot frame
    // (the existing screen, not motion) and treat each delta as one pulse. Held
    // for the terminal's lifetime; `abort` tears it down on departure. Drive it
    // through the same `mirrorRemoteSurface` receptacle the consume side uses, so
    // this tap reuses its subscribe/abort/swallow-AbortError teardown rather than a
    // third hand-rolled copy. (The other per-terminal taps — cwd/title/command/
    // foreground — still ride `bridgeKavalTaps`'s `bridgeStream`; folding those onto
    // the receptacle too would make the shared `@kolu/terminal-workspace` take a
    // mirror dep, a larger consolidation left for later.)
    void mirrorRemoteSurface(
      ptyHostSurface,
      kaval.client,
      {
        streams: {
          terminalAttach: {
            input: { id },
            onFrame: (msg) => {
              if (msg.kind === "delta") activity.noteOutput(id);
            },
          },
        },
      },
      {
        signal: abort.signal,
        log: (line) => log.debug({ terminal: id }, line),
      },
    ).done;

    return () => {
      abort.abort();
      stopAwareness();
      activity.forget(id);
      // Drop the bus so a later subscribe for this departed id serves the empty
      // snapshot rather than a stale one; any subscriber still attached unwinds on
      // its own signal (the producer simply stops publishing).
      eventBuses.delete(id);
    };
  };

  const reconcile = async (): Promise<void> => {
    let entries: PtyHostListEntry[];
    try {
      ({ entries } = await kaval.client.surface.terminal.list({}));
    } catch (err) {
      log.error(
        { err },
        "pulam: kaval terminal.list failed; retrying next tick",
      );
      return;
    }
    const live = new Set<TerminalId>();
    for (const entry of entries) {
      live.add(entry.id);
      if (!watched.has(entry.id)) {
        log.debug({ terminal: entry.id }, "pulam: watching terminal");
        watched.set(entry.id, watchTerminal(entry.id, entry));
      }
    }
    for (const [id, stop] of [...watched]) {
      if (live.has(id)) continue;
      log.debug({ terminal: id }, "pulam: terminal departed");
      stop();
      watched.delete(id);
      fragment.ctx.collections.snapshots.remove(id);
    }
  };

  await reconcile();
  const pollTimer = setInterval(() => {
    void reconcile();
  }, opts.pollIntervalMs ?? DEFAULT_POLL_MS);
  // Don't let the poll keep the loop alive on its own — the serve link does.
  pollTimer.unref?.();

  const teardown = (): void => {
    clearInterval(pollTimer);
    for (const stop of watched.values()) stop();
    watched.clear();
    activity.dispose();
    kaval.dispose();
  };

  // ── Serve, then tear everything down on exit ────────────────────────
  try {
    if (opts.serve.kind === "stdio") {
      opts.onReady?.({ kind: "stdio" });
      const end = serveOverStdio({
        router,
        onFirstRequest: () =>
          log.info("pulam: first RPC over stdio — link live"),
      });
      await waitForStop(signal, end);
    } else {
      const socketPath = pulamSocketPath(opts.serve.socketPath);
      const listener = await serveOverUnixSocket({ socketPath, router, log });
      if (listener.outcome.kind !== "listening") {
        throw new Error(
          `pulam could not bind its socket at ${socketPath} (${listener.outcome.kind}).`,
        );
      }
      log.info({ socketPath }, "pulam: serving awareness");
      opts.onReady?.({ kind: "socket", socketPath });
      try {
        await waitForStop(signal);
      } finally {
        listener.close();
      }
    }
  } finally {
    teardown();
  }
}

/** Resolve when the daemon should stop: an OS signal (SIGTERM/SIGINT), the
 *  external abort, or the serve link ending (`end`, for stdio). Removes every
 *  handler before resolving, so repeated daemons in one test leave none behind. */
function waitForStop(
  signal: AbortSignal | undefined,
  end?: Promise<unknown>,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const cleanups: Array<() => void> = [];
    const finish = (): void => {
      if (settled) return;
      settled = true;
      for (const c of cleanups) c();
      resolve();
    };
    for (const sig of ["SIGTERM", "SIGINT"] as const) {
      const handler = (): void => finish();
      process.on(sig, handler);
      cleanups.push(() => {
        process.off(sig, handler);
      });
    }
    if (signal) {
      if (signal.aborted) {
        finish();
        return;
      }
      const handler = (): void => finish();
      signal.addEventListener("abort", handler, { once: true });
      cleanups.push(() => signal.removeEventListener("abort", handler));
    }
    end?.then(finish, finish);
  });
}
