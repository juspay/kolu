/** Dial and assemble the frozen control-core identity probe. */

import { setTimeout as delay } from "node:timers/promises";
import {
  CONTROL_CORE_VERSION,
  type ControlCoreHello,
  controlCoreSurface,
  daemonBuild,
} from "@kolu/surface-daemon";
import { buildSurfaceFace } from "@kolu/surface/client";
import { composeSurfaceContracts } from "@kolu/surface/define";
import { duplexWireLink } from "@kolu/surface/links/stdio";
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

/** The already-dialed client shape the assembly authority needs. */
export interface ControlCoreProbeClient {
  readonly surface: {
    readonly control: {
      readonly core: {
        hello(): Promise<ControlCoreHello>;
        drain(): Promise<void>;
      };
    };
  };
}

type ProbeCommon = {
  client: ControlCoreProbeClient;
  /** Ownership hook for the transport that produced `client`. */
  dispose: () => void;
};

/** Client-form probe inputs, fenced by whether the daemon can drain. */
export type ProbeDaemonIdentityFromOptions<Cap extends DrainCapability> =
  ProbeCommon &
    (Cap extends "drainable"
      ? {
          capability: "drainable";
          drainCeilingMs: number;
          awaitExit: (signal: AbortSignal) => Promise<void>;
        }
      : { capability: "not-drainable" });

function assertDrainCeiling(ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(
      `probeDaemonIdentity drainCeilingMs must be a positive number, got ${ms}`,
    );
  }
}

/** Bound the frozen handshake without taking transport ownership from the
 * caller. The socket factory disposes on rejection; connector sessions do the
 * same in their admit boundary. */
function withHelloDeadline(
  hello: Promise<ControlCoreHello>,
): Promise<ControlCoreHello> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `control-core hello timed out after ${CONTROL_CORE_HELLO_TIMEOUT_MS}ms`,
        ),
      );
    }, CONTROL_CORE_HELLO_TIMEOUT_MS);
    hello.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Read and validate the frozen control-core hello on its one baked deadline.
 * Transport ownership stays with the caller: this function neither catches nor
 * rewrites protocol errors (including a declared member failure) and never
 * disposes the connection. */
export async function readControlCoreHello(
  client: ControlCoreProbeClient,
): Promise<ControlCoreHello> {
  const hello = await withHelloDeadline(client.surface.control.core.hello());
  if (hello.controlCoreVersion !== CONTROL_CORE_VERSION) {
    throw new Error(
      `unsupported control-core version ${hello.controlCoreVersion}; expected ${CONTROL_CORE_VERSION}`,
    );
  }
  const buildIsPresent = hello.buildId !== undefined;
  const commitIsPresent = hello.commit !== undefined;
  const buildHasValue = Boolean(hello.buildId);
  const commitHasValue = Boolean(hello.commit);
  if (buildIsPresent !== commitIsPresent || buildHasValue !== commitHasValue) {
    throw new Error(
      "incomplete control-core identity: buildId and commit must be both absent, both empty, or both non-empty",
    );
  }
  return hello;
}

/**
 * The single probe-assembly authority. Connector arms hand it their already-
 * dialed client and stronger process-exit oracle; the socket factory below
 * delegates here after it acquires the transport.
 */
export function probeDaemonIdentityFrom(
  opts: ProbeDaemonIdentityFromOptions<"drainable">,
): Promise<DrainableProbe>;
export function probeDaemonIdentityFrom(
  opts: ProbeDaemonIdentityFromOptions<"not-drainable">,
): Promise<PlainProbe>;
export async function probeDaemonIdentityFrom(
  opts:
    | ProbeDaemonIdentityFromOptions<"drainable">
    | ProbeDaemonIdentityFromOptions<"not-drainable">,
): Promise<DrainableProbe | PlainProbe> {
  if (opts.capability === "drainable") {
    assertDrainCeiling(opts.drainCeilingMs);
  }
  const hello = await readControlCoreHello(opts.client);
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
      fireDrain: () => drainable.client.surface.control.core.drain(),
      awaitExit: drainable.awaitExit,
      drainCeilingMs: drainable.drainCeilingMs,
    }))
    .exhaustive();
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
 * when the peer's FIRST frame fails to decode.
 */
