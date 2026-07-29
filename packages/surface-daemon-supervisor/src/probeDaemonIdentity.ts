/** Dial and assemble the frozen control-core identity probe. */

import {
  type ControlCoreHello,
  controlCoreSurface,
  daemonBuild,
} from "@kolu/surface-daemon";
import { composeSurfaceContracts } from "@kolu/surface/define";
import { stdioLink } from "@kolu/surface/links/stdio";
import type {
  ConvergenceProbe,
  DrainableProbe,
  PlainProbe,
} from "./convergence/converge.ts";
import { instanceKeyFromStartedAt } from "./convergence/instanceKey.ts";
import type { DrainCapability } from "./convergence/policy.ts";
import { dialSocket } from "./dialSocket.ts";

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
  const hello = await opts.client.surface.control.core.hello();
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
      assertDrainCeiling(opts.drainCeilingMs);
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
function isNoListenerError(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  const code = e.code ?? e.cause?.code;
  return code === "ECONNREFUSED" || code === "ENOENT";
}

const POLL_MS = 50;

function waitForPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, POLL_MS);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
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
    let socket: Awaited<ReturnType<typeof dialSocket>> | undefined;
    try {
      socket = await dialSocket(socketPath);
      const client = stdioLink<typeof controlCoreContract>({
        read: socket,
        write: socket,
      });
      await client.surface.control.core.hello();
    } catch (err) {
      socket?.destroy();
      if (isNoListenerError(err)) return;
      // A listener that cannot complete hello is not proof of process exit.
      await waitForPoll(signal);
      continue;
    }
    socket.destroy();
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
    let socket: Awaited<ReturnType<typeof dialSocket>>;
    try {
      socket = await dialSocket(socketPath);
    } catch (err) {
      if (isNoListenerError(err)) return null;
      throw err;
    }
    const client = stdioLink<typeof controlCoreContract>({
      read: socket,
      write: socket,
    }) as ControlCoreProbeClient;
    try {
      if (opts.capability === "drainable") {
        return await probeDaemonIdentityFrom({
          ...opts,
          client,
          dispose: () => socket.destroy(),
          awaitExit: (signal) => awaitHelloGone(socketPath, signal),
        });
      }
      return await probeDaemonIdentityFrom({
        ...opts,
        client,
        dispose: () => socket.destroy(),
      });
    } catch (err) {
      socket.destroy();
      throw err;
    }
  };
}
