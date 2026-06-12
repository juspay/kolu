/**
 * The surviving pty-host daemon's process entry — its logic, import-safe.
 *
 * This is the body of the `kolu-pty-host` binary (`./daemon.ts` is the one
 * side-effecting line that runs `main`). It is the **one-rule** payload: this
 * file and everything it reaches run *inside the daemon process*, so they live
 * in `@kolu/pty-host` and are hashed into the staleKey — the package boundary
 * is the process boundary is the hash set. (B1 ships it inert: the in-process
 * server still owns the PTYs; B2 makes a fresh kolu-server spawn and consume
 * this daemon over the socket.)
 *
 * The whole thing is a plain sequence with no surprises:
 *   1. win the single-instance pid-gate keyed to the socket (atomic; a live
 *      holder ⇒ step aside, exit 0);
 *   2. serve `ptyHostSurface` over the unix socket — the *same* served router
 *      kolu-server already exposes for kolu-tui, now in its own process;
 *   3. emit one structured boot line (the H12 reattach-diagnostic seed);
 *   4. on SIGTERM/SIGINT, close the socket and release the gate.
 *
 * Constraints this file honours by construction: no import-time throw, no
 * top-level await, no import from `packages/server` (the daemon computes its
 * own paths). Its env is its own `process.env` — `servePtyHost`'s spawn handler
 * already prepares each shell's env there.
 */

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "kolu-shared";
import { currentPtyHostIdentity } from "./buildId.ts";
import {
  type InProcessPtyHostDeps,
  servePtyHostRouter,
} from "./inProcessPtyHost.ts";
import { acquirePidGate, pidGatePathForSocket } from "./pidGate.ts";
import { servePtyHostOverUnixSocket } from "./serveOverSocket.ts";
import { getPtyHostSocketPath } from "./socketPath.ts";
import { PTY_HOST_CONTRACT_VERSION } from "./ptyHostSurface.ts";

/** A running daemon. `close()` stops the socket and releases the gate — wired
 *  to SIGTERM/SIGINT by `main`, and called directly by the integration test. */
export interface PtyHostDaemonHandle {
  readonly socketPath: string;
  readonly pid: number;
  close(): void;
}

/** Why a start attempt produced no running daemon. `already-running` is a
 *  success (the one-daemon invariant holds — exit 0); `socket-unavailable` is a
 *  real failure to serve (e.g. the in-process server already owns the default
 *  socket — use `--pty-host-socket`). */
export type StartOutcome =
  | { started: true; handle: PtyHostDaemonHandle }
  | { started: false; reason: "already-running"; holderPid: number }
  | { started: false; reason: "socket-unavailable" };

export interface RunPtyHostDaemonOpts {
  /** Socket path override (the `--pty-host-socket` flag); default is the
   *  well-known rendezvous path. */
  socketPath?: string;
  /** Shell-rc directory override; default is the daemon's own stable root. */
  shellDir?: string;
  /** App version for the spawned shells' identity env; default `$KOLU_VERSION`. */
  version?: string;
  /** Gate pid override (tests only); default `process.pid`. */
  pid?: number;
  log?: Logger;
}

/** The daemon's own shell-rc directory — a **stable** name (not a per-process
 *  UUID like the server's `koluRoot`), because the daemon outlives the
 *  kolu-server processes that reattach to it. Computed in-package: the daemon
 *  never imports the server's runtime paths. */
function daemonShellDir(): string {
  const runtimeRoot = process.env.XDG_RUNTIME_DIR ?? tmpdir();
  return join(runtimeRoot, "kolu-pty-host", "shell");
}

/** A minimal structured stderr logger — the daemon serves the protocol over a
 *  *socket*, so stdout/stderr are free for diagnostics (journald captures them
 *  under systemd). Logging never throws into the daemon. */
function stderrLogger(): Logger {
  const emit = (
    level: string,
    obj: Record<string, unknown>,
    msg: string,
  ): void => {
    try {
      process.stderr.write(`${JSON.stringify({ level, ...obj, msg })}\n`);
    } catch {
      // best-effort: a dead stderr must not crash the daemon
    }
  };
  return {
    debug: (o, m) => emit("debug", o, m),
    info: (o, m) => emit("info", o, m),
    warn: (o, m) => emit("warn", o, m),
    error: (o, m) => emit("error", o, m),
  };
}

/**
 * Acquire the gate, serve the socket, and return a running handle — or a
 * `started: false` outcome the caller turns into an exit code. Pure of process
 * concerns (no signal handlers, no `process.exit`), so the integration test
 * drives it directly.
 */
export async function runPtyHostDaemon(
  opts: RunPtyHostDaemonOpts = {},
): Promise<StartOutcome> {
  const log = opts.log ?? stderrLogger();
  const socketPath = getPtyHostSocketPath(opts.socketPath);

  const gateResult = acquirePidGate(pidGatePathForSocket(socketPath), {
    pid: opts.pid,
  });
  if (!gateResult.acquired) {
    return {
      started: false,
      reason: "already-running",
      holderPid: gateResult.holderPid,
    };
  }
  const { gate } = gateResult;

  const shellDir = opts.shellDir ?? daemonShellDir();
  mkdirSync(shellDir, { recursive: true, mode: 0o700 });

  const deps: InProcessPtyHostDeps = {
    log,
    shellDir,
    version: opts.version ?? process.env.KOLU_VERSION ?? "",
  };
  const listener = await servePtyHostOverUnixSocket({
    socketPath,
    router: servePtyHostRouter(deps),
    log,
  });

  // We hold the gate but the socket refused to bind — a foreign owner has it
  // (the in-process server on the default path, or a stale socket we can't
  // clear). Don't pretend to serve: release the gate and report honestly.
  if (!listener.listening) {
    listener.close();
    gate.release();
    return { started: false, reason: "socket-unavailable" };
  }

  let closed = false;
  const handle: PtyHostDaemonHandle = {
    socketPath,
    pid: gate.pid,
    close() {
      if (closed) return;
      closed = true;
      listener.close();
      gate.release();
    },
  };

  log.info(
    {
      socketPath,
      pid: gate.pid,
      contractVersion: PTY_HOST_CONTRACT_VERSION,
      ...currentPtyHostIdentity(),
    },
    "pty-host daemon listening",
  );
  return { started: true, handle };
}

/** The single `--pty-host-socket[=PATH]` flag (both spellings), hand-parsed so
 *  the daemon's hashed closure stays free of a CLI-parser dependency. */
function parseSocketFlag(argv: string[]): string | undefined {
  const FLAG = "--pty-host-socket";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === FLAG) return argv[i + 1];
    if (a.startsWith(`${FLAG}=`)) return a.slice(FLAG.length + 1);
  }
  return undefined;
}

/** Process wiring around {@link runPtyHostDaemon}: parse the socket flag, map a
 *  no-start outcome to an exit code, and wire signal-driven shutdown. The
 *  listening socket keeps the event loop alive, so this returns while the daemon
 *  runs on. */
export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const log = stderrLogger();
  const outcome = await runPtyHostDaemon({
    socketPath: parseSocketFlag(argv),
    log,
  });

  if (!outcome.started) {
    if (outcome.reason === "already-running") {
      log.info(
        { holderPid: outcome.holderPid },
        "another pty-host daemon already holds the gate — nothing to do",
      );
      process.exit(0);
    }
    log.error(
      {},
      "pty-host daemon could not bind its socket (already served? pass --pty-host-socket a free path) — exiting",
    );
    process.exit(1);
  }

  const { handle } = outcome;
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      handle.close();
      process.exit(0);
    });
  }
}
