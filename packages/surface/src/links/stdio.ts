/**
 * Stdio link — the subprocess / ssh leg of the link family. The PARENT side of
 * a child that serves its surface over its own stdin/stdout (`serveOverStdio`
 * in `../peer-server.ts`), and the shape `@kolu/surface-remote` rides over an
 * ssh pipe.
 *
 * ## Framing
 *
 * ndjson — `RpcSerialization.layerNdjson`, the SAME serialization every other
 * leg uses. The base64 codec this file used to carry (`stdio-codec.ts`) is
 * deleted with the oRPC peer protocol: ndjson is self-framing (one JSON value
 * per line), and no surface member carries raw binary, so there is nothing left
 * for base64 to make newline-safe. That is what keeps `frontDaemonOverStdio`'s
 * contract-blind byte splice legal (review #10) — the stdio leg and the
 * unix-socket leg emit byte-identical frames, pinned by
 * `byteSplice.test.ts`.
 *
 * ## Stdout IS the protocol channel
 *
 * On the SERVER side (the subprocess) any stray write to stdout corrupts the
 * frame stream. `serveOverStdio` redirects `console.log` to stderr when it owns
 * stdout; on THIS side a corrupt inbound line is a decode failure that fails the
 * in-flight calls with `SurfaceStdioTransportClosed` rather than wedging them —
 * pinned in `procedureErrors.test.ts`.
 *
 * ## No reconnect, by construction
 *
 * A stdio link is bound to ONE stream pair: when the child exits, the pipe is
 * gone for good and re-dialling the same fds is meaningless. So the protocol's
 * retry schedule halts immediately (see {@link neverReconnect}) and every call —
 * in flight or issued afterwards — fails with `SurfaceStdioTransportClosed`.
 * Callers that need reconnect build a NEW link over a fresh pair (surface-remote's
 * `HostSession` is the canonical consumer).
 */

import { Duplex, type Readable, type Writable } from "node:stream";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { Cause, Effect, Layer, Schedule } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";
import { SurfaceStdioTransportClosed } from "../errors";
import { openWireLink, type WireLink } from "./wire";

/** The retry schedule for a link bound to one stream pair: halt on the first
 *  failure. Not a policy knob — a re-dial would re-acquire the SAME dead fds,
 *  so the only honest schedule is "never". */
const neverReconnect: Schedule.Schedule<number, Socket.SocketError> =
  Schedule.fromStepWithMetadata(
    Effect.succeed((meta: Schedule.InputMetadata<Socket.SocketError>) =>
      Cause.done(meta.attempt),
    ),
  );

/** A `Readable`/`Writable` pair the link reads and writes. For a subprocess
 *  parent these are `child.stdout` / `child.stdin`; for a loopback test they are
 *  the `client` half of a {@link import("../loopback").LoopbackPair}. */
export interface StdioLinkOptions {
  /** The served surface's flat `RpcGroup` (`surface.group`). */
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  /** Stream the link reads inbound frames from (the child's stdout). */
  readonly read: Readable;
  /** Stream the link writes outbound frames to (the child's stdin). */
  readonly write: Writable;
}

/** Build a wire link over an already-open Node `Duplex` — the ONE place the
 *  stdio and unix-socket legs share, so their framing, their retry schedule and
 *  their error vocabulary cannot drift (which is the whole basis of the
 *  byte-splice guarantee, review #10).
 *
 *  `describe` names the transport in the `SurfaceStdioTransportClosed` reason,
 *  because that string is what an operator reads when a daemon vanishes. */
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

  const protocol = Layer.effect(RpcClient.Protocol)(
    RpcClient.makeProtocolSocket({ retryPolicy: neverReconnect }),
  ).pipe(
    Layer.provide([
      Layer.succeed(Socket.Socket)(socket),
      RpcSerialization.layerNdjson,
    ]),
  );

  return openWireLink({
    group: opts.group,
    protocol,
    transportError: (failure) =>
      new SurfaceStdioTransportClosed({
        reason:
          failure.kind === "disposed"
            ? `${opts.describe} link disposed; request not sent`
            : `${opts.describe} transport closed (${failure.error.message}); the peer process exited or its stream ended`,
      }),
  });
}

/** Open a link over a child process's stdio pair. Async — the protocol layer
 *  and its fibers are built before the first call can be issued. Returns the
 *  branded dispatch plus the `dispose` that severs the pipe. */
export function stdioLink(opts: StdioLinkOptions): Promise<WireLink> {
  // `Duplex.from({ readable, writable })` is Node's own composition of a read
  // half and a write half into the single Duplex `NodeSocket.fromDuplex`
  // wants — the existing source of truth, rather than a hand-rolled adapter.
  return duplexWireLink({
    group: opts.group,
    duplex: Duplex.from({ readable: opts.read, writable: opts.write }),
    describe: "stdio",
  });
}
