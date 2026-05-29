/**
 * Daemon supervisor — owns the kolu-server side of the local PTY-host
 * daemon's lifecycle (`kolu --stdio`, #951 R4c).
 *
 * Responsibilities:
 *  1. Try to connect to an existing `$KOLU_STATE_DIR/pty-host.sock`. If one
 *     responds, reuse it (the common path on every kolu-server restart after
 *     the first — the daemon and its PTYs survived).
 *  2. If no daemon is alive, spawn the kolu binary with `--stdio` so the
 *     daemon outlives this kolu-server. **On a systemd service** (detected
 *     via `INVOCATION_ID`) the spawn goes through `systemd-run --user
 *     --unit=kolu-pty-host`, which lands the daemon in its *own* transient
 *     cgroup — so `systemctl --user restart kolu` (a deploy) does NOT kill
 *     it. A plain `detached` spawn does NOT survive that on cgroup-v2
 *     (`KillMode=control-group` walks cgroup membership, not the session) —
 *     the #1031 prod failure. Off systemd (dev / test / macOS launchd, which
 *     already survives) the spawn is a plain detached child.
 *  3. Poll for the socket until the daemon finishes binding it; then connect.
 *  4. Issue `system.version` to verify contract compatibility. An
 *     *incompatible* wire shape (a breaking pty-host change, or the dropped
 *     #1031 daemon's `"1.0"` agent surface) is a **forced restart**: kill the
 *     stale daemon, respawn fresh, re-verify once. This is the rare accepted
 *     PTY-loss moment — and the one-time migration cutover off #1031.
 *  5. Expose the typed client + an `outdated` flag (wire-compatible but a
 *     different *build* — surviving a deploy with stale code). Surfaced via
 *     the boot log today; the user-facing "update pending" nudge + restart
 *     command are a follow-up (R4d-UI).
 *
 * Reconnect — scope (#951 R4c): `ensureDaemon` is reconnect-aware on the
 * **boot path** — when called (boot reattach), it drops a `closed` cached
 * handle and re-runs connect-or-spawn, reusing a surviving daemon. There is
 * deliberately NO mid-session auto-recovery: after boot nothing re-invokes
 * `ensureDaemon`, so if the daemon *dies* while kolu-server runs, the socket
 * closes and `getDaemonHandle()` then throws (loud failure, not a silent dead
 * client). That is correct for R4c — a dead daemon has lost its PTYs, so there
 * is nothing to recover, only to surface; graceful mid-session resurrection +
 * reconnect is R-3 resilience work. The single-instance gate + exec-arg filter
 * live in `./daemonUtils.ts` (a different volatility axis), shared with the
 * daemon entrypoint.
 */

import { spawn as spawnChild } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { createStdioCellsClient } from "@kolu/surface/links/stdio";
import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import type { ContractRouterClient } from "@orpc/contract";
import {
  isPtyHostContractCompatible,
  PTY_HOST_CONTRACT_VERSION,
  type PtyHostSystemVersion,
  type ptyHostSurface,
} from "./ptyHostSurface.ts";
import { currentBuildId } from "./buildId.ts";
import { daemonExecArgv } from "./daemonUtils.ts";
import { daemonPaths } from "../koluState.ts";
import { log } from "../log.ts";

/** The typed client for the daemon's `ptyHostSurface` contract, with the
 *  `ClientRetryPlugin` context threaded through (the same shape
 *  `createStdioCellsClient` returns). Procedures and streams are nested under
 *  `surface.` — `defineSurface` puts every contract entry inside the surface
 *  namespace (e.g. `client.surface.system.version`). */
export type PtyHostClient = ContractRouterClient<
  typeof ptyHostSurface.contract,
  ClientRetryPluginContext
>;

export interface DaemonHandle {
  client: PtyHostClient;
  socketPath: string;
  /** Daemon-reported PID. Used to SIGTERM the daemon on restart. */
  daemonPid: number;
  /** Daemon-reported contract version (e.g. "2.0"). */
  contractVersion: string;
  /** Wire-compatible but a different *build* than this kolu-server — the
   *  daemon survived a deploy and is serving stale code. Surfaced as the
   *  "update pending" nudge; the PTYs are untouched until the user restarts. */
  outdated: boolean;
  /** Connection state. `live` until the underlying socket closes. */
  state(): "live" | "closed";
  /** Close the supervisor's socket (does NOT kill the daemon). */
  dispose(): void;
}

