/**
 * The `arivu` daemon — dial a kaval, run the terminal-awareness sensors for
 * every PTY kaval owns, and serve the result as one `awareness` collection.
 *
 * `arivu` is *ephemeral* by design: awareness is always re-derivable from live
 * taps + the current host fs, so unlike kaval it sheds all the durability
 * machinery — no single-instance gate, no PTY ownership, no persisted list, no
 * adoption. Every (re)start just re-runs the sensors and recomputes from now.
 * It borrows kaval's terminal inventory (a polled `terminal.list`) and dials
 * kaval as a plain `ptyHostSurface` client, exactly like kaval-tui — adding
 * zero awareness/git/gh logic to kaval.
 *
 *   dial kaval ─► per terminal: bridge taps → startAwareness → publish slice
 *                                                       │
 *                                          serve `awareness` collection
 *                                          (local socket, or stdio for ssh)
 */

import {
  type AwarenessValue,
  arivuSurface,
  DEFAULT_VERSION,
  type TerminalId,
} from "@kolu/arivu-contract";
import { arivuSocketPath } from "@kolu/arivu-contract/socket";
import { isContractVersionCompatible } from "@kolu/surface/define";
import {
  type UnixSocketConnection,
  unixSocketLink,
} from "@kolu/surface/links/unix-socket";
import { serveOverStdio } from "@kolu/surface/peer-server";
import {
  implementSurface,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import { serveOverUnixSocket } from "@kolu/surface/unix-socket";
import {
  type AwarenessRecord,
  bridgeKavalTaps,
  seedAwarenessValue,
  startAwareness,
} from "@kolu/terminal-awareness";
import { implement } from "@orpc/server";
import {
  getPtyHostSocketPath,
  KAVAL_NS_PREFIX,
  PTY_HOST_CONTRACT_VERSION,
  type PtyHostListEntry,
  type ptyHostSurface,
} from "kaval";
import type { Logger } from "pino";
import { makeAwarenessSink } from "./hooks.ts";

/** How arivu exposes the awareness surface. `socket` binds a unix socket (the
 *  default, the local case); `stdio` serves over stdin/stdout — what an ssh
 *  dial speaks to (the P2 transport, built now and independently testable). */
export type ArivuServe =
  | { kind: "socket"; socketPath?: string }
  | { kind: "stdio" };

export interface ArivuDaemonOptions {
  /** The kaval socket to dial. Default: the standalone kaval's own socket
   *  (`$XDG_RUNTIME_DIR/kaval/pty-host.sock`). */
  kavalSocket?: string;
  serve: ArivuServe;
  log: Logger;
  /** External stop signal (tests; a supervisor tearing it down without a real
   *  OS signal). Aborting it ends the daemon. */
  signal?: AbortSignal;
  /** Fired once the surface is being served — the readiness point a test awaits
   *  before dialing. */
  onReady?: (info: ArivuReady) => void;
  /** How often to poll kaval's `terminal.list` to pick up new / departed
   *  terminals. Default 1000ms. */
  pollIntervalMs?: number;
}

export type ArivuReady =
  | { kind: "socket"; socketPath: string }
  | { kind: "stdio" };

const DEFAULT_POLL_MS = 1000;

/** Run the arivu daemon to completion. Resolves when the serve link ends
 *  (stdio) or a stop signal fires (socket). */
export async function runArivuDaemon(opts: ArivuDaemonOptions): Promise<void> {
  const { log, signal } = opts;
  const kavalSocket =
    opts.kavalSocket ?? getPtyHostSocketPath(undefined, KAVAL_NS_PREFIX);

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
        `kaval speaks pty-host ${contractVersion}, arivu needs ${PTY_HOST_CONTRACT_VERSION} — run them from the same build.`,
      );
    }
  } catch (err) {
    kaval.dispose();
    throw err instanceof Error ? err : new Error(String(err));
  }
  log.info({ kavalSocket }, "arivu: dialed kaval");

  // ── The served awareness surface — a keyed collection backed by a cache ──
  const cache = new Map<TerminalId, AwarenessValue>();
  const fragment = implementSurface(arivuSurface, {
    channel: inMemoryChannelByName(),
    cells: { version: { store: inMemoryStore(DEFAULT_VERSION) } },
    collections: {
      awareness: {
        readAll: () => cache,
        upsert: (key, value) => {
          cache.set(key, value);
        },
        remove: (key) => {
          cache.delete(key);
        },
      },
    },
  });
  const router = implement(arivuSurface.contract).router({
    ...fragment.router,
    // biome-ignore lint/suspicious/noExplicitAny: implementSurface's Lazy<Router> spread isn't accepted by oRPC's Router<any,T> input type; the runtime shape is valid (the remote-process-monitor demo + kolu's server use the same cast).
  }) as any;

  // ── Per-terminal sensors, started on first sight, stopped on departure ──
  const watched = new Map<TerminalId, () => void>();

  /** Start the awareness sensor set for one terminal, publishing each update
   *  into the collection. Returns a stop fn (sensors + tap bridge). */
  const watchTerminal = (
    id: TerminalId,
    entry: PtyHostListEntry,
  ): (() => void) => {
    const abort = new AbortController();
    const record: AwarenessRecord = {
      pid: entry.pid,
      meta: seedAwarenessValue(entry.cwd),
      currentAgent: null,
    };
    // Shallow-clone on publish: the sensors mutate `record.meta` in place (each
    // mutator replaces a whole field), so the collection must store an
    // independent snapshot per upsert rather than alias the live record.
    const publish = (meta: AwarenessValue): void =>
      fragment.ctx.collections.awareness.upsert(id, { ...meta });
    const sink = makeAwarenessSink({
      record,
      publish,
      readScreenText: async (tailLines) =>
        (await kaval.client.surface.terminal.getScreenText({ id, tailLines }))
          .text,
    });
    // Seed the collection immediately so a subscriber sees the terminal before
    // any tap fires.
    publish(record.meta);

    const signals = bridgeKavalTaps(kaval.client, id, abort.signal, log);
    // Persist cwd changes into the published value — a host concern, mirroring
    // kolu-server's local endpoint (whose cwd bridge writes `m.cwd`). The
    // channel fans out, so the git sensor still re-resolves off the same taps.
    signals.cwd.consume({
      onEvent: (cwd) =>
        sink.updateServerMetadata(record, (m) => {
          m.cwd = cwd;
        }),
      onError: () => {},
    });
    const stopAwareness = startAwareness(record, id, signals, sink, log);
    return () => {
      abort.abort();
      stopAwareness();
    };
  };

  const reconcile = async (): Promise<void> => {
    let entries: PtyHostListEntry[];
    try {
      ({ entries } = await kaval.client.surface.terminal.list({}));
    } catch (err) {
      log.error(
        { err },
        "arivu: kaval terminal.list failed; retrying next tick",
      );
      return;
    }
    const live = new Set<TerminalId>();
    for (const entry of entries) {
      live.add(entry.id);
      if (!watched.has(entry.id)) {
        log.debug({ terminal: entry.id }, "arivu: watching terminal");
        watched.set(entry.id, watchTerminal(entry.id, entry));
      }
    }
    for (const [id, stop] of [...watched]) {
      if (live.has(id)) continue;
      log.debug({ terminal: id }, "arivu: terminal departed");
      stop();
      watched.delete(id);
      fragment.ctx.collections.awareness.remove(id);
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
    kaval.dispose();
  };

  // ── Serve, then tear everything down on exit ────────────────────────
  try {
    if (opts.serve.kind === "stdio") {
      opts.onReady?.({ kind: "stdio" });
      const end = serveOverStdio({
        router,
        onFirstRequest: () =>
          log.info("arivu: first RPC over stdio — link live"),
      });
      await waitForStop(signal, end);
    } else {
      const socketPath = arivuSocketPath(opts.serve.socketPath);
      const listener = await serveOverUnixSocket({ socketPath, router, log });
      if (listener.outcome.kind !== "listening") {
        throw new Error(
          `arivu could not bind its socket at ${socketPath} (${listener.outcome.kind}).`,
        );
      }
      log.info({ socketPath }, "arivu: serving awareness");
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
