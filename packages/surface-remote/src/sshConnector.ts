/**
 * `sshConnector` — the ssh transport plug for {@link makeSession} (S9/S10).
 *
 * "A session over ssh" is no longer a type or a class (the deleted `HostSession`);
 * it is `makeSession({ connectOnce: sshConnector(opts) })`. The connector is the
 * kept primitive: it owns everything transport-specific — resolve the agent's
 * `.drv` per attempt (typically an ssh arch probe), Nix-provision the closure onto
 * the host, spawn `ssh <host> <binary> --stdio`, and wire the stdio byte channel to
 * a contract-typed client — and hands the loop ONE {@link Connection} per dial. The
 * reconnect/backoff/give-up/watchdog machinery is `makeSession`'s.
 *
 * Multiple consumers each `makeSession({ connectOnce: sshConnector(...) })` and OWN
 * the session they get (no shared pool): kolu's remote-padi arm, drishti's fleet,
 * odu's lanes. Each keys its own map and tears its own sessions down.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { stdioLink } from "@kolu/surface/links/stdio";
import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import type { AnyContractRouter, ContractRouterClient } from "@orpc/contract";
import {
  buildAgentCommand,
  forEachLine,
  isLocalHost,
  ResolveDrvError,
} from "./host";
import { provisionAgent } from "./nixCopy";
import {
  type ClosedInfo,
  ConnectError,
  type Connection,
  type Connector,
  surfaceLiveProbe,
} from "./session";

/** The typed RPC client an ssh agent yields — a contract-router client carrying the
 *  retry plugin's context. Generic so consumers can name their own:
 *
 *  ```ts
 *  type MyClient = AgentClient<typeof myContract>;
 *  ``` */
export type AgentClient<C extends AnyContractRouter> = ContractRouterClient<
  C,
  ClientRetryPluginContext
>;

/** The ssh connector's OWN provisioning-phase vocabulary — the `Prov` a
 *  `makeSession` over {@link sshConnector} carries. Each phase names what is
 *  ACTUALLY happening, split at the real command boundaries `nixCopy.ts` runs:
 *   - `"probing"`  — the OPENING phase: the ssh arch probe (`resolveDrvPath`) plus
 *                     the warm realise-probe (`nix-store --realise` — "does the host
 *                     already have the closure?"). No copy exists yet; on a WARM host
 *                     this is the whole provisioning story and it never enters
 *                     `copying`. This is why the warm path stays CALM — a warm dial
 *                     goes `probing → connecting → connected` with no build UI.
 *   - `"copying"`  — `nix copy --derivation …` is ACTUALLY pushing the `.drv` (the
 *                     COLD path only; entered at the copy command boundary).
 *   - `"building"` — `ssh $host nix-store --realise …` is compiling it (the minutes,
 *                     on a first connect to a fresh host).
 *  A session opens at `"probing"` and advances to `"copying"` then `"building"` via
 *  `ctx.provisioning`, each at its real command boundary (`nixCopy`'s `onCopying`/
 *  `onBuilding` hooks). */
export type SshProv = "probing" | "copying" | "building";

export interface SshConnectorOptions {
  /** ssh target; `localhost` runs the realised binary directly. */
  host: string;
  /** Executable name inside the realised closure — the full spawn path is
   *  `${agentPath}/bin/${binary}`, run as `<binary> --stdio`. */
  binary: string;
  /** Resolve the agent's `.drv` for this host. Called at the top of EVERY dial (not
   *  once up front), so the round-trip that picks the derivation — typically an ssh
   *  `nix-instantiate` arch probe via `resolveSystem` — lives inside the session's
   *  own reconnect machinery. An unreachable host makes the resolver reject, which
   *  the loop treats as a `"network"` fault (retry forever). To mark a resolver
   *  rejection as a NON-transport, bounded → terminal fault (the host probed fine but
   *  no derivation is baked for its system), reject with a {@link ResolveDrvError}
   *  carrying `failureCause: "remote"`.
   *
   *  Pass a constant as `() => Promise.resolve(drv)` when the caller already knows
   *  the path and has no probe to defer. */
  resolveDrvPath: () => Promise<string>;
  /** Extra args appended after `--stdio` on the agent command line — a generic
   *  spawn-arg carrier; what the args mean is the caller's concern. POSIX-quoted for
   *  a real remote; verbatim for localhost. See `buildAgentCommand`. */
  extraArgs?: readonly string[];
  /** The COMPLETE env for a localhost dial's direct `spawn` — REQUIRED (see
   *  `buildAgentCommand`). Threaded straight through; on a real remote it is unused
   *  (the ssh child inherits the caller's env). The caller composes a clean env (kolu
   *  via kolu-pty's `composeSpawnEnv`); surface-remote stays policy-free. Required so
   *  a localhost dial can never fall back to ambient full-inherit — the seam #1880
   *  left and #1872 forbids. drishti and every kolu CLI plug in here. */
  localEnv: Record<string, string>;
}