/** Thrown when a connected daemon's wire contract is incompatible — the
 *  caller force-restarts on it (kill + respawn) rather than crash. */
class IncompatibleDaemonError extends Error {}

/** Attempt a single connect with a short timeout. Returns the socket on
 *  success, undefined on `ENOENT`/`ECONNREFUSED` (no daemon yet). */
async function tryConnect(
  socketPath: string,
  timeoutMs: number,
): Promise<Socket | undefined> {
  return new Promise((resolve) => {
    const sock = createConnection(socketPath);
    const cleanup = (s: Socket | undefined): void => {
      sock.removeListener("connect", onConnect);
      sock.removeListener("error", onError);
      clearTimeout(timer);
      resolve(s);
    };
    const onConnect = (): void => cleanup(sock);
    const onError = (err: NodeJS.ErrnoException): void => {
      if (err.code !== "ENOENT" && err.code !== "ECONNREFUSED") {
        log.warn({ err: err.message, socketPath }, "supervisor: connect error");
      }
      sock.destroy();
      cleanup(undefined);
    };
    sock.once("connect", onConnect);
    sock.once("error", onError);
    const timer = setTimeout(() => {
      sock.destroy();
      cleanup(undefined);
    }, timeoutMs);
  });
}

/** Valid POSIX env-var name — systemd-run rejects names with `=` / `%` / `.`
 *  (e.g. bash's exported-function `BASH_FUNC_x%%` entries), so we forward
 *  only well-formed names via `--setenv`. */
const VALID_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The kolu `--stdio` command: the runtime, the dev-flag-filtered exec args,
 *  the entry script, and `--stdio`. `process.execPath` is the node/tsx
 *  runtime; `argv[1]` is the entry script (kolu's `index.ts` under tsx, or
 *  the nix-stamped store path) — load-bearing, or the runtime has nothing to
 *  run, and the store path is also what `buildId` keys on. */
function daemonCommand(): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: [
      ...daemonExecArgv(process.execArgv),
      ...(process.argv[1] ? [process.argv[1]] : []),
      "--stdio",
    ],
  };
}

/** Spawn the daemon in its OWN transient systemd cgroup so it survives a
 *  `systemctl --user restart kolu` (deploy). Returns true if the spawn was
 *  dispatched, false if `systemd-run` isn't usable (caller falls back to a
 *  detached spawn). The daemon's stdout/stderr go to the journal
 *  (`journalctl --user -u kolu-pty-host`). */
function spawnDaemonViaSystemd(): boolean {
  const { command, args } = daemonCommand();
  // Forward kolu-server's env (KOLU_STATE_DIR / KOLU_GH_BIN / PATH / HOME /
  // git identity / nix whitelist …) — `systemd-run --user` inherits the
  // *manager's* env, not ours, so each var must be passed explicitly.
  const setenv: string[] = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && VALID_ENV_NAME.test(k))
      setenv.push(`--setenv=${k}=${v}`);
  }
  const runArgs = [
    "--user",
    "--quiet",
    "--collect", // GC the transient unit when it exits, freeing the name
    "--unit=kolu-pty-host",
    ...setenv,
    "--",
    command,
    ...args,
  ];
  try {
    // A surviving daemon may still own the unit name in a failed/inactive
    // state — clear it first so `--unit` can be reused (best-effort).
    spawnChild("systemctl", ["--user", "reset-failed", "kolu-pty-host"], {
      stdio: "ignore",
    }).on("error", () => {});
    const child = spawnChild("systemd-run", runArgs, {
      stdio: "ignore",
      env: process.env,
    });
    // The `error` event fires asynchronously (after this function returns), so
    // it can't affect the return value. Log it for diagnosis; the 5-second
    // socket-polling loop in `connectAndVerify` is the real liveness guard —
    // if systemd-run silently failed, the daemon never binds the socket and
    // the poll times out with a clear error message.
    child.on("error", (err) => {
      log.warn({ err: err.message }, "supervisor: systemd-run process error");
    });
    log.info(
      { command, args, unit: "kolu-pty-host" },
      "supervisor: spawning daemon via systemd-run (own cgroup)",
    );
    return true;
  } catch (err) {
    log.warn(
      { err: (err as Error).message },
      "supervisor: systemd-run unavailable — falling back to detached",
    );
    return false;
  }
}

