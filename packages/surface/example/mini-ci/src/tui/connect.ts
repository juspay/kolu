/**
 * Connect the TUI to the runner via `makeSession` + `sshConnector`.
 * Surface Remote selects `mini-ci-runner` from the wrapper-baked source,
 * provisions and roots it on the target, and runs it over ssh stdio. The
 * session owns reconnect, watchdog, and connection state. The closure bundles the
 * workspace (`surfaceExampleBase`), so the runner's `pnpm --filter …` CI
 * tasks run against it on whatever host it lands on.
 *
 * `sshConnector` takes the SURFACE as a value: Effect RPC builds its client from
 * the surface's flat `RpcGroup`, and the member face is re-nested from
 * `surface.spec` — neither is recoverable from a type alone, which is why the
 * old contract type parameter is gone.
 *
 * The source flake is baked by `nix run`; `just run [host]` supplies the same
 * independent example flake explicitly for development.
 */

import {
  type AgentClient,
  makeSession,
  resolveBakedAgentDrv,
  type Session,
  type SessionState,
  sshConnector,
  type SshProv,
} from "@kolu/surface-remote";
import { surface } from "../common/surface";

/** The runner client — the structural member face
 *  (`client.surface.<member>.<verb>`) every link mints. */
export type RunnerClient = AgentClient;
// The ssh connector PROVISIONS, so the session's `Prov` is `SshProv`
// (`"provisioning"`) — the runner overlay narrates it.
export type RunnerSession = Session<RunnerClient, SshProv>;

export interface Connection {
  /** The runner client, once the link is live. */
  client: RunnerClient;
  /** The session — the TUI calls `markConnected()` on the first frame and
   *  reads `onState` for the provisioning/connecting overlay. */
  session: RunnerSession;
  dispose(): void;
}

export interface ConnectOptions {
  /** ssh target; `localhost` runs the realised binary directly. */
  host: string;
  /** Connection-state updates (probing / provisioning / connecting / connected / …). */
  onState?: (state: SessionState<SshProv>) => void;
}

/** Open a session and resolve once the link is up (the agent spawned).
 *  Provisioning happens inside this await and is reported through `onState`. */
export async function connect(opts: ConnectOptions): Promise<Connection> {
  const session = makeSession<RunnerClient, SshProv>({
    initialConnection: "probing",
    connectOnce: sshConnector({
      surface,
      host: opts.host,
      binary: "mini-ci-runner",
      // Policy-free: the CONSUMER composes the localhost arm's spawn env, keeping only
      // the keys that are SET (an empty HOME/PATH would misdirect config/command lookup).
      // kolu uses kolu-pty's `composeSpawnEnv`; a standalone example picks inline. Never
      // the caller's ambient `process.env`; unused for a real ssh host.
      localEnv: Object.fromEntries(
        (["HOME", "PATH"] as const)
          .map((k): [string, string | undefined] => [k, process.env[k]])
          .filter((e): e is [string, string] => e[1] !== undefined),
      ),
      resolveDrvPath: (ctx) => resolveBakedAgentDrv("mini-ci-runner", ctx),
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
