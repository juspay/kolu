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
 * ## No pinger before a proven epoch (juspay/kolu#2101)
 *
 * {@link stdioLink} REQUIRES a `StdioReadinessProof`. Building the protocol
 * layer starts Effect RPC's pinger, and a peer from a previous protocol epoch
 * accepts the pipe and then stays mute — so the pinger kills the link ~10s later
 * with a generic transport error that reads exactly like an unreachable host,
 * and the consumer retries forever. The proof is minted only by
 * `awaitStdioReadiness` reading the peer's own banner, so the blind attach that
 * caused that incident is not a discipline to remember: it does not typecheck,
 * and a forged proof does not construct. See `./readiness.ts`.
 *
 * The escape hatch for LOCAL rendezvous is {@link socketDuplexLink}, named and
 * argued for below — not an option on this function.
 *
 * ## No reconnect, by construction
 *
 * A stdio link is bound to ONE stream pair: when the child exits, the pipe is
 * gone for good and re-dialling the same fds is meaningless. So the protocol's
 * retry schedule halts immediately (see `neverReconnect` in `./wire.ts`) and
 * every call — in flight or issued afterwards — fails with
 * `SurfaceStdioTransportClosed`. Callers that need reconnect build a NEW link
 * over a fresh pair (surface-remote's session loop is the canonical consumer).
 */

import type { Socket } from "node:net";
import { Duplex, type Readable, type Writable } from "node:stream";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import {
  isStdioReadinessProof,
  type StdioReadinessProof,
} from "./readiness";
import { duplexWireLink, type WireLink } from "./wire";

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
  /** Evidence that the peer on `read` greeted with a `ready` banner of THIS
   *  protocol epoch — obtained by awaiting `awaitStdioReadiness({ read, … })` on
   *  the SAME stream, BEFORE this call.
   *
   *  Required, and un-forgeable (a module-private `WeakSet` brand): it is what
   *  makes "attach an RPC client, and therefore a pinger, to a peer of unknown
   *  epoch" unrepresentable rather than merely discouraged. */
  readonly readiness: StdioReadinessProof;
}

/** Open a link over a child process's stdio pair. Async — the protocol layer
 *  and its fibers are built before the first call can be issued. Returns the
 *  branded dispatch plus the `dispose` that severs the pipe.
 *
 *  Throws (rather than returning a link) when `readiness` is not a proof this
 *  package minted — the same fail-fast refusal `createLiveSignal` makes for an
 *  unbranded dispatch, and for the same reason: the alternative is a link whose
 *  safety property is a comment. */
export function stdioLink(opts: StdioLinkOptions): Promise<WireLink> {
  if (!isStdioReadinessProof(opts.readiness)) {
    throw new Error(
      "stdioLink: `readiness` was not minted by `awaitStdioReadiness` (it carries " +
        "no readiness brand), so nothing has proven that the peer on this stream " +
        "speaks THIS protocol epoch. Attaching anyway starts Effect RPC's pinger " +
        "against a possibly previous-epoch peer, which answers nothing, dies at the " +
        "ping timeout, and reports a generic transport error indistinguishable from " +
        "an unreachable host — the juspay/kolu#2101 infinite connect loop. Await " +
        "`awaitStdioReadiness({ read, deadlineMs, describe })` on this same `read` " +
        "first and pass the proof it returns. For a LOCAL unix-socket rendezvous, " +
        "whose epoch safety is owed by converge-before-dial, use `socketDuplexLink`.",
    );
  }
  // `Duplex.from({ readable, writable })` is Node's own composition of a read
  // half and a write half into the single Duplex `duplexWireLink` wants — the
  // existing source of truth, rather than a hand-rolled adapter.
  return duplexWireLink({
    group: opts.group,
    duplex: Duplex.from({ readable: opts.read, writable: opts.write }),
    describe: opts.readiness.describe,
  });
}

/**
 * Open a link over an already-connected LOCAL unix `Socket` — used as both the
 * read and the write half, which is what makes the socket's own `close` event
 * observable to the caller (`unixSocketLink` hides it, and the supervisor's
 * endpoint needs it).
 *
 * ## A named residual, not a back door (the #1580 idiom)
 *
 * This constructor takes no readiness proof, and that is a deliberate,
 * argued-for exception rather than an oversight:
 *
 *  - **It is local-rendezvous only.** A connected `node:net` unix `Socket` is a
 *    path on THIS box. Nothing about it crosses ssh, and the type says so — a
 *    child's `stdout` is a `Readable`, not a `Socket`, so the ssh/subprocess leg
 *    cannot be spelled through here without a deliberate forgery.
 *  - **Its epoch safety is owed elsewhere, and is discharged.** Every caller
 *    dials a rendezvous the supervisor has already converged (or IS the probe
 *    that converges it): kolu's padi/kaval dials run behind
 *    `converge`/`convergeAdmit`, and `probeDaemonIdentity`'s raw byte tap is the
 *    epoch authority itself — it must attach BEFORE any proof exists, because
 *    producing that verdict is its whole job. A readiness proof there would be
 *    circular.
 *  - **It cannot be used to dodge the gate silently.** The gate's dodge
 *    resistance is that `duplexWireLink` is package-internal (see `./wire.ts`):
 *    the only two public doors are this one, which demands a `Socket`, and
 *    `stdioLink`, which demands a proof.
 */
export function socketDuplexLink(opts: {
  /** The served surface's flat `RpcGroup` (`surface.group`). */
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  /** The connected unix socket, read and write halves in one object. */
  readonly socket: Socket;
  /** How the transport is named in `SurfaceStdioTransportClosed` — what an
   *  operator reads when the daemon vanishes (e.g. `unix socket /run/padi.sock`). */
  readonly describe: string;
}): Promise<WireLink> {
  return duplexWireLink({
    group: opts.group,
    duplex: opts.socket,
    describe: opts.describe,
  });
}
