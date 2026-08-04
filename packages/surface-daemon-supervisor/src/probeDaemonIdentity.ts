/** Dial and assemble the frozen control-core identity probe. */

import {
  CONTROL_CORE_VERSION,
  type ControlCoreHello,
  controlCoreSurface,
  daemonBuild,
} from "@kolu/surface-daemon";
import { buildSurfaceFace } from "@kolu/surface/client";
import { composeSurfaceContracts } from "@kolu/surface/define";
import { duplexWireLink } from "@kolu/surface/links/stdio";
import { Deferred, Effect } from "effect";
import { RpcSerialization } from "effect/unstable/rpc";
import { match } from "ts-pattern";
import type { DrainableProbe, PlainProbe } from "./convergence/converge.ts";
import { instanceKeyFromStartedAt } from "./convergence/instanceKey.ts";
import type { DrainCapability } from "./convergence/policy.ts";
import {
  frameExcerpt,
  UnspeakableProtocolError,
} from "./convergence/unspeakable.ts";
import { dialSocket } from "./dialSocket.ts";

const controlCoreContract = composeSurfaceContracts({
  control: controlCoreSurface,
});
const CONTROL_CORE_HELLO_TIMEOUT_MS = 30_000;

/**
 * Review #9's OWN bound for the second unspeakable trigger: how long a peer that
 * accepted our connection may say **nothing at all** before it is classified as
 * not-of-this-epoch.
 *
 * The value is not a free knob — it is pinned between two facts of the protocol
 * we run, both pinned by `probeDaemonIdentity.test.ts`:
 *
 * - **Floor (5 s).** Effect's RPC socket protocol pings every 5 s and a peer of
 *   this epoch answers `Pong` from the protocol layer, *below* its handlers. So
 *   a daemon that is merely SLOW — one whose `hello` handler is blocked, or
 *   whose event loop stalled — has still demonstrably spoken within 5 s. Any
 *   bound above that cannot mistake slowness for silence.
 * - **Ceiling (~10 s).** Two ping intervals with no pong and that same protocol
 *   kills the connection itself, with a `SocketOpenError` the leg reports as an
 *   ordinary transport death. Past ~10 s there is nothing left to classify: the
 *   outcome degrades to `probe-failed`, which is exactly the measured failure
 *   this trigger exists to fix (a real previous-release kaval, silent, refused
 *   instead of recycled).
 *
 * BETA-ASSUMPTION(beta.102): the RPC socket protocol pings every 5 s and kills the connection after two unanswered pings.
 *   Both numbers are protocol BEHAVIOR — nothing in the type system holds them
 *   — and the 8 s is derived from them, so a bump that moves either turns this
 *   value from the generous middle into a floor breach or a dead trigger.
 *
 * 8 s takes the generous end of that band — 3 s of headroom over a slow peer's
 * pong, 2 s of margin under the protocol's own execution. Both timers live in
 * THIS process's event loop and Node fires timers in deadline order, so the
 * ordering is deterministic under load, not a race we hope to win.
 */
export const UNSPEAKABLE_SILENCE_MS = 8_000;

/** The already-dialed client shape the assembly authority needs — the frozen
 *  control-core fragment's two verbs, EFFECT-native because that is what a
 *  `@kolu/surface` member face hands back. A connector arm passes the same
 *  nesting off its own app client. */
export interface ControlCoreProbeClient {
  readonly surface: {
    readonly control: {
      readonly core: {
        hello(): Effect.Effect<ControlCoreHello, unknown>;
        drain(): Effect.Effect<void, unknown>;
      };
    };
  };
}

type ProbeCommon = {
  client: ControlCoreProbeClient;
  /** Ownership hook for the transport that produced `client`. */
  dispose: () => void;
};

/** Client-form probe inputs, fenced by whether the daemon can drain.
 *
 *  `awaitExit` is an EFFECT, not a signal-taking promise. Its one job — stop
 *  polling once the framework's ceiling wins — is what fiber interruption does
 *  natively, so the `AbortSignal` that used to carry that instruction is gone
 *  along with every plug's obligation to observe it. */
