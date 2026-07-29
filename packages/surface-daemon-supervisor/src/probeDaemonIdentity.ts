/** Dial and assemble the frozen control-core identity probe. */

import {
  CONTROL_CORE_VERSION,
  type ControlCoreHello,
  controlCoreSurface,
  daemonBuild,
} from "@kolu/surface-daemon";
import { composeSurfaceContracts } from "@kolu/surface/define";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { setTimeout as delay } from "node:timers/promises";
import type {
  ConvergenceProbe,
  DrainableProbe,
  PlainProbe,
} from "./convergence/converge.ts";
import { instanceKeyFromStartedAt } from "./convergence/instanceKey.ts";
import type { DrainCapability } from "./convergence/policy.ts";

const controlCoreContract = composeSurfaceContracts({
  control: controlCoreSurface,
});

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
  const hello = await opts.client.surface.control.core.hello();
  if (hello.controlCoreVersion !== CONTROL_CORE_VERSION) {
    throw new Error(
      `unsupported control-core version ${hello.controlCoreVersion}; expected ${CONTROL_CORE_VERSION}`,
    );
  }
  const base = {
    identity: {
      contractVersion: hello.surfaceVersion,
      build: daemonBuild(hello.buildId ?? ""),
    },
    instanceKey: instanceKeyFromStartedAt(hello.startedAt),
    dispose: opts.dispose,
  };

  switch (opts.capability) {
    case "not-drainable":
      return {
        ...base,
        capability: "not-drainable",
      };
    case "drainable":
      return {
        ...base,
        capability: "drainable",
        fireDrain: () => opts.client.surface.control.core.drain(),
        awaitExit: opts.awaitExit,
        drainCeilingMs: opts.drainCeilingMs,
      };
    default: {
      const _exhaustive: never = opts;
      throw new Error(
        `unreachable probe capability: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

/** True only for an honest absent listener. */
export function isNoListenerError(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  const code = e.code ?? e.cause?.code;
  return code === "ECONNREFUSED" || code === "ENOENT";
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
 */
async function awaitHelloGone(
  socketPath: string,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    let connection:
      | Awaited<ReturnType<typeof unixSocketLink<typeof controlCoreContract>>>
      | undefined;
    try {
      connection = await unixSocketLink<typeof controlCoreContract>({
        socketPath,
      });
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
    const abortAttempt = (): void => connection?.dispose();
    signal.addEventListener("abort", abortAttempt, { once: true });
    try {
      await connection.client.surface.control.core.hello();
    } catch {
      if (signal.aborted) return;
      // A listener that cannot complete hello is not proof of process exit.
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
 * other dial or frozen-handshake failure throws.
 */
export function probeDaemonIdentity(
  opts: DrainableFactoryOptions | PlainFactoryOptions,
): (socketPath: string) => Promise<DrainableProbe | PlainProbe | null> {
  if (opts.capability === "drainable") {
    assertDrainCeiling(opts.drainCeilingMs);
  }
  return async (socketPath) => {
    let connection: Awaited<
      ReturnType<typeof unixSocketLink<typeof controlCoreContract>>
    >;
    try {
      connection = await unixSocketLink<typeof controlCoreContract>({
        socketPath,
      });
    } catch (err) {
      if (isNoListenerError(err)) return null;
      throw err;
    }
    const client = connection.client as ControlCoreProbeClient;
    try {
      if (opts.capability === "drainable") {
        return await probeDaemonIdentityFrom({
          ...opts,
          client,
          dispose: connection.dispose,
          awaitExit: (signal) => awaitHelloGone(socketPath, signal),
        });
      }
      return await probeDaemonIdentityFrom({
        ...opts,
        client,
        dispose: connection.dispose,
      });
    } catch (err) {
      connection.dispose();
      throw err;
    }
  };
}
