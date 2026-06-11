/**
 * The server's link to the pty-host daemon (R-4 Phase B).
 *
 * The PTYs no longer live in-process: they belong to a SURVIVING daemon process.
 * This module connects to it over the unix socket at boot — reattaching to a
 * daemon a previous server left running, or spawning a fresh one — and exposes
 * the reconnecting client `LocalTerminalBackend` consumes. So a server restart
 * (a deploy) reconnects to the same PTYs: local terminals survive. `kolu-tui`
 * connects to the same socket; the daemon serves them both.
 *
 * Top-level await: the client must be live before any consumer touches it, and
 * `local.ts` reads it at module load (`ptyHostIdentity`). ESM makes importers
 * wait for this resolution, so `ptyHostClient` is always connected by the time
 * the backend uses it.
 */
import { getPtyHostPidPath, getPtyHostSocketPath } from "@kolu/pty-host";
import { ensureDaemon } from "./daemon/daemonHandle.ts";
import { spawnDaemonProcess } from "./daemon/spawn.ts";
import { log } from "./log.ts";

const socketOverride = process.env.KOLU_PTY_HOST_SOCKET;
const socketPath = getPtyHostSocketPath(socketOverride);
const pidPath = getPtyHostPidPath(socketOverride);

/** The handle on the surviving daemon — its reconnecting client, honest
 *  liveness, and the daemon-process restart. One per server (single daemon). */
export const daemonHandle = await ensureDaemon({
  socketPath,
  pidPath,
  log,
  spawnDaemon: () => spawnDaemonProcess({ socketPath, log }),
});

/** The reconnecting pty-host client the LocalTerminalBackend consumes — stable
 *  across a daemon restart. */
export const ptyHostClient = daemonHandle.client;
