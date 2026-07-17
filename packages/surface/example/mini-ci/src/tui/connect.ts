/**
 * Connect the TUI to the runner via `@kolu/surface-remote`'s `HostSession`
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
  makeSession,
  type Session,
  type SessionState,
  sshConnector,
  type SshProv,
} from "@kolu/surface-remote";
import type { surface } from "../common/surface";

export type RunnerClient = AgentClient<typeof surface.contract>;
// The ssh connector PROVISIONS, so the session's `Prov` is `SshProv`
// (`"copying" | "building"`) — the runner overlay narrates both.
export type RunnerSession = Session<RunnerClient, SshProv>;

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
  /** Connection-state updates (copying / building / connecting / connected / …). */
  onState?: (state: SessionState<SshProv>) => void;
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
  const session = makeSession<RunnerClient, SshProv>({
    initialConnection: "probing",
    connectOnce: sshConnector<typeof surface.contract>({
      host: opts.host,
      binary: "mini-ci-runner",
      // Policy-free: the CONSUMER composes the localhost arm's spawn env (kolu uses
      // kolu-pty's `composeSpawnEnv`). Never the caller's ambient `process.env`; unused for ssh.
      localEnv: { HOME: process.env.HOME ?? "", PATH: process.env.PATH ?? "" },
      // Constant resolver: the justfile already picked the host-arch drv. A
      // consumer that defers the probe would call `resolveSystem(host)` here.
      resolveDrvPath: () => Promise.resolve(drv),
    }),
    label: `host:${opts.host}`,
  });
  if (opts.onState !== undefined) session.onState(opts.onState);
  const client = await session.pin();
  return {
    client,
    session,
    dispose: () => session.destroy(),
  };
}
