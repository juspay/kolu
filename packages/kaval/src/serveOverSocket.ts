/**
 * Serve a top-level pty-host router over a unix-domain socket — the socket
 * link the in-process header promises ("Reused over a socket by the
 * surviving daemon"). kolu-server uses it for R-4 Phase 1 (so `kaval-tui`
 * can reach the live PTYs); Phase B's standalone daemon reuses it unchanged.
 *
 * The transport lifecycle (probe, stale-inode clearing, dir-privacy gate,
 * listen, per-connection serving) is `serveOverUnixSocket` in
 * `@kolu/surface/unix-socket` — generic and never-crashing: every failure
 * mode resolves to a no-op listener with a machine-readable `outcome`. This
 * module is the kolu voice on top: it maps each outcome to an operator-facing
 * log line with the kolu-specific advice (what the socket is for, which flag
 * to reach for). The caller passes the served wire
 * (`createInProcessPtyHost`'s `served` — `{ group, handlers }`); the handlers
 * are shared across connections (and with the in-process `directDispatch`
 * client).
 *
 * `serveOverUnixSocket` lost its `log` option in the Effect port (S4 deleted
 * `UnixSocketLogger`) — the runtime chatter it carried now lives inside Effect's
 * own socket handling. Only the BIND-TIME verdicts reach us, which is all this
 * module ever narrated anyway; nothing here changed voice.
 */
import {
  serveOverUnixSocket,
  type UnixSocketListener,
  type UnixSocketServeOutcome,
} from "@kolu/surface/unix-socket";
import type { Logger } from "@kolu/surface-daemon";
import type { PtyHostServed } from "./inProcessPtyHost.ts";

/** The receptacle's listener, narrowed to what pty-host callers get: the
 *  path and `close()` (with the receptacle's own teardown contract), minus
 *  `outcome` — refusal interpretation stays owned by the kolu voice here. */
export type PtyHostSocketListener = Pick<
  UnixSocketListener,
  "socketPath" | "close"
>;

/** The kolu-flavored warning for each way `serveOverUnixSocket` can refuse
 *  to bind. The socket serves the FULL `ptyHostSurface`
 *  (write/kill/spawn/getScreenText), so the privacy refusals are security
 *  refusals; the rest are single-server-model collisions where
 *  `--pty-host-socket` is the way out. */
function describeRefusal(
  outcome: Exclude<UnixSocketServeOutcome, { kind: "listening" }>,
): { msg: string; ctx: Record<string, unknown> } {
  switch (outcome.kind) {
    case "dir-not-private":
      return {
        msg: "pty-host socket dir is not a private owner-only directory; refusing to serve the pty-host there (it grants full PTY control). Use --pty-host-socket to point at a directory you own with 0700 perms.",
        ctx: { dir: outcome.dir },
      };
    case "already-served":
      return {
        msg: "pty-host socket already served by another kolu instance; not taking it over (kaval-tui reaches that one). Use --pty-host-socket to run a second instance.",
        ctx: {},
      };
    case "probe-failed":
      return {
        msg: "pty-host socket path could not be probed (an unexpected connect error, not 'stale'); refusing to remove it. Use --pty-host-socket to point at a free path.",
        ctx: { code: outcome.code },
      };
    case "not-a-socket":
      return {
        msg: "pty-host socket path exists and is not a socket (a regular file, dir, or symlink); refusing to remove it. Use --pty-host-socket to point at a free path.",
        ctx: {},
      };
    case "bind-failed":
      return {
        msg: "pty-host socket unavailable this run (could not bind); kolu-server otherwise unaffected",
        ctx: { err: outcome.err },
      };
  }
}

/** Start serving `served` over a unix socket at `socketPath`. Returns a
 *  listener whose `close()` stops it — accepting AND every established peer
 *  (attached kaval-tui sessions are severed; their serves settle through the
 *  normal peer-death chain) — and removes the socket file.
 *
 *  The socket is an *additive* convenience — it's how `kaval-tui` reaches the
 *  pty-host — and kolu-server's web path is entirely independent of it, so a
 *  failure to bind it must NEVER crash the server. Every failure mode
 *  resolves to a no-op listener with a warning, not a rejection. */
export async function servePtyHostOverUnixSocket(opts: {
  socketPath: string;
  /** The served pty-host wire — `createInProcessPtyHost(...).served`. */
  served: PtyHostServed;
  log?: Logger;
}): Promise<PtyHostSocketListener> {
  const { socketPath, served, log } = opts;
  const listener = await serveOverUnixSocket({
    socketPath,
    group: served.group,
    handlers: served.handlers,
  });
  const { outcome } = listener;

  if (outcome.kind !== "listening") {
    const { msg, ctx } = describeRefusal(outcome);
    log?.warn({ socketPath, ...ctx }, msg);
    return listener;
  }

  log?.info({ socketPath }, "pty-host socket listening (kaval-tui)");
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