export type ProbeDaemonIdentityFromOptions<Cap extends DrainCapability> =
  ProbeCommon &
    (Cap extends "drainable"
      ? {
          capability: "drainable";
          drainCeilingMs: number;
          awaitExit: Effect.Effect<void>;
        }
      : { capability: "not-drainable" });

function assertDrainCeiling(ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(
      `probeDaemonIdentity drainCeilingMs must be a positive number, got ${ms}`,
    );
  }
}

/** Read and validate the frozen control-core hello on its one baked deadline —
 * a fiber timeout, so the deadline is cancelled by the answer rather than
 * cleared by hand, and an interrupted probe takes its timer with it.
 * Transport ownership stays with the caller: this function neither catches nor
 * rewrites protocol errors (including a declared member failure) and never
 * disposes the connection. */
export function readControlCoreHello(
  client: ControlCoreProbeClient,
): Effect.Effect<ControlCoreHello, Error> {
  return Effect.suspend(() => client.surface.control.core.hello()).pipe(
    Effect.mapError((err) => err as Error),
    Effect.timeoutOrElse({
      duration: CONTROL_CORE_HELLO_TIMEOUT_MS,
      orElse: () =>
        Effect.fail(
          new Error(
            `control-core hello timed out after ${CONTROL_CORE_HELLO_TIMEOUT_MS}ms`,
          ),
        ),
    }),
    Effect.flatMap((hello) => {
      if (hello.controlCoreVersion !== CONTROL_CORE_VERSION) {
        return Effect.fail(
          new Error(
            `unsupported control-core version ${hello.controlCoreVersion}; expected ${CONTROL_CORE_VERSION}`,
          ),
        );
      }
      const buildIsPresent = hello.buildId !== undefined;
      const commitIsPresent = hello.commit !== undefined;
      const buildHasValue = Boolean(hello.buildId);
      const commitHasValue = Boolean(hello.commit);
      if (
        buildIsPresent !== commitIsPresent ||
        buildHasValue !== commitHasValue
      ) {
        return Effect.fail(
          new Error(
            "incomplete control-core identity: buildId and commit must be both absent, both empty, or both non-empty",
          ),
        );
      }
      return Effect.succeed(hello);
    }),
  );
}

/**
 * The single probe-assembly authority. Connector arms hand it their already-
 * dialed client and stronger process-exit oracle; the socket factory below
 * delegates here after it acquires the transport.
 */
export function probeDaemonIdentityFrom(
  opts: ProbeDaemonIdentityFromOptions<"drainable">,
): Effect.Effect<DrainableProbe, Error>;
export function probeDaemonIdentityFrom(
  opts: ProbeDaemonIdentityFromOptions<"not-drainable">,
): Effect.Effect<PlainProbe, Error>;
export function probeDaemonIdentityFrom(
  opts: AnyProbeFromOptions,
): Effect.Effect<DrainableProbe | PlainProbe, Error> {
  return assembleProbe(opts);
}

type AnyProbeFromOptions =
  | ProbeDaemonIdentityFromOptions<"drainable">
  | ProbeDaemonIdentityFromOptions<"not-drainable">;

/** The un-overloaded body. The exported name carries the capability overloads so
 *  a caller that KNOWS its arm gets the narrow probe type back; the socket
 *  factory below hands in a union it computed, which no overload set can
 *  resolve, so it composes this instead. */
function assembleProbe(
  opts: AnyProbeFromOptions,
): Effect.Effect<DrainableProbe | PlainProbe, Error> {
  return Effect.suspend(() => {
    if (opts.capability === "drainable") {
      assertDrainCeiling(opts.drainCeilingMs);
    }
    return readControlCoreHello(opts.client).pipe(
      Effect.map((hello) => {
        const base = {
          identity: {
            contractVersion: hello.surfaceVersion,
            build: daemonBuild(hello.buildId ?? ""),
          },
          instanceKey: instanceKeyFromStartedAt(hello.startedAt),
          dispose: opts.dispose,
        };

        return match(opts)
          .with({ capability: "not-drainable" }, () => ({
            ...base,
            capability: "not-drainable" as const,
          }))
          .with({ capability: "drainable" }, (drainable) => ({
            ...base,
            capability: "drainable" as const,
            // Suspended, so the drain verb is a description the framework fires
            // when it is ready to — never work started at assembly time.
            fireDrain: Effect.suspend(() =>
              drainable.client.surface.control.core.drain(),
            ),
            awaitExit: drainable.awaitExit,
            drainCeilingMs: drainable.drainCeilingMs,
          }))
          .exhaustive();
      }),
    );
  });
}

