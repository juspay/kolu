/**
 * The `pulam` daemon — dial a kaval, `createPulam`, serve the result.
 *
 * The whole awareness assembly (per-terminal sensors, the sink, the byte-tap, the
 * reconcile loop) lives in the pulam-library behind {@link createPulam}; the
 * daemon is a thin shell around it: dial a kaval (the connection it owns), build a
 * pulam against that client with a cache-backed `awareness` store, and serve the
 * surface over a unix socket (the local case) or stdio (what an ssh dial speaks).
 *
 * `pulam` is *ephemeral* by design: awareness is always re-derivable from live
 * taps + the current host fs, so unlike kaval it sheds all the durability
 * machinery — no single-instance gate, no PTY ownership, no persisted list, no
 * adoption. Every (re)start just re-runs the sensors and recomputes from now.
 *
 *   dial kaval ─► createPulam(kaval) ─► serve (local socket, or stdio for ssh)
 */

import { isContractVersionCompatible } from "@kolu/surface/define";
import {
  type UnixSocketConnection,
  unixSocketLink,
} from "@kolu/surface/links/unix-socket";
import { serveOverStdio } from "@kolu/surface/peer-server";
import { implementSurface, inMemoryChannelByName } from "@kolu/surface/server";
import { serveOverUnixSocket } from "@kolu/surface/unix-socket";
import { createPulam } from "@kolu/pulam-library/createPulam";
import { createTerminalWorkspaceEndpoint } from "@kolu/pulam-library/endpoint";
import {
  type AwarenessValue,
  terminalWorkspaceSurface,
  type TerminalId,
} from "@kolu/pulam-library/surface";
import { pulamSocketPath } from "@kolu/pulam-library/socket";
import { implement } from "@orpc/server";
import {
  PTY_HOST_CONTRACT_VERSION,
  type ptyHostSurface,
  resolveRunningKavalSocket,
} from "kaval";
import type { Logger } from "pino";

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

  // ── The served workspace surface — assembled by `createPulam`, the
  //    pulam-library's ONE assembly: the per-terminal sensors, the awareness sink,
  //    the raw-output byte tap, and the reconcile loop all live there, not here.
  //    The daemon injects only its volatile backing — a cache-backed `awareness`
  //    store it owns, read by the served collection and written by the sink
  //    through the implemented surface (handed to `pulam.start` below). ──
  const cache = new Map<TerminalId, AwarenessValue>();
  const pulam = createPulam({
    kaval: kaval.client,
    awareness: {
      readAll: () => cache,
      upsert: (key, value) => {
        cache.set(key, value);
      },
      remove: (key) => {
        cache.delete(key);
      },
    },
    endpoint: createTerminalWorkspaceEndpoint(log),
    log,
    pollIntervalMs: opts.pollIntervalMs,
  });
  const fragment = implementSurface(terminalWorkspaceSurface, {
    channel: inMemoryChannelByName(),
    ...pulam.served,
  });
  const router = implement(terminalWorkspaceSurface.contract).router({
    ...fragment.router,
    // biome-ignore lint/suspicious/noExplicitAny: implementSurface's Lazy<Router> spread isn't accepted by oRPC's Router<any,T> input type; the runtime shape is valid (the remote-process-monitor demo + kolu's server use the same cast).
  }) as any;

  // Begin watching kaval's terminals — each terminal's sensors publish through the
  // implemented collection. The initial reconcile runs here (awaited), so a client
  // dialing right after `onReady` already sees the current terminals. `stopPulam`
  // tears the whole sensor lifecycle down; the daemon disposes the connection it
  // dialed itself.
  const stopPulam = await pulam.start(fragment.ctx.collections.awareness);

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
    stopPulam();
    kaval.dispose();
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
