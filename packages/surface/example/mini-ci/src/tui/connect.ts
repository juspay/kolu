/**
 * Connect the TUI to the runner via `@kolu/surface-nix-host`'s `HostSession`
 * — **the drishti way**. `nix copy`s the prebuilt `mini-ci-runner` closure to
 * the host (skipped for localhost), realises it there, and runs
 * `mini-ci-runner --stdio` over ssh; `HostSession` owns the ref-count,
 * reconnect, watchdog, and connection-state cell. The closure bundles the
 * workspace (`surfaceExampleBase`), so the runner's `pnpm --filter …` CI
 * tasks run against it on whatever host it lands on.
 *
 * The runner's `.drv` is named per the host's nix-system. `just run [host]`
 * resolves it (arch probe + `nix eval`) and passes `MINI_CI_RUNNER_DRV`,
 * exactly like drishti's `KOLU_AGENT_DRV`; `nix run .#mini-ci` bakes the
 * current system's drv.
 */

import {
  type AgentClient,
  getHostSession,
  type HostSession,
  type HostSessionState,
} from "@kolu/surface-nix-host";
import type { surface } from "../common/surface";

export type RunnerClient = AgentClient<typeof surface.contract>;
export type RunnerSession = HostSession<typeof surface.contract>;

export interface Connection {
  /** The typed runner client, once the link is live. */
  client: RunnerClient;
  /** The session — the TUI calls `markConnected()` on the first frame and
   *  reads `onState` for the copying/connecting overlay. */
  session: RunnerSession;
  dispose(): void;
}

export interface ConnectOptions {
  /** ssh target; `localhost` runs the realised binary directly. */
  host: string;
  /** Connection-state updates (copying / connecting / connected / …). */
  onState?: (state: HostSessionState) => void;
}

/** Open a session and resolve once the link is up (the agent spawned). The
 *  `nix copy` + realise happen inside this await — `onState` reports
 *  `copying`/`connecting` while it's pending. */
export async function connect(opts: ConnectOptions): Promise<Connection> {
  const drv = process.env.MINI_CI_RUNNER_DRV;
  if (drv === undefined || drv.length === 0) {
    throw new Error(
      "mini-ci: MINI_CI_RUNNER_DRV is required — the mini-ci-runner .drv for the host's nix-system.\n" +
        "  Use `just run [host]` (resolves it via an arch probe), or `nix run .#mini-ci` (bakes the current system's drv).",
    );
  }
  const session = getHostSession<typeof surface.contract>({
    host: opts.host,
    // Constant resolver: the justfile already picked the host-arch drv. A
    // consumer that defers the probe would call `resolveSystem(host)` here.
    resolveDrvPath: () => Promise.resolve(drv),
    binary: "mini-ci-runner",
  });
  if (opts.onState !== undefined) session.onState(opts.onState);
  const client = await session.pin();
  return {
    client,
    session,
    dispose: () => session.destroy(),
  };
}