/** True only for an honest absent listener. */
export function isNoListenerError(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  const code = e.code ?? e.cause?.code;
  return code === "ECONNREFUSED" || code === "ENOENT";
}

// ── The dial: one socket, one framing tap, one link ─────────────────────────

/**
 * A dialed control-core connection, plus the ONE extra observation the epoch
 * break demands (PLAN D6 / #3): `unspeakable` settles — and only ever settles —
 * at one of the two triggers `UnspeakableEvidence` enumerates.
 */
type ControlCoreConnection = {
  client: ControlCoreProbeClient;
  dispose: () => void;
  /** Succeeds with the typed transport fact at an explicit first-frame decode
   *  failure, or at {@link UNSPEAKABLE_SILENCE_MS} of total silence from a peer
   *  that accepted the connection. Never fails, and never completes for a close,
   *  for the frozen hello's own deadline, or for a member error — those stay
   *  ordinary probe failures. */
  unspeakable: Effect.Effect<UnspeakableProtocolError>;
};

/**
 * Dial `socketPath` and open the frozen control-core link over it.
 *
 * The dial is this package's own {@link dialSocket} rather than
 * `unixSocketLink`, for one reason: the framing TAP below needs the connected
 * socket, and `unixSocketLink` dials it internally. Everything else is
 * identical — `dialSocket` rejects with the raw socket error (`ECONNREFUSED` /
 * `ENOENT`, the "nothing is serving here" verdict every probe in the tree reads)
 * exactly as `unixSocketLink`'s eager dial does, and the link itself is
 * `duplexWireLink`, the shared body `unixSocketLink` and `stdioLink` are BOTH
 * built from — so the bytes on this wire are the same bytes either leg writes
 * (`@kolu/surface`'s byte-splice proof).
 *
 * **The tap.** `RpcSerialization.ndjson` is Effect's OWN parser — the very
 * implementation the protocol layer runs — so "decodable here" means exactly
 * "decodable there"; this is not a second framing authority, it is the same one
 * asked one layer earlier. It is attached BEFORE the link is built, deliberately:
 * a socket with no reader is paused, and whichever `data` listener attaches
 * first drains what was buffered. A legitimate peer never speaks before we do
 * (the RPC server answers requests, it does not greet), so the tap only ever
 * front-runs a peer that is already misbehaving.
 *
 * A frame that decodes — even into a JSON value that is not an RPC message —
 * is SPEAKABLE. This tap classifies FRAMING, never semantics: that is what keeps
 * the observation as narrow as D6/#3 requires.
 *
 * **The silence deadline.** The tap above only fires against a peer that SPEAKS
 * first, and a real previous-release daemon does not: its oRPC `ServerPeer` sits
 * waiting for a client hello it can recognise, our ndjson frames never look like
 * one, and there is no first frame to fail decoding at all. That peer is every
 * bit as unspeakable, so the same `unspeakable` effect carries a second, equally
 * explicit trigger — {@link UNSPEAKABLE_SILENCE_MS} elapsed with **not one
 * inbound byte**. The two triggers are mutually exclusive by construction: the
 * first byte of any kind disarms the deadline, whether or not it decodes.
 *
 * The deadline is no longer an eagerly-armed `setTimeout`: `unspeakable` is a
 * DESCRIPTION of the two triggers, and its sleep begins only when someone races
 * against it (and is cancelled the moment they stop). That is why the `unref`
 * this used to need is gone rather than merely unspelled — a deadline nobody is
 * waiting on does not exist, so it cannot by itself keep a process alive.
 */
