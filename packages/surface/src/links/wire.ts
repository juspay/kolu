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
 * The machinery here is package-internal. The `@kolu/surface/links/wire`
 * subpath exists for ONE reason: this file is the canonical account of the
 * link's keep-alive, so {@link RPC_PING_INTERVAL_MS} / {@link RPC_PING_TIMEOUT_MS}
 * / {@link RPC_PING_FATAL_SILENCE_MS} are readable by the tests elsewhere that
 * reason about link silence, instead of being transcribed into a local literal.
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

import type { Duplex } from "node:stream";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {
  Cause,
  Context,
  Effect,
  Exit,
  Layer,
  Result,
  Schedule,
  Scope,
  Stream,
} from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import type { Rpc, RpcGroup } from "effect/rpc";
import { RpcClientError } from "effect/rpc/RpcClientError";
import { Socket } from "effect/socket";
import { SurfaceStdioTransportClosed } from "../errors";
import { rpcSerialization } from "../frameLimit";
import {
  RPC_PING_FATAL_SILENCE_MS,
  RPC_PING_INTERVAL_MS,
  RPC_PING_TIMEOUT_MS,
} from "../keepAlive";
import { brandHalfOpenDispatch, type SurfaceDispatch } from "../link";
import { decoupleDelivery } from "./deliveryLanes";

/** The keep-alive numbers every leg passes to its pinger. Owned by
 *  `../keepAlive` (the leaflet, which states their derivation) and re-exported
 *  so this subpath's importers keep one import path; the canonical account of
 *  the MECHANISM is `duplexWireLink`'s docstring below. */
export { RPC_PING_FATAL_SILENCE_MS, RPC_PING_INTERVAL_MS, RPC_PING_TIMEOUT_MS };

/** The ndjson serialization every leg's CLIENT protocol uses — the shared one
 *  (`../frameLimit`), with ONE addition: the leg is told the moment the parser
 *  throws, so it can END the link instead of leaving it half-alive.
 *
 *  A throw is never a per-call event. The parser holds a byte buffer shared by
 *  every request on the wire, and when it throws it discards that buffer, so
 *  whatever followed the bad line in the same read is gone too, and the next
 *  read starts at an unknown offset. Effect then fails every call in flight and
 *  keeps the socket. A wire in that state cannot be trusted with the next frame,
 *  so each leg ends it for real and lets its reconnect path heal (the duplex
 *  legs by ending the stream, the websocket leg by cycling its socket).
 *
 *  BETA-ASSUMPTION(4.1.4): a decode throw from the ndjson parser fails every call in flight but keeps the socket run alive.
 *  In effect@4.1.4 `rpc/RpcSerialization.ts` `makeNdjson` throws
 *  `NdjsonDecodeError` (or `MaxBufferSizeExceeded`) after resetting its
 *  buffer, and `rpc/RpcClient.ts` `makeProtocolSocket`'s `processData` catches
 *  it and broadcasts a `ClientProtocolError` without ending the run. Measured
 *  by `stdio.test.ts` ("a corrupted answer ends the link") and
 *  `websocket.test.ts` ("an undecodable frame cycles the socket"). */
export function undecodableAware(
  onUndecodable: () => void,
): Layer.Layer<RpcSerialization.RpcSerialization> {
  return Layer.succeed(RpcSerialization.RpcSerialization)(
    RpcSerialization.RpcSerialization.of({
      ...rpcSerialization,
      makeUnsafe: () => {
        const parser = rpcSerialization.makeUnsafe();
        return {
          ...parser,
          decode: (bytes) => {
            try {
              return parser.decode(bytes);
            } catch (cause) {
              onUndecodable();
              throw cause;
            }
          },
        };
      },
    }),
  );
}

