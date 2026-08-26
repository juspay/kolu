/**
 * kolu-cli's LOCAL padi dial — the connect layer the CLI faces (`kolu mcp`,
 * later `kolu tui`) share, owned by the composition root: resolve the running
 * padi's digest-keyed socket, dial it through the shared `@kolu/padi-client/dial` kit
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

import { type LocalPadiTarget, localPadiSocket } from "@kolu/padi/stateRoot";
import {
  connectPadi,
  type PadiConnection,
  scopePadiSurface,
} from "@kolu/padi-client/dial";
import { isContractSkewError } from "@kolu/surface-daemon-supervisor";
import { Data, Effect } from "effect";
import type { KoluMcpConnection } from "kolu-mcp";
import { errorMessage } from "./exit.ts";

/** The transport-blind handle a CLI face is written against — the padi-scoped
 *  client, a `dispose` that drops the socket/pipe, and the transport's optional
 *  close announcement.
 *
 *  Deliberately `KoluMcpConnection` itself rather than a re-declaration of its
 *  three fields. Re-declaring them is the same shape of hazard as #2082 one
 *  level up: a field added to one copy and forgotten on the other drifts in
 *  silence, because `guardedMcpDial` passes the value across the package
 *  boundary by structural width-subtyping alone, so nothing says so. An alias
 *  makes that drift unspellable — and kolu-cli already depends on kolu-mcp, so
 *  the arrow points the way it already points. `KoluMcpConnection` in turn
 *  `extends` the adapter's own `OwnedSurfaceConnection`, so the whole chain from
 *  dial to adapter is one shape rather than three copies.
 *
 *  The name stays because the two roles differ: this is what a CLI FACE is
 *  written against (`kolu mcp` today, `kolu tui` later), and only one of those
 *  faces is the MCP adapter. See {@link KoluMcpConnection} for the field docs,
 *  including why `onClose` is optional.
 *
 *  Deliberately NOT an `Effect.acquireRelease`d resource, and the reason is the
 *  consumer: the MCP adapter (`kolu-mcp`) OWNS a dialed connection's lifetime —
 *  it holds one across many tool calls and disposes it on its own redial /
 *  shutdown path. A scope here would end the link at the wrong moment (the dial
 *  effect's own scope), so the handle keeps carrying its `dispose` and the dial
 *  hands the resource OUT. Where kolu-cli owns a link itself — it does not
 *  today — the scoped form is the one to reach for. */
export type KoluCliConnection = KoluMcpConnection;

/** The running padi could not be NAMED: none discovered, or several with no
 *  `$PADI_SOCKET` to pick one. A usage fact about this host, never a transient
 *  — a retry cannot change it, so it is its own tag. */
export class PadiNotAddressable extends Data.TaggedError("PadiNotAddressable")<{
  readonly message: string;
}> {}

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
  // `errorMessage` guards the message a human/agent actually reads — a
  // non-`Error` rejection read through an unguarded `(err as Error).message`
  // says `undefined`, degrading the ONE diagnostic that says what broke. It is
  // `exit.ts`'s, shared with the verbs and the endpoint dial, so this package
  // makes that judgement in one place.
  return new PadiDialFailed({ message: errorMessage(err), cause: err });
}

/**
 * Dial the LOCAL padi `target` names: resolve its socket fresh (digest-keyed —
 * see the module header), dial + handshake through `connectPadi`, then scope to
 * padi's sibling face.
 *
 * WHICH padi is now an ARGUMENT rather than a hardcoded "whatever is running".
 * It used to be neither: this face re-derived the resolution and its refusal
 * sentences itself, which is why `kolu mcp` was the one face that could not be
 * pointed at a specific padi — a limitation no user could name, and the reason
 * `--socket` / `--state-root` had to be REFUSED on this face while every verb
 * honored them. `endpoint.ts` hands the target down and the dev/e2e spelling
 * (`kolu mcp --state-root .kolu-dev/padi`) works like every other verb's.
 *
 * Fail-fast on the resolution edges — the CLI faces dial a padi that ALREADY
 * runs, never provision one. The judgement AND its two sentences are padi's
 * `localPadiSocket` (beside the daemon discovery they narrow); all this layer
 * adds is the tagged arm the sentence rides, so the MCP adapter's skew-vs-
 * transport policy still reads one alphabet.
 *
 * A LAZY effect, so "re-resolve fresh per dial" (the module header's restart
 * discipline) stays true by construction: nothing runs until the adapter redials,
 * and each run re-reads the registry.
 */
export function connectKoluCliLocal(
  target: LocalPadiTarget,
): Effect.Effect<KoluCliConnection, KoluCliDialError> {
  return Effect.suspend<KoluCliConnection, KoluCliDialError, never>(() => {
    const resolved = localPadiSocket(target);
    if (resolved.kind === "unaddressable") {
      return Effect.fail(new PadiNotAddressable({ message: resolved.message }));
    }
    return Effect.map(
      // `connectPadi` is an Effect; the classification stays at the RAISE site so
      // everything past the dial matches a `_tag` rather than an `instanceof`
      // across two module instances of the supervisor package.
      Effect.mapError(connectPadi(resolved.socket), classifyDialFailure),
      koluCliConnectionOf,
    );
  });
}

/** Project a dialed `PadiConnection` onto the face-visible
 *  {@link KoluCliConnection} — scope the client to padi's sibling, and carry the
 *  transport's `dispose` AND `onClose` across.
 *
 *  Its own function because forgetting a field here is silent and expensive:
 *  the inline object literal this replaced dropped `onClose` on the floor, and
 *  that omission WAS juspay/kolu#2082. Named and shared so the e2e pin composes
 *  the same projection the product does, instead of a look-alike that can drift
 *  back; `hostConnect.ts`'s `koluCliConnectionOfAgentDial` is its ssh mirror. */
export function koluCliConnectionOf(conn: PadiConnection): KoluCliConnection {
  return {
    client: scopePadiSurface(conn.client),
    // Both transport members go across through a closure, not as bare method
    // references: `DaemonConnection` declares `dispose()` and `onClose()` as
    // METHODS, so a detached `conn.dispose` would call with no receiver and
    // break any implementation that reads `this`. padi's own are arrow
    // properties closing over the socket, but the contract does not promise
    // that of every daemon, and the two members must not disagree on how
    // carefully they are carried.
    dispose: () => conn.dispose(),
    onClose: (cb) => conn.onClose(cb),
  };
}