type ControlCoreConnection = {
  client: ControlCoreProbeClient;
  dispose: () => void;
  /** Resolves with the typed transport fact at an explicit first-frame decode
   *  failure. Never rejects, never settles for a close, a timeout, or a member
   *  error — those stay ordinary probe failures. */
  unspeakable: Promise<UnspeakableProtocolError>;
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
 */
async function openControlCore(
  socketPath: string,
): Promise<ControlCoreConnection> {
  const socket = await dialSocket(socketPath);

  const parser = RpcSerialization.ndjson.makeUnsafe();
  let framingSettled = false;
  let raiseUnspeakable!: (err: UnspeakableProtocolError) => void;
  const unspeakable = new Promise<UnspeakableProtocolError>((resolve) => {
    raiseUnspeakable = resolve;
  });
  const onData = (chunk: Buffer): void => {
    if (framingSettled) return;
    try {
      // An empty result is a PARTIAL frame (no delimiter yet) — keep listening.
      if (parser.decode(chunk).length > 0) framingSettled = true;
    } catch (cause) {
      framingSettled = true;
      raiseUnspeakable(
        new UnspeakableProtocolError({
          socketPath,
          frame: frameExcerpt(chunk),
          cause,
        }),
      );
    }
  };
  // Kept attached for the life of the connection rather than removed once
  // settled: removing the only `data` listener leaves the socket flowing with
  // nobody reading, which would drop bytes the link still needs.
  socket.on("data", onData);

  const link = await duplexWireLink({
    group: controlCoreContract.group,
    duplex: socket,
    describe: `unix socket ${socketPath}`,
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
    unspeakable,
  };
}

/**
 * Run `work`, but let an explicit first-frame decode failure win the race.
 *
 * This is review #9's bound in one line: the classification happens AT the
 * decode, so an unspeakable peer never costs a caller the 30 s hello deadline it
 * would otherwise sit out (the hello it will never answer).
 */
function raceUnspeakable<T>(
  work: Promise<T>,
  conn: ControlCoreConnection,
): Promise<T> {
  const raised = conn.unspeakable.then((err): never => {
    throw err;
  });
  // The loser of a race is never awaited; without this the rejection would be
  // unhandled whenever `work` settles first.
  raised.catch(() => {});
  return Promise.race([work, raised]);
}

const POLL_MS = 50;

async function waitForPoll(signal: AbortSignal): Promise<void> {
  try {
    await delay(POLL_MS, undefined, { signal });
  } catch (error) {
    if (!signal.aborted) throw error;
  }
}

/**
 * Local default exit oracle: the daemon is gone only after a fresh dial finds
 * no listener. A different handshake failure is not absence and is retried
 * until the framework's ceiling aborts the oracle.
 *
 * An UNSPEAKABLE peer is not absence either — something is still serving — so
 * the loop keeps polling for its actual disappearance. What review #9 bounds is
 * the COST of each pass: without the race below, one attempt against a peer that
 * will never answer `hello` would burn the whole 30 s deadline (and, under a
 * drain ceiling, the entire wait). The decode failure ends the attempt at once
 * and the poll continues, so the oracle stays responsive inside the ceiling.
 */
async function awaitHelloGone(
  socketPath: string,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    let connection: ControlCoreConnection;
    try {
      connection = await openControlCore(socketPath);
    } catch (err) {
      if (signal.aborted) return;
      if (isNoListenerError(err)) return;
      await waitForPoll(signal);
      continue;
    }

    if (signal.aborted) {
      connection.dispose();
      return;
    }
    const abortAttempt = (): void => connection.dispose();
    signal.addEventListener("abort", abortAttempt, { once: true });
    try {
      await raceUnspeakable(
        connection.client.surface.control.core.hello(),
        connection,
      );
    } catch {
      if (signal.aborted) return;
      // A listener that cannot complete hello — including one whose framing we
      // cannot decode at all — is not proof of process exit.
    } finally {
      signal.removeEventListener("abort", abortAttempt);
      connection.dispose();
    }
    await waitForPoll(signal);
  }
}

type DrainableFactoryOptions = {
  capability: "drainable";
  drainCeilingMs: number;
};
type PlainFactoryOptions = { capability: "not-drainable" };

export function probeDaemonIdentity(
  opts: DrainableFactoryOptions,
): (socketPath: string) => Promise<DrainableProbe | null>;
export function probeDaemonIdentity(
  opts: PlainFactoryOptions,
): (socketPath: string) => Promise<PlainProbe | null>;
/**
 * Curried endpoint probe. Returns `null` only for ECONNREFUSED/ENOENT; any
 * other dial or frozen-handshake failure throws — including the typed
 * {@link UnspeakableProtocolError} an undecodable first frame raises, which the
 * endpoint (and only the endpoint, which owns the gate) may corroborate into a
 * convergence observation.
 */
export function probeDaemonIdentity(
  opts: DrainableFactoryOptions | PlainFactoryOptions,
): (socketPath: string) => Promise<DrainableProbe | PlainProbe | null> {
  if (opts.capability === "drainable") {
    assertDrainCeiling(opts.drainCeilingMs);
  }
  return async (socketPath) => {
    let connection: ControlCoreConnection;
    try {
      connection = await openControlCore(socketPath);
    } catch (err) {
      if (isNoListenerError(err)) return null;
      throw err;
    }
    try {
      if (opts.capability === "drainable") {
        return await raceUnspeakable(
          probeDaemonIdentityFrom({
            ...opts,
            client: connection.client,
            dispose: connection.dispose,
            awaitExit: (signal) => awaitHelloGone(socketPath, signal),
          }),
          connection,
        );
      }
      return await raceUnspeakable(
        probeDaemonIdentityFrom({
          ...opts,
          client: connection.client,
          dispose: connection.dispose,
        }),
        connection,
      );
    } catch (err) {
      connection.dispose();
      throw err;
    }
  };
}