/** Spawn the daemon as a plain detached child. Used off systemd (dev / test
 *  / macOS launchd, which already survives a server restart). stdout/stderr
 *  are redirected into `pty-host.log`; stdin is ignored (the daemon serves
 *  over its unix socket, not stdio). */
function spawnDaemonDetached(logFile: string): void {
  const { command, args } = daemonCommand();
  const fd = openSync(logFile, "a", 0o600);
  log.info(
    { command, args, logFile },
    "supervisor: spawning daemon (detached)",
  );
  const child = spawnChild(command, args, {
    detached: true,
    stdio: ["ignore", fd, fd],
    env: process.env,
  });
  closeSync(fd); // parent doesn't write to it; close now to avoid fd leak
  child.unref();
  child.on("error", (err) => {
    log.error({ err: err.message }, "supervisor: daemon spawn error");
  });
}

/** Dispatch the daemon spawn by deploy context. On a systemd service
 *  (`INVOCATION_ID` set) prefer the cgroup-escaping `systemd-run` path,
 *  falling back to detached if systemd-run isn't usable. */
function spawnDaemon(logFile: string): void {
  if (process.env.INVOCATION_ID && spawnDaemonViaSystemd()) return;
  spawnDaemonDetached(logFile);
}

let cached: DaemonHandle | undefined;
/** In-flight connect, so concurrent `ensureDaemon` callers share one spawn
 *  rather than racing two daemons into the pid-file gate. */
let connecting: Promise<DaemonHandle> | undefined;

/** Snapshot accessor for downstream consumers (`LocalTerminalBackend`'s
 *  write/resize/attach proxies). Throws if `ensureDaemon` has not resolved yet
 *  — callers must `await ensureDaemon()` once at boot before reaching for the
 *  handle — AND if the handle's socket has since closed (the daemon died): a
 *  `closed` handle's RPCs would silently no-op or hang, so we surface it as a
 *  loud error instead of handing back a dead client. The `state()` method
 *  exists precisely to make this distinction; an empty `""` screen or a
 *  dropped keystroke must never masquerade as success. */
export function getDaemonHandle(): DaemonHandle {
  if (!cached) {
    throw new Error("getDaemonHandle: ensureDaemon() not called");
  }
  if (cached.state() === "closed") {
    throw new Error(
      "getDaemonHandle: PTY-host daemon socket is closed — the daemon died; " +
        "its terminals are gone. Mid-session auto-recovery is R-3 resilience work.",
    );
  }
  return cached;
}

/** Connect to (or spawn-and-connect-to) the local PTY-host daemon.
 *  Reconnect-aware: a live cached handle is reused, but a `closed` one is
 *  dropped and re-established — a stdio socket can't self-heal, so the only
 *  recovery is a fresh connect-or-spawn. */
export async function ensureDaemon(): Promise<DaemonHandle> {
  if (cached && cached.state() === "live") return cached;
  if (connecting !== undefined) return connecting;
  if (cached) {
    cached.dispose();
    cached = undefined;
  }
  connecting = ensureDaemonImpl().then(
    (handle) => {
      cached = handle;
      connecting = undefined;
      return handle;
    },
    (err) => {
      connecting = undefined;
      throw err;
    },
  );
  return connecting;
}

/** Poll until the daemon's socket file disappears (the daemon unlinks it in
 *  its SIGTERM cleanup, alongside the pid file). A fresh daemon can only
 *  acquire the pid file once the old one releases it, so this is the barrier
 *  before respawning. Resolves early once gone; resolves anyway at deadline. */
