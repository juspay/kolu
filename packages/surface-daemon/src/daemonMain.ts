/**
 * The daemon skeleton every surface daemon repeats: **gate → serve → teardown**.
 *
 * `daemonMain` is the mechanism; the *policy* arrives as parameters — the scope
 * key (`gatePath`), where to listen (`socketPath`), what to serve (`router`,
 * any `@kolu/surface` router), and how long to live (`lifetime`). kaval picks
 * `{ kind: "forever" }` — an idle PTY daemon still holds your terminals;
 * `odu serve` will pick `idleTimeout` — a quiet CI coordinator may exit. Same
 * skeleton, opposite policies, which is the evidence the mechanism is real and
 * not one program's internals wearing a package name.
 *
 * It never calls `process.exit`: it returns a `DaemonExit` the bin maps to a
 * code. That keeps the whole lifecycle drivable in-process from a test — the
 * gate-race choreography and the idle-timeout path run under vitest with no
 * real signals and no forked children.
 */

import {
  serveOverUnixSocket,
  type UnixSocketServeOutcome,
} from "@kolu/surface/unix-socket";
import type { Router } from "@orpc/server";
import type { Logger } from "./logger.ts";
import { acquirePidGate } from "./pidGate.ts";

/** How long the daemon stays up once serving. `forever` waits for a signal or
 *  an external abort only; `idleTimeout` additionally shuts down after `ms` of
 *  continuous idleness (the daemon defines "idle" via `isIdle`). */
export type DaemonLifetime =
  | { kind: "forever" }
  | { kind: "idleTimeout"; ms: number; isIdle: () => boolean };

/** Why `daemonMain` returned, for the bin to turn into an exit code.
 *  `already-running` is a *success* (another live daemon serves this scope —
 *  exit 0); `serve-failed` is the one real error. */
export type DaemonExit =
  | { kind: "already-running"; pid: number }
  | { kind: "shutdown"; reason: "signal" | "abort" | "idle" }
  | { kind: "serve-failed"; detail: UnixSocketServeOutcome["kind"] };

export interface DaemonSpec {
  /** The single-instance gate path — the scope key (per-user for kaval, per-repo
   *  for `odu serve`). */
  gatePath: string;
  /** Where to bind the unix socket clients dial. */
  socketPath: string;
  /** The surface router to serve. Shared across every connection.  */
  // biome-ignore lint/suspicious/noExplicitAny: a top-level oRPC router, mirroring serveOverUnixSocket's own `Router<any, any>` param.
  router: Router<any, any>;
  /** Lifetime policy — the one knob that differs across daemons. */
  lifetime: DaemonLifetime;
  log: Logger;
  /** An external stop signal (tests; a parent that wants to tear the daemon
   *  down without a real OS signal). Aborting it ends the daemon via
   *  `reason: "abort"`. */
  signal?: AbortSignal;
  /** Fired once, after the gate is held and the socket is listening — the boot
   *  log's hook and the readiness point a test awaits before connecting. */
  onReady?: (info: { socketPath: string; pid: number }) => void;
}

/** Run the daemon: take the gate, serve the router over the socket, then wait
 *  for the configured lifetime to end. Resolves with a `DaemonExit`; cleans up
 *  the socket and releases the gate on every non-`already-running` path. */
export async function daemonMain(spec: DaemonSpec): Promise<DaemonExit> {
  const { gatePath, socketPath, router, lifetime, log, signal } = spec;

  const gate = acquirePidGate(gatePath);
  if (gate.kind === "held") {
    log.info(
      { gatePath, pid: gate.pid },
      "daemon already running; yielding to the live instance",
    );
    return { kind: "already-running", pid: gate.pid };
  }

  const listener = await serveOverUnixSocket({ socketPath, router, log });
  if (listener.outcome.kind !== "listening") {
    // A daemon whose socket won't bind has no reason to exist — release the
    // gate so a retry isn't blocked, and report the refusal verbatim.
    gate.release();
    log.error(
      { socketPath, outcome: listener.outcome.kind },
      "daemon could not bind its socket; exiting",
    );
    return { kind: "serve-failed", detail: listener.outcome.kind };
  }

  log.info({ socketPath, gatePath, pid: process.pid }, "daemon listening");
  spec.onReady?.({ socketPath, pid: process.pid });

  const reason = await waitForShutdown(lifetime, signal);

  log.info({ reason }, "daemon shutting down");
  listener.close();
  gate.release();
  return { kind: "shutdown", reason };
}

/** Resolve when the daemon should stop: an OS signal (SIGTERM/SIGINT), the
 *  external abort, or — under `idleTimeout` — `ms` of continuous idleness. All
 *  handlers are removed before resolving, so a returning daemon leaves no
 *  listeners behind (a test runs many daemons in one process). */
function waitForShutdown(
  lifetime: DaemonLifetime,
  external?: AbortSignal,
): Promise<"signal" | "abort" | "idle"> {
  return new Promise((resolve) => {
    let settled = false;
    const cleanups: Array<() => void> = [];
    const finish = (reason: "signal" | "abort" | "idle"): void => {
      if (settled) return;
      settled = true;
      for (const c of cleanups) c();
      resolve(reason);
    };

    for (const sig of ["SIGTERM", "SIGINT"] as const) {
      const handler = (): void => finish("signal");
      process.on(sig, handler);
      cleanups.push(() => {
        process.off(sig, handler);
      });
    }

    if (external) {
      if (external.aborted) {
        finish("abort");
        return;
      }
      const handler = (): void => finish("abort");
      external.addEventListener("abort", handler, { once: true });
      cleanups.push(() => external.removeEventListener("abort", handler));
    }

    if (lifetime.kind === "idleTimeout") {
      // Poll idleness; shut down once it has held continuously for `ms`. Any
      // activity resets the clock. The tick is frequent relative to `ms` but
      // capped so a long timeout doesn't busy-poll.
      let idleSince: number | undefined;
      const period = Math.max(20, Math.min(lifetime.ms, 1000));
      const timer = setInterval(() => {
        if (lifetime.isIdle()) {
          idleSince ??= Date.now();
          if (Date.now() - idleSince >= lifetime.ms) finish("idle");
        } else {
          idleSince = undefined;
        }
      }, period);
      // Don't let the poll timer keep the event loop alive on its own.
      timer.unref?.();
      cleanups.push(() => clearInterval(timer));
    }
  });
}
