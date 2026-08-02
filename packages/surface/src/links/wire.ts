/**
 * Shared internals for the **wire** links — every link that crosses a
 * transport (`websocketLink`, `stdioLink`, `unixSocketLink`). The in-process
 * `directLink` is deliberately NOT built here: it has no transport, no
 * protocol layer and no scope, so it neither needs this machinery nor may
 * inherit the half-open brand.
 *
 * ONE job: turn an Effect RPC **protocol layer** into the transport-neutral
 * {@link SurfaceDispatch} the client face consumes (`../link.ts` — the seam
 * both W2 stages compile against), owning the scope that keeps the protocol's
 * fibers alive and handing back the `dispose` that releases it.
 *
 * Package-internal (not exported through any `@kolu/surface/*` subpath).
 *
 * ## What this file deliberately does NOT do
 *
 * - **No retry fence.** PLAN D3 / review #12: `retryTransientErrors` does not
 *   resurrect in-flight calls, so the per-subscription re-subscribe fence is
 *   the FACE's job, layered on top of the raw `Stream` this dispatch returns.
 *   A link that retried internally would hide the failure the fence must see.
 * - **No typing of members.** The group is assembled by a runtime spec walk,
 *   so a flat client over `RpcGroup<Rpc.Any>` carries no trustworthy per-tag
 *   types (review #16). Precision lives in the face's spec-derived types; here
 *   the dispatch is erased, exactly as `SurfaceDispatch` declares.
 */

import { Cause, Effect, Exit, Layer, Result, Scope, Stream } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { RpcClient } from "effect/unstable/rpc";
import { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import { Socket } from "effect/unstable/socket";
import { brandHalfOpenDispatch, type SurfaceDispatch } from "../link";

/** What every wire link factory returns: the dispatch the face binds against,
 *  plus the release of the scope the link opened. `dispose` is idempotent and
 *  is the ONLY way a link's protocol fibers (dialing, ping/pong, response
 *  pump) are released — a link that is dropped without it leaks them. */
export interface WireLink {
  /** The branded, half-openable dispatch (see `../link.ts`). */
  readonly dispatch: SurfaceDispatch;
  /** Release the link's scope: interrupt the protocol fibers and close the
   *  transport. Idempotent; after it, every call fails fast with the leg's own
   *  transport error rather than parking on a dead protocol. */
  dispose(): Promise<void>;
}

/** Why the TRANSPORT (never a member's declared error) failed a call — the
 *  input to a leg's error vocabulary. `disposed` is not an `RpcClientError`
 *  because no protocol produced it: the owner released the link. */
export type WireTransportFailure =
  | { readonly kind: "protocol"; readonly error: RpcClientError }
  | { readonly kind: "disposed" };

/** True for the transport failure channel Effect RPC unions into EVERY call
 *  (socket open/close/read/write, protocol decode defects) — as opposed to a
 *  member's DECLARED tagged error, which must reach the caller untouched. */
export function isRpcClientError(error: unknown): error is RpcClientError {
  return error instanceof RpcClientError;
}

/** The erased flat dispatch fn `RpcClient.make(group, { flatten: true })`
 *  returns for a dynamically assembled group. `RpcClient.Flat` resolves its
 *  per-tag payload/success types by matching the tag against the group's Rpc
 *  union — which, for the `Rpc.Any`-erased group `defineSurface` mints, yields
 *  `never`. So the honest local type is this one, and precision stays where
 *  review #16 put it: in the face's spec-derived types. */
type FlatDispatch = (
  tag: string,
  payload: unknown,
  // biome-ignore lint/suspicious/noExplicitAny: the return is Effect for a unary tag and Stream for a streaming one — a distinction only the spec knows, which is exactly why `SurfaceDispatch` splits `unary` from `stream` at this seam.
) => any;

/** Build a wire link over `protocol`.
 *
 *  `transportError` is the leg's error vocabulary (D4): whenever the transport
 *  channel fails — including a call issued after {@link WireLink.dispose} — the
 *  raw `RpcClientError` is replaced by whatever this returns. The stdio/unix
 *  legs mint `SurfaceStdioTransportClosed`; the websocket leg mints
 *  `SurfaceTransportRetired` once its terminal-close classifier has fired and
 *  otherwise passes the `RpcClientError` through, because THAT is the shape the
 *  face's retry fence retries on. Returning the error unchanged is therefore a
 *  legitimate answer, not a no-op. */
export async function openWireLink(opts: {
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  readonly protocol: Layer.Layer<RpcClient.Protocol, never, never>;
  readonly transportError: (failure: WireTransportFailure) => unknown;
}): Promise<WireLink> {
  // The link's own scope. It outlives `openWireLink` by construction — the
  // protocol layer forks its dial/ping/pump fibers INTO it — which is why the
  // layer cannot be provided with `Effect.provide` (that scopes the build to
  // the effect that consumes it, tearing the transport down the instant the
  // client is constructed).
  const scope = Scope.makeUnsafe();

  const client: FlatDispatch = await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* Layer.build(opts.protocol);
      return yield* Effect.provideContext(
        RpcClient.make(opts.group, { flatten: true }),
        context,
      );
    }).pipe(Scope.provide(scope)) as Effect.Effect<FlatDispatch>,
  );

  let disposed = false;
  const disposedError = () =>
    opts.transportError({ kind: "disposed" }) as unknown;

  /** Translate a call's cause into the leg's vocabulary. Three kinds arrive
   *  here and exactly one is ours:
   *
   *  - a FAILURE carrying `RpcClientError` — the transport channel: mapped.
   *  - a DEFECT carrying `Socket.SocketError` — also the transport channel,
   *    only arriving as a defect because Effect's socket protocol `orDie`s a
   *    failed WRITE. A send that dies because the pipe is gone is a transport
   *    death like any other, so it is normalised into the same
   *    `RpcClientError` shape rather than escaping as a defect that no
   *    consumer can narrow (it would crash a Promise-edge caller instead of
   *    failing its call).
   *  - anything else — a member's DECLARED tagged error, an undeclared
   *    handler defect, an interrupt: passed through UNTOUCHED (D4). */
  const rescue = (cause: Cause.Cause<unknown>): Cause.Cause<unknown> => {
    const failure = Cause.findError(cause);
    if (Result.isSuccess(failure)) {
      return isRpcClientError(failure.success)
        ? Cause.fail(
            opts.transportError({ kind: "protocol", error: failure.success }),
          )
        : cause;
    }
    const defect = Cause.findDefect(cause);
    if (Result.isSuccess(defect) && Socket.isSocketError(defect.success)) {
      return Cause.fail(
        opts.transportError({
          kind: "protocol",
          error: new RpcClientError({ reason: defect.success.reason }),
        }),
      );
    }
    return cause;
  };

  const dispatch: SurfaceDispatch = brandHalfOpenDispatch({
    unary: (tag: string, payload: unknown) =>
      Effect.suspend(
        (): Effect.Effect<unknown, unknown> =>
          disposed ? Effect.fail(disposedError()) : client(tag, payload),
      ).pipe(Effect.catchCause((cause) => Effect.failCause(rescue(cause)))),
    stream: (tag: string, payload: unknown) =>
      Stream.unwrap(
        Effect.suspend(
          (): Effect.Effect<Stream.Stream<unknown, unknown>> =>
            disposed
              ? Effect.succeed(Stream.fail(disposedError()))
              : Effect.succeed(client(tag, payload)),
        ),
      ).pipe(Stream.catchCause((cause) => Stream.failCause(rescue(cause)))),
  });

  return {
    dispatch,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      await Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };
}