function openControlCore(
  socketPath: string,
): Effect.Effect<ControlCoreConnection, Error> {
  return Effect.gen(function* () {
    const socket = yield* dialSocket(socketPath);

    const parser = RpcSerialization.ndjson.makeUnsafe();
    let framingSettled = false;
    // Two observations, each latched once by the node listener below: "the peer
    // has said SOMETHING" (which disarms the silence trigger for the rest of
    // this connection) and "the peer's first frame did not decode".
    const spoke = Deferred.makeUnsafe<void>();
    const framing = Deferred.makeUnsafe<UnspeakableProtocolError>();
    const onData = (chunk: Buffer): void => {
      // ANY byte, decodable or not, proves the peer is talking to us — the silence
      // trigger is off the table for the rest of this connection.
      Deferred.doneUnsafe(spoke, Effect.void);
      if (framingSettled) return;
      try {
        // An empty result is a PARTIAL frame (no delimiter yet) — keep listening.
        if (parser.decode(chunk).length > 0) framingSettled = true;
      } catch (cause) {
        framingSettled = true;
        Deferred.doneUnsafe(
          framing,
          Effect.succeed(
            new UnspeakableProtocolError({
              socketPath,
              evidence: {
                trigger: "undecodable-frame",
                frame: frameExcerpt(chunk),
              },
              cause,
            }),
          ),
        );
      }
    };
    // Kept attached for the life of the connection rather than removed once
    // settled: removing the only `data` listener leaves the socket flowing with
    // nobody reading, which would drop bytes the link still needs.
    socket.on("data", onData);

    const link = yield* Effect.tryPromise({
      try: () =>
        duplexWireLink({
          group: controlCoreContract.group,
          duplex: socket,
          describe: `unix socket ${socketPath}`,
        }),
      catch: (err) => err as Error,
    });
    const face = buildSurfaceFace(
      controlCoreContract.siblings.control,
      link.dispatch,
    );

    return {
      // The sibling face's members ARE `{ core: { hello, drain } }`; nesting it
      // under `control` restores the shape connector arms hand us from their own
      // full app client, so both callers of `probeDaemonIdentityFrom` speak one
      // vocabulary. The structural face carries no per-member types (D2/#16), so
      // the assertion here is the same one the oRPC-era dial made.
      client: { surface: { control: face.surface } } as ControlCoreProbeClient,
      dispose: () => {
        socket.off("data", onData);
        // Fire-and-forget: `ConvergenceProbeBase.dispose` is synchronous (connector
        // arms hand us their own sync disposer). A scope-close failure is a
        // framework defect and surfaces as an unhandled rejection rather than
        // being swallowed here.
        void link.dispose();
      },
      unspeakable: Effect.raceFirst(
        Deferred.await(framing),
        // The silence trigger, disarmed by the first byte: whichever of the two
        // arrives first wins, and a peer that spoke turns this arm into a wait
        // that never completes.
        Effect.raceFirst(
          Effect.as(
            Effect.sleep(UNSPEAKABLE_SILENCE_MS),
            new UnspeakableProtocolError({
              socketPath,
              evidence: {
                trigger: "silence",
                silentForMs: UNSPEAKABLE_SILENCE_MS,
              },
            }),
          ),
          Effect.andThen(Deferred.await(spoke), Effect.never),
        ),
      ),
    };
  });
}

/**
 * Run `work`, but let an unspeakable classification win the race.
 *
 * This is review #9's bound in one line: the classification happens AT the
 * decode, or at {@link UNSPEAKABLE_SILENCE_MS} for a peer that never speaks — so
 * an unspeakable peer never costs a caller the 30 s hello deadline it would
 * otherwise sit out (the hello it will never answer).
 *
 * The loser is INTERRUPTED rather than abandoned, so the "the rejection would be
 * unhandled whenever `work` settles first" guard the promise version needed has
 * nothing left to guard.
 */
function raceUnspeakable<T, E>(
  work: Effect.Effect<T, E>,
  conn: ControlCoreConnection,
): Effect.Effect<T, E | UnspeakableProtocolError> {
  return Effect.raceFirst(work, Effect.flatMap(conn.unspeakable, Effect.fail));
}

const POLL_MS = 50;

/**
 * Local default exit oracle: the daemon is gone only after a fresh dial finds
 * no listener. A different handshake failure is not absence and is retried
 * until the framework's ceiling aborts the oracle.
 *
 * An UNSPEAKABLE peer is not absence either — something is still serving — so
 * the loop keeps polling for its actual disappearance. What review #9 bounds is
 * the COST of each pass: without the race below, one attempt against a peer that
 * will never answer `hello` would burn the whole 30 s deadline (and, under a
 * drain ceiling, the entire wait). A decode failure ends the attempt at once and
 * a silent peer ends it after {@link UNSPEAKABLE_SILENCE_MS}, so no pass can
 * exceed that bound and the oracle stays responsive inside the ceiling.
 */
