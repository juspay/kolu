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
import { isContractSkewError } from "@kolu/surface-daemon-supervisor";
import { Data, Effect } from "effect";

/** The transport-blind handle a CLI face is written against — the padi-scoped
 *  client plus a `dispose` that drops the socket/pipe.
 *
 *  Deliberately NOT an `Effect.acquireRelease`d resource, and the reason is the
 *  consumer: the MCP adapter (`kolu-mcp`) OWNS a dialed connection's lifetime —
 *  it holds one across many tool calls and disposes it on its own redial /
 *  shutdown path. A scope here would end the link at the wrong moment (the dial
 *  effect's own scope), so the handle keeps carrying its `dispose` and the dial
 *  hands the resource OUT. Where kolu-cli owns a link itself — it does not
 *  today — the scoped form is the one to reach for. */
export interface KoluCliConnection {
  client: PadiSurfaceClient;
  dispose: () => void;
}

/** The running padi could not be NAMED: none discovered, or several with no
 *  `$PADI_SOCKET` to pick one. A usage fact about this host, never a transient
 *  — a retry cannot change it, so it is its own tag. */
export class PadiNotAddressable extends Data.TaggedError(
  "PadiNotAddressable",
)<{ readonly message: string }> {}

/** The padi we named speaks a `padiSurface` this build cannot talk to.
 *
 *  This is the ONE place the supervisor's BRAND check runs (see
 *  `isContractSkewError`: a brand, never `instanceof`, because a CLI face and
 *  the dial kit that raised the error can sit on different module instances of
 *  `@kolu/surface-daemon-supervisor`). Classifying AT THE RAISE SITE is what
 *  makes the misrouting hazard unspellable downstream: every consumer past this
 *  point matches on `_tag`, and a `_tag` compare is realm-safe by construction,
 *  so no second module instance can turn a permanent skew into a retryable
 *  transport gap. */
export class PadiContractSkew extends Data.TaggedError("PadiContractSkew")<{
  readonly message: string;
}> {}

/** Anything else the dial can fail with — padi down, restarting, the socket
 *  moved, an ssh leg that never came up. Transient by assumption, so the MCP
 *  face surfaces it as a RETRYABLE tool-call error. */
export class PadiDialFailed extends Data.TaggedError("PadiDialFailed")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

/** Every way a kolu-cli dial can fail, as one union — the alphabet
 *  `guardedMcpDial` exhausts. */
export type KoluCliDialError =
  | PadiNotAddressable
  | PadiContractSkew
  | PadiDialFailed;

/** Turn a raw dial rejection into the tagged arm that describes it. The brand
 *  check lives here and nowhere else (see {@link PadiContractSkew}); exported so
 *  the classification is unit-testable against a REAL
 *  `DaemonContractSkewError` rather than only through a live socket. */
export function classifyDialFailure(
  err: unknown,
): PadiContractSkew | PadiDialFailed {
  if (isContractSkewError(err)) {
    return new PadiContractSkew({ message: err.message });
  }
  // Guard the message a human/agent actually reads — a non-`Error` rejection (a
  // thrown string, a rejected non-Error value) would make an unguarded
  // `(err as Error).message` read `undefined`, degrading the ONE diagnostic that
  // says what broke.
  return new PadiDialFailed({
    message: err instanceof Error ? err.message : String(err),
    cause: err,
  });
}

/**
 * Dial the LOCAL padi: resolve the running daemon's socket fresh (digest-keyed
 * — see the module header), dial + handshake through `connectPadi`, then scope
 * to padi's sibling face.
 *
 * Fail-fast on the resolution edges — the CLI faces dial a padi that ALREADY
 * runs, never provision one:
 *   - no daemon discovered → a named error naming the fix (start kolu / set
 *     `$PADI_SOCKET`), not a doomed dial against the default path;
 *   - more than one → a named error listing each candidate socket.
 *
 * A LAZY effect, so "re-resolve fresh per dial" (the module header's restart
 * discipline) stays true by construction: nothing runs until the adapter redials,
 * and each run re-reads the registry.
 */
export const connectKoluCliLocal: Effect.Effect<
  KoluCliConnection,
  KoluCliDialError
> = Effect.suspend<KoluCliConnection, KoluCliDialError, never>(() => {
  const resolved = resolveRunningPadiSocket();
  if (resolved.kind === "many") {
    const lines = resolved.candidates
      .map((c) => `  PADI_SOCKET=${c.socket}`)
      .join("\n");
    return Effect.fail(
      new PadiNotAddressable({
        message: `more than one padi daemon is running on this host — set $PADI_SOCKET to pick one:\n${lines}`,
      }),
    );
  }
  if (resolved.kind === "none") {
    return Effect.fail(
      new PadiNotAddressable({
        message:
          "no running padi daemon found on this host — start kolu (its padi serves the terminals), or set $PADI_SOCKET to an explicit socket.",
      }),
    );
  }
  const socket = resolved.socket;
  return Effect.map(
    Effect.tryPromise({
      try: () => connectPadi(socket),
      catch: classifyDialFailure,
    }),
    (conn) => ({
      client: scopePadiSurface(conn.client),
      dispose: conn.dispose,
    }),
  );
});
