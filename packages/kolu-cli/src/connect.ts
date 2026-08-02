/**
 * kolu-cli's LOCAL padi dial — the connect layer the CLI faces (`kolu mcp`,
 * later `kolu tui`) share, owned by the composition root: resolve the running
 * padi's digest-keyed socket, dial it through the shared `@kolu/padi/dial` kit
 * (control-core handshake + the typed compatibility gate), and scope to the padi
 * sibling — the ONE padi client both faces ride. The remote `--host` dial lives
 * in `hostConnect.ts`; both return the same `KoluCliConnection` shape so a face
 * is transport-blind.
 *
 * Re-invoked per (re)dial by the MCP adapter, which is the restart
 * discipline's redial hook: `resolveRunningPadiSocket` runs FRESH each call.
 * padi's socket path is keyed by a digest of its STATE-ROOT (`padiDigest`),
 * not its build — a padi that respawns at the same state-root listens at the
 * SAME path across a restart/upgrade. So the fresh re-resolve is for
 * robustness (it re-discovers the running daemon and drops a dead
 * registration via the liveness gate, rather than pinning a cached path), and
 * `connectPadi`'s hello/compat gate is what proves the redialed generation
 * speaks our contract — never retry-same-path-blind.
 *
 * ## There is no retry mount any more, deliberately
 *
 * Under oRPC every streaming call carried a `STREAM_RETRY` plugin *context*, and
 * this module wrapped the client in a proxy to attach it to each subscription
 * verb. That seam is gone with the Effect port: a member verb hands back a LAZY
 * `Stream`, and the reconnect fence is a `Stream` combinator applied by whoever
 * CONSUMES the stream (`fenceStream` / `unenrolledStreamCall` — padi's own watch
 * kit applies it, as do the Solid bridge and surface-mcp's pusher), never a bag
 * threaded through the call.
 *
 * Re-mounting one HERE would also be a no-op wearing a policy's clothes: the
 * fence retries `RpcClientError` and nothing else, and both of this package's
 * transports are reconnect-free by construction — a unix-socket or stdio link
 * dies with its pipe and mints `SurfaceStdioTransportClosed`, which the fence
 * refuses on purpose (re-dialling the same dead fds is meaningless). So a dead
 * transport surfaces as the tool call's error and the MCP adapter re-invokes
 * this factory. That redial IS the restart discipline; a client-side retry proxy
 * never was.
 */

import {
  connectPadi,
  type PadiSurfaceClient,
  resolveRunningPadiSocket,
  scopePadiSurface,
} from "@kolu/padi/dial";

/** The transport-blind handle a CLI face is written against — the padi-scoped
 *  client plus a `dispose` that drops the socket/pipe. */
export interface KoluCliConnection {
  client: PadiSurfaceClient;
  dispose: () => void;
}

/**
 * Dial the LOCAL padi: resolve the running daemon's socket fresh (digest-keyed
 * — see the module header), dial + handshake through `connectPadi` (a contract
 * skew fails LOUD with `DaemonContractSkewError`), then scope to padi's sibling
 * face.
 *
 * Fail-fast on the resolution edges — the CLI faces dial a padi that ALREADY
 * runs, never provision one:
 *   - no daemon discovered → a named error naming the fix (start kolu / set
 *     `$PADI_SOCKET`), not a doomed dial against the default path;
 *   - more than one → a named error listing each candidate socket.
 */
export async function connectKoluCliLocal(): Promise<KoluCliConnection> {
  const resolved = resolveRunningPadiSocket();
  if (resolved.kind === "many") {
    const lines = resolved.candidates
      .map((c) => `  PADI_SOCKET=${c.socket}`)
      .join("\n");
    throw new Error(
      `more than one padi daemon is running on this host — set $PADI_SOCKET to pick one:\n${lines}`,
    );
  }
  if (resolved.kind === "none") {
    throw new Error(
      "no running padi daemon found on this host — start kolu (its padi serves the terminals), or set $PADI_SOCKET to an explicit socket.",
    );
  }
  const conn = await connectPadi(resolved.socket);
  return {
    client: scopePadiSurface(conn.client),
    dispose: conn.dispose,
  };
}