/** What one pass of the oracle learned. `gone` is the ONE reading that ends the
 *  wait, and only an honest absent listener earns it. */
type ExitPass = "gone" | "still-serving";

function helloGonePass(socketPath: string): Effect.Effect<ExitPass> {
  return openControlCore(socketPath).pipe(
    Effect.flatMap((connection) =>
      raceUnspeakable(
        connection.client.surface.control.core.hello(),
        connection,
      ).pipe(
        // A listener that cannot complete hello — including one whose framing we
        // cannot decode at all — is not proof of process exit.
        Effect.ignoreCause,
        Effect.as<ExitPass>("still-serving"),
        // Runs on a normal end AND on interruption — which is the whole of what
        // the `abort` listener + `finally` pair used to do by hand.
        Effect.ensuring(Effect.sync(() => connection.dispose())),
      ),
    ),
    Effect.catch((err) =>
      Effect.succeed<ExitPass>(
        isNoListenerError(err) ? "gone" : "still-serving",
      ),
    ),
  );
}

/** The exit oracle: poll until a fresh dial finds no listener. It never fails,
 *  and it has no stop condition of its own — the framework's ceiling stops it by
 *  INTERRUPTING it, which cancels the sleep and releases the open connection
 *  through the `ensuring` above. That is what the `AbortSignal` the plug used to
 *  take was for, and it is why there is no longer one to take. */
function awaitHelloGone(socketPath: string): Effect.Effect<void> {
  return helloGonePass(socketPath).pipe(
    Effect.tap((pass) =>
      pass === "gone" ? Effect.void : Effect.sleep(POLL_MS),
    ),
    Effect.repeat({ until: (pass: ExitPass) => pass === "gone" }),
    Effect.asVoid,
  );
}

type DrainableFactoryOptions = {
  capability: "drainable";
  drainCeilingMs: number;
};
type PlainFactoryOptions = { capability: "not-drainable" };

export function probeDaemonIdentity(
  opts: DrainableFactoryOptions,
): (socketPath: string) => Effect.Effect<DrainableProbe | null, Error>;
export function probeDaemonIdentity(
  opts: PlainFactoryOptions,
): (socketPath: string) => Effect.Effect<PlainProbe | null, Error>;
/**
 * Curried endpoint probe. Succeeds `null` only for ECONNREFUSED/ENOENT; any
 * other dial or frozen-handshake failure fails — including the typed
 * {@link UnspeakableProtocolError} raised by an undecodable first frame or by
 * {@link UNSPEAKABLE_SILENCE_MS} of silence, which the endpoint (and only the
 * endpoint, which owns the gate) may corroborate into a convergence observation.
 */
export function probeDaemonIdentity(
  opts: DrainableFactoryOptions | PlainFactoryOptions,
): (
  socketPath: string,
) => Effect.Effect<DrainableProbe | PlainProbe | null, Error> {
  if (opts.capability === "drainable") {
    assertDrainCeiling(opts.drainCeilingMs);
  }
  return (socketPath) =>
    openControlCore(socketPath).pipe(
      Effect.flatMap((connection) =>
        raceUnspeakable(
          assembleProbe(
            opts.capability === "drainable"
              ? {
                  ...opts,
                  client: connection.client,
                  dispose: connection.dispose,
                  awaitExit: awaitHelloGone(socketPath),
                }
              : {
                  ...opts,
                  client: connection.client,
                  dispose: connection.dispose,
                },
          ),
          connection,
        ).pipe(
          // The probe OWNS the transport until it hands it to the caller: a
          // failed assembly (or a classification that won the race) disposes
          // it here; a successful one passes `dispose` out on the probe.
          Effect.onError(() => Effect.sync(() => connection.dispose())),
        ),
      ),
      // The ONE outcome that is not a failure: nothing is serving here.
      Effect.catch((err) =>
        isNoListenerError(err) ? Effect.succeed(null) : Effect.fail<Error>(err),
      ),
    );
}