async function waitForSocketGone(
  socketPath: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!existsSync(socketPath)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Cheap probe: is a daemon already listening on the socket? No spawn, no
 *  handshake, no caching. Lets boot reattach skip the daemon's (tsx)
 *  cold-start when there's nothing to reattach (a fresh boot) — the daemon
 *  then spawns lazily on the first terminal create instead of gating the HTTP
 *  port. */
export async function daemonIsRunning(): Promise<boolean> {
  const { socketPath } = daemonPaths();
  const sock = await tryConnect(socketPath, 200);
  if (!sock) return false;
  sock.destroy();
  return true;
}

/** SIGTERM whatever daemon currently owns the socket (best-effort) and wait
 *  for the socket to clear. Used by the forced-restart path in
 *  `ensureDaemonImpl`. */
async function killRunningDaemon(
  daemonPid: number,
  socketPath: string,
): Promise<void> {
  try {
    process.kill(daemonPid, "SIGTERM");
  } catch (err) {
    // ESRCH (already gone) is fine — we respawn regardless.
    log.warn(
      { err: (err as Error).message, pid: daemonPid },
      "supervisor: SIGTERM to daemon failed (already gone?)",
    );
  }
  await waitForSocketGone(socketPath, 5_000);
}

/** Connect, run the version handshake, and build the handle. Throws
 *  `IncompatibleDaemonError` on an incompatible/garbled daemon so the caller
 *  can force-restart. Spawns a fresh daemon if none is listening. */
async function connectAndVerify(): Promise<DaemonHandle> {
  const { socketPath, logFile } = daemonPaths();

  // Reuse an already-running daemon (the common path on every restart after
  // the first), else spawn one and poll until it binds the socket.
  let socket = await tryConnect(socketPath, 200);
  if (!socket) {
    spawnDaemon(logFile);
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      socket = await tryConnect(socketPath, 200);
      if (socket) break;
    }
  }
  if (!socket) {
    throw new Error(
      `Daemon failed to start: socket ${socketPath} did not appear within 5s. ` +
        `See ${logFile} (or 'journalctl --user -u kolu-pty-host') for its log.`,
    );
  }

  const client = createStdioCellsClient<typeof ptyHostSurface.contract>({
    read: socket,
    write: socket,
  });

  // Version handshake. A garbled response (an old #1031 daemon serving a
  // different output shape → output-validation throw) or an incompatible
  // contract are both treated as IncompatibleDaemonError so the caller
  // force-restarts onto a matching daemon.
  let versionInfo: PtyHostSystemVersion;
  try {
    versionInfo = await client.surface.system.version({});
  } catch (err) {
    socket.destroy();
    throw new IncompatibleDaemonError(
      `Local PTY daemon at ${socketPath} did not answer system.version with a ` +
        `recognized shape (${(err as Error).message}) — treating as stale.`,
    );
  }
  if (
    !isPtyHostContractCompatible(
      versionInfo.contractVersion,
      PTY_HOST_CONTRACT_VERSION,
    )
  ) {
    socket.destroy();
    throw new IncompatibleDaemonError(
      `Local PTY daemon contract ${versionInfo.contractVersion} is incompatible ` +
        `with this kolu-server (expects ${PTY_HOST_CONTRACT_VERSION}); pid ` +
        `${versionInfo.pid} on ${socketPath}.`,
    );
  }

  const outdated = versionInfo.buildId !== currentBuildId();
  log.info(
    {
      daemonPid: versionInfo.pid,
      contractVersion: versionInfo.contractVersion,
      daemonBuildId: versionInfo.buildId,
      serverBuildId: currentBuildId(),
      outdated,
      socketPath,
    },
    outdated
      ? "supervisor: daemon connected but running stale code — restart to apply update"
      : "supervisor: daemon connected",
  );

  let state: "live" | "closed" = "live";
  socket.on("close", () => {
    state = "closed";
    log.warn({ socketPath }, "supervisor: daemon socket closed");
  });
  socket.on("error", (err) => {
    log.warn({ err: err.message }, "supervisor: socket error");
  });

  return {
    client,
    socketPath,
    daemonPid: versionInfo.pid,
    contractVersion: versionInfo.contractVersion,
    outdated,
    state: () => state,
    dispose: () => socket?.destroy(),
  };
}

/** Read the daemon's own pid from its pid file (`tryAcquirePidFile` wrote it).
 *  Returns undefined if absent / unreadable. */
function readDaemonPid(pidFile: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

async function ensureDaemonImpl(): Promise<DaemonHandle> {
  try {
    return await connectAndVerify();
  } catch (err) {
    if (!(err instanceof IncompatibleDaemonError)) throw err;
    // Forced restart: an incompatible daemon survived a breaking change (or
    // it's the #1031 cutover). Kill it (pid from its pid file), wait for the
    // socket to clear, then spawn + verify a fresh one once.
    log.warn(
      { err: err.message },
      "supervisor: incompatible daemon — forcing a restart (terminals will be lost)",
    );
    const { socketPath, pidFile } = daemonPaths();
    const pid = readDaemonPid(pidFile);
    if (pid !== undefined) {
      await killRunningDaemon(pid, socketPath);
    } else {
      await waitForSocketGone(socketPath, 1_000);
    }
    return await connectAndVerify();
  }
}