/** Build an ssh {@link Connector} for `(host, binary)`. Each `connectOnce` call
 *  resolves the drv (fail → classified `ConnectError`), provisions the closure,
 *  spawns the ssh child, and returns a {@link Connection} whose `closed` resolves on
 *  the child's exit/error and whose `isAlive` is the reserved `system.live` probe. */
export function sshConnector<C extends AnyContractRouter>(
  opts: SshConnectorOptions,
): Connector<AgentClient<C>, SshProv> {
  return async (ctx): Promise<Connection<AgentClient<C>>> => {
    // Resolve the derivation first — where the arch probe (or any deferred per-host
    // drv lookup) runs. A host unreachable at probe time rejects here and is
    // classified `"network"` (retry forever) unless it is a `ResolveDrvError`
    // carrying an explicit cause (an unsupported/mis-baked system → `"remote"`,
    // bounded → terminal).
    let drvPath: string;
    try {
      drvPath = await opts.resolveDrvPath();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const cause =
        err instanceof ResolveDrvError ? err.failureCause : "network";
      throw new ConnectError(reason, cause);
    }

    const provision = await provisionAgent({
      host: opts.host,
      drvPath,
      onProgress: (line) => ctx.localProgress(line),
      // Advance the phase at the REAL command boundaries (cold path only), so the
      // overlay names what is actually happening: `probing → copying` when `nix copy`
      // starts, `copying → building` at the realise boundary. A WARM host skips both
      // (the fused realise-probe short-circuits) and stays `probing` → connecting.
      onCopying: () => ctx.provisioning("copying"),
      onBuilding: () => ctx.provisioning("building"),
    });
    if (!provision.ok) {
      // `provisionAgent` classifies why: a `"remote"` rejection (e.g. `trusted-users`
      // won't accept the closure) is bounded → terminal; a `"network"` failure (the
      // host went unreachable mid-copy, after the probe succeeded) keeps retrying.
      throw new ConnectError(provision.reason, provision.cause);
    }
    const realisedAgentPath = provision.agentPath;

    // Transport is up: build the client and flip the loop to `connecting`.
    ctx.connecting();
    const { command, args, env } = buildAgentCommand({
      host: opts.host,
      agentPath: realisedAgentPath,
      binary: opts.binary,
      extraArgs: opts.extraArgs,
      localEnv: opts.localEnv,
    });
    const child: ChildProcess = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      // `env` is the caller-composed localhost env, or `undefined` on the ssh arm
      // (inherit — the local ssh client needs `SSH_AUTH_SOCK` / `~/.ssh`). A localhost
      // spawn therefore NEVER inherits the caller's ambient env (#1872 / PR1.5).
      env,
    });

    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk: string) =>
      forEachLine(chunk, (line) => ctx.remoteProgress(line)),
    );

    // One `closed` per connection: the child's `exit` (a link/agent death — the loop
    // classifies it by `wasConnected`/kind) or `error` (the transport couldn't even
    // spawn — a local/config fault the loop reads as bounded `"remote"`). `settle`
    // fires it at most once.
    let onClosed!: (info: ClosedInfo) => void;
    const closed = new Promise<ClosedInfo>((resolve) => {
      onClosed = resolve;
    });
    let settled = false;
    const settle = (info: ClosedInfo): void => {
      if (settled) return;
      settled = true;
      onClosed(info);
    };
    // A REMOTE dial went through ssh; localhost ran the binary directly (no ssh).
    // ssh exits 255 for its OWN connection failures, so over a real ssh link a 255
    // is (indistinguishably — ssh gives no better signal) either the transport
    // failing or the remote command itself exiting 255; presume the transport (the
    // standard ssh-255 convention) and classify it at the CONNECTOR as a distinct
    // `transport-failed`, rather than leaking a magic `code === 255` into the
    // transport-agnostic session loop. A localhost 255 has no ssh in play, so it
    // stays an honest process `exit` (the loop bounds it as `"remote"`).
    const usesSsh = !isLocalHost(opts.host);
    child.on("exit", (code, signal) =>
      settle(
        usesSsh && code === 255
          ? { kind: "transport-failed" }
          : { kind: "exit", code, signal },
      ),
    );
    child.on("error", (err) =>
      settle({ kind: "spawn-error", message: err.message }),
    );

    if (child.stdin === null || child.stdout === null) {
      throw new Error("ssh subprocess has no stdin/stdout — unreachable");
    }
    const client = stdioLink<C>({
      read: child.stdout,
      write: child.stdin,
    });

    return {
      client,
      closed,
      // The framework-reserved `system.live` round-trip — contract-agnostic, so no
      // consumer probe is needed. A rejection still counts as alive (the round-trip
      // completed); only a true non-answer (the loop's watchdog timeout) cycles.
      isAlive: surfaceLiveProbe(client),
      teardown: () => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* best-effort — a child already exiting is fine */
        }
      },
    };
  };
}
