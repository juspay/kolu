/**
 * The supervisor's `connect` — dial the daemon's socket and hand the endpoint a
 * live, handshaken connection.
 *
 * `connect` is the supervisor's *soul*: the endpoint state machine
 * (`createEndpoint`) is generic over the client `C` and the identity `I` and
 * interprets neither — it only orchestrates gate-read → kill → wait → spawn →
 * connect → transition reports. What "connected" and "identity" MEAN live here.
 *
 * We dial the unix socket via the supervisor's own `dialSocket` (it owns the
 * connect/error race), then build an Effect RPC link over the socket's byte
 * stream with `stdioLink` — a connected socket IS a Duplex, and the ndjson
 * framing is the same one `serveOverUnixSocket` serves. `buildSurfaceFace`
 * re-nests the flat wire tags into `client.surface.<member>.<verb>`. Reading the
 * `load` cell's first frame then doubles as the handshake and stamps the
 * identity (`cores`) the endpoint reports.
 */

import {
  buildSurfaceFace,
  type StreamingProcedure,
} from "@kolu/surface/client";
import { socketDuplexLink } from "@kolu/surface/links/stdio";
import type { SurfaceFace } from "@kolu/surface/client";
import type { DaemonConnection } from "@kolu/surface-daemon-supervisor";
import { dialSocket } from "@kolu/surface-daemon-supervisor";
import { Effect, Option, Stream } from "effect";
import { type Load, surface } from "../common/surface";

/** The client the endpoint holds — the surface's structural member face.
 *  There is no contract type to be generic over any more: the dispatch under a
 *  face is the erased, transport-neutral seam, and per-member precision lives
 *  in the spec-derived bound hooks a Solid consumer builds. */
export type TopClient = SurfaceFace;

/** What "identity" means for this daemon — enough to prove the link answered
 *  and show a fact in the status line. */
export interface TopIdentity {
  cores: number;
}

/** The first frame of a snapshot-then-deltas member. `Stream.runHead`
 *  interrupts the subscription as soon as that frame lands. */
function snapshot<T>(
  stream: Stream.Stream<T, unknown>,
  what: string,
): Effect.Effect<T, Error> {
  // A member stream fails with `unknown`; the endpoint's `connect` contract is
  // "a plain Error unless it is the branded skew", so the narrowing happens HERE,
  // once, rather than at each caller.
  const head = Effect.mapError(Stream.runHead(stream), (err) =>
    err instanceof Error ? err : new Error(String(err)),
  );
  return Effect.flatMap(head, (head) =>
    Option.isNone(head)
      ? Effect.fail(
          new Error(`${what}: stream closed before its snapshot frame`),
        )
      : Effect.succeed(head.value),
  );
}

/** The endpoint's `connect` is an EFFECT — the supervisor composes it into its
 *  own fibers, so a boot it gives up on tears the half-made connection down. */
export function connectTop(
  socketPath: string,
): Effect.Effect<DaemonConnection<TopClient, TopIdentity>, Error> {
  return Effect.gen(function* () {
    const socket = yield* dialSocket(socketPath);
    // `socketDuplexLink` is a Promise-shaped constructor by contract, so it is
    // LIFTED. No readiness proof: a connected LOCAL unix socket is the residual
    // that constructor names — this rendezvous never leaves the box, and the
    // supervisor converges it before anything dials it.
    const link = yield* Effect.promise(() =>
      socketDuplexLink({
        group: surface.group,
        socket,
        describe: `unix socket ${socketPath}`,
      }),
    );
    const client = buildSurfaceFace(surface, link.dispatch);

    // Handshake: the first frame of the `load` cell proves the daemon is serving
    // AND yields the identity we report. A dial that connects but never answers
    // would hang here — the endpoint's `socketReadyMs` ceiling covers that.
    const load = yield* snapshot(
      (client.surface.load?.get as StreamingProcedure<undefined, Load>)(
        undefined,
      ),
      "load",
    );

    const closeCbs: Array<() => void> = [];
    let closed = false;
    socket.once("close", () => {
      closed = true;
      for (const cb of closeCbs) cb();
    });

    return {
      client,
      identity: { cores: load.cores },
      startedAt: Date.now(),
      // Release the LINK's scope first (it holds the protocol's response fibers),
      // then drop the socket. Dropping the socket alone would leak them.
      dispose: () => {
        void link.dispose().finally(() => socket.destroy());
      },
      // The endpoint subscribes to this to flip `connected → degraded` when the
      // daemon dies mid-session (fires at most once).
      onClose: (cb) => {
        if (closed) cb();
        else closeCbs.push(cb);
      },
    };
  });
}
