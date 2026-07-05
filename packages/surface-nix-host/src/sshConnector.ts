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
import { probeSurfaceLive } from "@kolu/surface/liveness";
import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import type { AnyContractRouter, ContractRouterClient } from "@orpc/contract";
import { buildAgentCommand, forEachLine, ResolveDrvError } from "./host";
import { provisionAgent } from "./nixCopy";
import {
  type ClosedInfo,
  ConnectError,
  type Connection,
  type Connector,
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
}

/** Build an ssh {@link Connector} for `(host, binary)`. Each `connectOnce` call
 *  resolves the drv (fail → classified `ConnectError`), provisions the closure,
 *  spawns the ssh child, and returns a {@link Connection} whose `closed` resolves on
 *  the child's exit/error and whose `isAlive` is the reserved `system.live` probe. */
export function sshConnector<C extends AnyContractRouter>(
  opts: SshConnectorOptions,
): Connector<AgentClient<C>> {
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
    const { command, args } = buildAgentCommand({
      host: opts.host,
      agentPath: realisedAgentPath,
      binary: opts.binary,
      extraArgs: opts.extraArgs,
    });
    const child: ChildProcess = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk: string) =>
      forEachLine(chunk, (line) => ctx.remoteProgress(line)),
    );

    // One `closed` per connection: the child's `exit` (a link/agent death — the loop
    // classifies it by `wasConnected`/`code`) or `error` (the transport couldn't even
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
    child.on("exit", (code, signal) => settle({ kind: "exit", code, signal }));
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
      isAlive: () => probeSurfaceLive(client).then(() => undefined),
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