/** The retry schedule for a link bound to one stream pair: halt on the first
 *  failure. Not a policy knob — a re-dial would re-acquire the SAME dead fds,
 *  so the only honest schedule is "never".
 *
 *  MEASURED, not assumed (`stdioPingStall.test.ts`): flipping this to
 *  `retryTransientErrors: true` + a spaced schedule — the obvious "let a slow
 *  peer recover" fix, and the one the WEBSOCKET leg really does take — does not
 *  work here and cannot. `fromDuplex` acquires the duplex inside the socket
 *  RUN's scope, whose finaliser destroys it when the run ends; the retry then
 *  re-acquires that destroyed duplex and dies on its first write. The stall test
 *  fails either way, only with a less honest error (`SocketWriteError`). Anyone
 *  reaching for that flag here should re-run that test first. */
const neverReconnect: Schedule.Schedule<number, Socket.SocketError> =
  Schedule.fromStepWithMetadata(
    Effect.succeed((meta: Schedule.InputMetadata<Socket.SocketError>) =>
      Cause.done(meta.attempt),
    ),
  );

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
 *  `transportError` is the leg's READING of a transport death (D4): whenever the
 *  transport channel fails, the raw `RpcClientError` is replaced by whatever this
 *  returns. The stdio/unix legs mint `SurfaceStdioTransportClosed`; the websocket
 *  leg mints `SurfaceTransportRetired` once its terminal-close classifier has
 *  fired and otherwise passes the `RpcClientError` through, because THAT is the
 *  shape the face's retry fence retries on. Returning the error unchanged is
 *  therefore a legitimate answer, not a no-op.
 *
 *  `disposedError` is the OTHER channel, and it is split out because it is not a
 *  reading of anything: a call issued after {@link WireLink.dispose} never
 *  reached a protocol, so no transport reported. THIS function owns that fact —
 *  it owns `dispose` — and stamps it, so a leg cannot re-derive "was it
 *  disposed?" from a `kind` field and cannot get the answer different from the
 *  bookkeeping that decided it. The leg supplies only the value, because the two
 *  legs' vocabularies are different classes. */
