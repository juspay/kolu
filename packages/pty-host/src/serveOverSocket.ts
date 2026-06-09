/**
 * Serve a top-level pty-host router over a unix-domain socket — the socket
 * link the in-process header promises ("Reused over a socket by the
 * surviving daemon"). kolu-server uses it for R-4 Phase 1 (so `kolu-tui`
 * can reach the live PTYs); Phase B's standalone daemon reuses it unchanged.
 *
 * The transport lifecycle (probe, stale-inode clearing, dir-privacy gate,
 * listen, per-connection serving) is `serveOverUnixSocket` in
 * `@kolu/surface/unix-socket` — generic and never-crashing: every failure
 * mode resolves to a no-op listener with a machine-readable `outcome`. This
 * module is the kolu voice on top: it maps each outcome to an operator-facing
 * log line with the kolu-specific advice (what the socket is for, which flag
 * to reach for). The caller passes the contract-wrapped router
 * (`createInProcessPtyHost`'s `servedRouter`); the router is shared across
 * connections (and with the in-process `directLink` client).
 */
import {
  serveOverUnixSocket,
  type UnixSocketServeOutcome,
} from "@kolu/surface/unix-socket";
import type { Router } from "@orpc/server";
import type { Logger } from "kolu-shared";

export interface PtyHostSocketListener {
  /** The path the socket is bound to (or that a live peer already owns). */
  readonly socketPath: string;
  /** Stop accepting connections and remove the socket file. Idempotent and
   *  safe to call synchronously from a `process.on("exit")` handler. */
  close(): void;
}

/** The kolu-flavored warning for each way `serveOverUnixSocket` can refuse
 *  to bind. The socket serves the FULL `ptyHostSurface`
 *  (write/kill/spawn/getScreenText), so the privacy refusals are security
 *  refusals; the rest are single-server-model collisions where
 *  `--pty-host-socket` is the way out. */
function refusalWarning(outcome: UnixSocketServeOutcome): string {
  switch (outcome.kind) {
    case "dir-not-private":
      return "pty-host socket dir is not a private owner-only directory; refusing to serve the pty-host there (it grants full PTY control). Use --pty-host-socket to point at a directory you own with 0700 perms.";
    case "already-served":
      return "pty-host socket already served by another kolu instance; not taking it over (kolu-tui reaches that one). Use --pty-host-socket to run a second instance.";
    case "probe-failed":
      return "pty-host socket path could not be probed (an unexpected connect error, not 'stale'); refusing to remove it. Use --pty-host-socket to point at a free path.";
    case "not-a-socket":
      return "pty-host socket path exists and is not a socket (a regular file, dir, or symlink); refusing to remove it. Use --pty-host-socket to point at a free path.";
    case "bind-failed":
      return "pty-host socket unavailable this run (could not bind); kolu-server otherwise unaffected";
    case "listening":
      throw new Error("unreachable: listening is not a refusal");
  }
}

/** Start serving `router` over a unix socket at `socketPath`. Returns a
 *  listener whose `close()` stops it and removes the socket file.
 *
 *  The socket is an *additive* convenience — it's how `kolu-tui` reaches the
 *  pty-host — and kolu-server's web path is entirely independent of it, so a
 *  failure to bind it must NEVER crash the server. Every failure mode
 *  resolves to a no-op listener with a warning, not a rejection. */
export async function servePtyHostOverUnixSocket(opts: {
  socketPath: string;
  // biome-ignore lint/suspicious/noExplicitAny: a top-level oRPC router, mirroring serveOverStdio's own `Router<any, Context>` param.
  router: Router<any, any>;
  log?: Logger;
}): Promise<PtyHostSocketListener> {
  const { socketPath, router, log } = opts;
  const listener = await serveOverUnixSocket({ socketPath, router, log });
  const { outcome } = listener;

  if (outcome.kind !== "listening") {
    const ctx: Record<string, unknown> = { socketPath };
    if (outcome.kind === "dir-not-private") ctx.dir = outcome.dir;
    if (outcome.kind === "probe-failed") ctx.code = outcome.code;
    if (outcome.kind === "bind-failed") ctx.err = outcome.err;
    log?.warn(ctx, refusalWarning(outcome));
    return listener;
  }

  log?.info({ socketPath }, "pty-host socket listening (kolu-tui)");
  let closed = false;
  return {
    socketPath,
    close() {
      if (closed) return;
      closed = true;
      log?.info({ socketPath }, "pty-host socket closed");
      listener.close();
    },
  };
}