export async function openWireLink(opts: {
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  readonly protocol: Layer.Layer<RpcClient.Protocol, never, never>;
  readonly transportError: (error: RpcClientError) => unknown;
  readonly disposedError: () => unknown;
}): Promise<WireLink> {
  // The link's own scope. It outlives `openWireLink` by construction — the
  // protocol layer forks its dial/ping/pump fibers INTO it — which is why the
  // layer cannot be provided with `Effect.provide` (that scopes the build to
  // the effect that consumes it, tearing the transport down the instant the
  // client is constructed).
  const scope = Scope.makeUnsafe();

  // RpcClient.Flat<Rpc.Any> gives its payload parameter type `never` because
  // ExtractTag cannot recover members from the erased group. Cast only the
  // payload at the call boundary; leave the construction Effect's
  // error/environment types checked (the face restores per-member types).
  const typedClient = await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* Layer.build(opts.protocol);
      // Every leg's protocol is wrapped HERE, at the one seam they all cross,
      // so no leg can be built with a reader a consumer can block
      // (`./deliveryLanes.ts`).
      const decoupled = decoupleDelivery(
        Context.get(context, RpcClient.Protocol),
        scope,
      );
      return yield* Effect.provideContext(
        RpcClient.make(opts.group, { flatten: true }),
        Context.add(context, RpcClient.Protocol, decoupled),
      );
    }).pipe(
      Scope.provide(scope),
      // A refused build (a protocol without acks) must not leave the
      // protocol's dial/ping fibers running in a scope nobody will dispose.
      Effect.onError(() => Scope.close(scope, Exit.void)),
    ),
  );
  const client: FlatDispatch = (tag, payload) =>
    typedClient(tag, payload as never);

  let disposed = false;

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
        ? Cause.fail(opts.transportError(failure.success))
        : cause;
    }
    const defect = Cause.findDefect(cause);
    if (Result.isSuccess(defect) && Socket.isSocketError(defect.success)) {
      return Cause.fail(
        opts.transportError(
          new RpcClientError({ reason: defect.success.reason }),
        ),
      );
    }
    return cause;
  };

  const dispatch: SurfaceDispatch = brandHalfOpenDispatch({
    unary: (tag: string, payload: unknown) =>
      Effect.suspend(
        (): Effect.Effect<unknown, unknown> =>
          disposed ? Effect.fail(opts.disposedError()) : client(tag, payload),
      ).pipe(Effect.catchCause((cause) => Effect.failCause(rescue(cause)))),
    stream: (tag: string, payload: unknown) =>
      Stream.unwrap(
        Effect.suspend(
          (): Effect.Effect<Stream.Stream<unknown, unknown>> =>
            disposed
              ? Effect.succeed(Stream.fail(opts.disposedError()))
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

/** Build a wire link over an already-open Node `Duplex` — the ONE place the
 *  stdio and unix-socket legs share, so their framing, their retry schedule and
 *  their error vocabulary cannot drift (which is the whole basis of the
 *  byte-splice guarantee, review #10).
 *
 *  `describe` names the transport in the `SurfaceStdioTransportClosed` reason,
 *  because that string is what an operator reads when a daemon vanishes.
 *
 *  **Package-internal, and that is load-bearing** (juspay/kolu#2101). This is
 *  the raw attach: it builds the protocol layer — and with it Effect RPC's
 *  pinger — over whatever duplex it is handed, with no proof that the far end is
 *  of this protocol epoch. Every PUBLIC way to reach it must therefore carry its
 *  own epoch argument: `stdioLink` demands a `StdioReadinessProof`,
 *  `socketDuplexLink` is a documented local-rendezvous residual, and
 *  `unixSocketLink` is the same rendezvous by another spelling. Exporting this
 *  body through a subpath would restore the blind attach the gate abolishes,
 *  which is why it moved out of `./stdio` (an exported subpath) and into this
 *  file (which is not one). */
export async function duplexWireLink(opts: {
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  readonly duplex: Duplex;
  readonly describe: string;
}): Promise<WireLink> {
  // A destroyed pipe emits 'error' on the stream, and an 'error' with no
  // listener is a hard process crash — not a rejection a consumer can catch.
  // Effect's socket attaches its own listeners only WHILE running, so this
  // permanent one covers the windows either side (an EPIPE felled a
  // consumer's coordinator on teardown before the oRPC-era link grew the same
  // guard). The transport death itself is handled by the socket run failing.
  opts.duplex.on("error", () => {});

  const socket = await Effect.runPromise(
    NodeSocket.fromDuplex(
      Effect.acquireRelease(Effect.succeed(opts.duplex), (duplex) =>
        Effect.sync(() => {
          if (!duplex.destroyed) duplex.destroy();
        }),
      ),
    ),
  );

  /**
   * WHICH death ended this link, when it was not the pipe breaking. Set by the
   * two signals the link owns, before any call fails, and read by
   * `transportError` below. One value for the link's whole life: a duplex leg
   * never reconnects ({@link neverReconnect}), so there is exactly one
   * connection for the flag to describe. The FIRST death wins.
   */
  let death: "keepAliveUnanswered" | "undecodableFrame" | undefined;

  /**
   * THE KEEP-ALIVE — the canonical account for this repo. `stdioPingStall.test.ts`,
   * `../keepAlive.ts`, `sshConnector.ts`, `errors.ts` and the surface reference
   * page each carry a sentence and a pointer here, because this is the code that
   * sets it and names its death.
   *
   * THE MECHANISM. `RpcClient.makeProtocolSocket` runs a pinger: it writes a ping
   * every `pingInterval`, ANY frame this side decodes from the peer counts as
   * liveness, and a tick that finds its ping outstanding and no frame for longer
   * than `pingTimeout` ends the socket run. This link passes both numbers from
   * `../keepAlive.ts` — a ping every 5s, fatal past 60s of total silence, so the
   * death lands 60–65s after the last frame.
   *
   * WHY SO LONG: the pinger is a BACKSTOP. On this leg a peer that really dies
   * is reported by the OS (EOF) at once, and on an ssh leg by ssh's own
   * dead-peer policy (30s at its defaults). What the pinger alone adds is
   * "alive but silent", and that is the framework watchdog's call
   * (`../heartbeat.ts`: suspension-aware, and on a same-box arm consulting a
   * process oracle), which decides at 25s at its defaults. So the backstop sits
   * above both and only ever ends a link nothing else would. It cannot be
   * retried through (see {@link neverReconnect}, where that is MEASURED).
   *
   * WHAT "UNANSWERED" MEANS — and what it does not. The pinger only counts a
   * frame once THIS side's read loop decodes it, so silence is a fact about the
   * reader as much as about the peer: the PEER went quiet without closing the
   * pipe, or THIS process could not read for a minute. (A local stream consumer
   * that stops pulling is not a cause: delivery is off the reader, see
   * `./deliveryLanes.ts`.) So `keepAliveUnanswered` says the WIRE went quiet as
   * this reader saw it — never proof that the peer exited.
   *
   * The death is NAMED by `onPingTimeout`, which Effect runs before it fails a
   * single call — not by matching the error the pinger raises, which is a
   * `SocketReadError` like any ordinary read failure.
   */
  const protocol = Layer.effect(RpcClient.Protocol)(
    RpcClient.makeProtocolSocket({
      retryPolicy: neverReconnect,
      pingInterval: RPC_PING_INTERVAL_MS,
      pingTimeout: RPC_PING_TIMEOUT_MS,
      onPingTimeout: Effect.sync(() => {
        death ??= "keepAliveUnanswered";
      }),
    }),
  ).pipe(
    Layer.provide([
      Layer.succeed(Socket.Socket)(socket),
      // An undecodable frame ENDS the link: named first, then the stream is
      // severed, so the in-flight calls Effect fails for the bad line and every
      // later call read the same death (see `undecodableAware`).
      undecodableAware(() => {
        death ??= "undecodableFrame";
        if (!opts.duplex.destroyed) opts.duplex.destroy();
      }),
    ]),
  );

  const link = await openWireLink({
    group: opts.group,
    protocol,
    // The classification is DATA (`death`); `reason` is only the sentence beside
    // it. What each death means about the peer belongs to the literal's own
    // docstring in `errors.ts`, so this framework mints no operator paragraph
    // and a consumer that owns the user-facing words can brand its own.
    //
    // `describe` is a noun phrase naming the TRANSPORT — `padi on myhost`,
    // `unix socket /run/padi.sock`, `loopback` — and none of those is something
    // a peer sits "on". So it takes the LABEL position that `readiness.ts`
    // already puts the same string in, and the peer gets its own noun after the
    // colon.
    transportError: (error) => {
      switch (death) {
        case "keepAliveUnanswered":
          return new SurfaceStdioTransportClosed({
            death,
            reason: `${opts.describe}: the peer stopped answering the keep-alive ping`,
          });
        case "undecodableFrame":
          return new SurfaceStdioTransportClosed({
            death,
            reason: `${opts.describe}: the peer wrote a line that is not a protocol frame (${error.message}); the link was ended because the stream after it cannot be trusted`,
          });
        case undefined:
          return new SurfaceStdioTransportClosed({
            death: "streamEnded",
            reason: `${opts.describe} transport closed (${error.message}); the peer process exited or its stream ended`,
          });
      }
    },
    disposedError: () =>
      new SurfaceStdioTransportClosed({
        death: "disposed",
        reason: `${opts.describe} link disposed; request not sent`,
      }),
  });

  return {
    dispatch: link.dispatch,
    /** Close the protocol's scope, THEN sever the duplex this function was
     *  handed.
     *
     *  The second half is not redundant, and the case it covers is the ordinary
     *  one for a short-lived client: a link that is disposed having placed NO
     *  request. Effect's socket protocol attaches the duplex when its run
     *  starts, and the run starts with the first request — so on a
     *  dial-then-dispose the scope closes over a protocol that never attached,
     *  the `fromDuplex` release never fires, and the open descriptor keeps the
     *  process alive with nothing left to do. (A CLI that dials, answers from a
     *  hand-authored verb that touches no member, and exits, hung forever.)
     *
     *  Guarded and idempotent: when the protocol DID run, its own release has
     *  already destroyed the duplex and this is a no-op. `dispose` on
     *  `openWireLink` is itself idempotent, so calling this twice is safe. */
    dispose: async () => {
      await link.dispose();
      if (!opts.duplex.destroyed) opts.duplex.destroy();
    },
  };
}
