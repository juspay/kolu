/**
 * `kaval-tui --host <ssh>` — reach a kaval on a remote machine over ssh,
 * provisioning it with Nix, and hand back a `Connection` of the SAME shape the
 * local unix-socket path returns. Every `cmd*()` (list/create/snapshot/attach)
 * is written against `Connection`, so the transport is the only thing that
 * changes — the commands are byte-for-byte unchanged over ssh.
 *
 * The whole reach + provision + supervise machinery is `@kolu/surface-nix-host`'s
 * `getHostSession`: it resolves the daemon's `.drv` for the host's arch, ships
 * it (`nix copy --derivation` → realise), runs `ssh <host> kaval --stdio`, and
 * speaks `ptyHostSurface` over that child's stdio. kaval's `--stdio` mode fronts
 * the *durable* daemon (see `kaval/src/stdioBridge.ts`), so a PTY a `create`
 * spawns survives the ssh link and a later `attach` finds it. This module is the
 * thin kaval-tui-side, CLI-local composition of `getHostSession`: a one-shot
 * dialer that fires `markConnected()` itself and discards the `HostSession`,
 * because a one-shot CLI needs no copying/connecting overlay and never reads
 * `onState`. A long-lived consumer (kolu-server, P3) does NOT reuse this exact
 * `Connection` — it would compose its own variant carrying `session`/`onState`.
 *
 * This is the ONLY place kaval-tui imports `@kolu/surface-nix-host` — it must
 * never leak into the kaval daemon closure (the staleKey allow-list).
 */
import { getHostSession, resolveSystem } from "@kolu/surface-nix-host";
import type { ptyHostSurface } from "kaval";
import type { Connection } from "./connect.ts";

/** The executable name inside the realised closure — `${agentPath}/bin/kaval`,
 *  run as `kaval --stdio`. Matches the kaval derivation's `meta.mainProgram`. */
const KAVAL_BINARY = "kaval";

/** The per-system `{ system → kaval .drv }` map baked into this CLI's Nix
 *  wrapper (`KAVAL_AGENT_DRVS_JSON`), mirroring drishti's agent-drv map. The ssh
 *  path probes the host's nix-system and ships THAT system's derivation, so
 *  `--host` works cross-arch (an aarch64-darwin laptop provisioning an
 *  x86_64-linux box). Parsed once, eagerly, at the `--host` entry (so the
 *  static-config check never enters the session's reconnect path); a non-`--host`
 *  command never reaches this. */
function agentDrvBySystem(): Record<string, string> {
  const raw = process.env.KAVAL_AGENT_DRVS_JSON;
  if (raw === undefined || raw === "") {
    throw new Error(
      "KAVAL_AGENT_DRVS_JSON is not set — --host needs the per-system kaval derivations baked into the kaval-tui build. Run it from its Nix wrapper (e.g. `nix run .#kaval-tui`).",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `KAVAL_AGENT_DRVS_JSON is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Object.values(parsed).some((v) => typeof v !== "string")
  ) {
    throw new Error(
      "KAVAL_AGENT_DRVS_JSON must be a JSON object of { system: drvPath } strings.",
    );
  }
  return parsed as Record<string, string>;
}

/** Resolve the kaval daemon's `.drv` for `host` against an already-validated
 *  `{ system → drv }` map: probe the host's nix-system over ssh
 *  (`resolveSystem`), then look it up. This is the ONLY genuinely-per-host,
 *  genuinely-volatile step — and it's the only thing the deferred resolver
 *  thunk runs, so an unreachable host (or a lookup miss for the host's arch)
 *  folds into the session's reconnect machinery. The static-config axis
 *  (env-var present / valid JSON / right shape) is parsed eagerly by the caller
 *  via `agentDrvBySystem`, so a missing/malformed map never reaches the session
 *  to be misclassified as a retryable `"network"` fault. */
export async function resolveKavalAgentDrv(
  host: string,
  drvBySystem: Record<string, string>,
): Promise<string> {
  const system = await resolveSystem(host);
  const drv = drvBySystem[system];
  if (drv === undefined) {
    const known = Object.keys(drvBySystem).join(", ") || "none";
    throw new Error(
      `${host}: no kaval derivation baked for system=${system} (have: ${known}).`,
    );
  }
  return drv;
}

/** Dial a kaval on `host` over ssh. Provisions the daemon's closure, runs
 *  `kaval --stdio`, and returns the contract-typed `Connection`. */
export async function connectPtyHostViaHost(host: string): Promise<Connection> {
  // Parse + validate the baked drv map ONCE, eagerly — before any session
  // exists. A missing/malformed `KAVAL_AGENT_DRVS_JSON` is a terminal config
  // error (the user ran the raw entrypoint instead of the Nix wrapper), so it
  // must throw synchronously here (caught by `connectHost`'s fail-fast) rather
  // than inside the deferred resolver, where `HostSession` would misclassify it
  // as a retryable `"network"` fault and a long-lived consumer would spin on it
  // forever. Only the genuinely-per-host arch probe + lookup stays deferred.
  const drvBySystem = agentDrvBySystem();
  const session = getHostSession<typeof ptyHostSurface.contract>({
    host,
    binary: KAVAL_BINARY,
    resolveDrvPath: () => resolveKavalAgentDrv(host, drvBySystem),
  });
  // `pin()` runs the provision (`nix copy` → realise — which happens BEFORE the
  // connect watchdog arms, so a cold copy doesn't time it out) and spawns the
  // ssh child, resolving once the stdio link is live. Pin (not acquire) because
  // this is a process-lifetime hold released only by `dispose`.
  const client = await session.pin();
  // Roundtrip one cheap RPC and flip the session to `connected`: this disarms
  // the 30s connect watchdog that would otherwise SIGTERM the ssh child mid
  // `attach` (a command that runs far longer than 30s), and proves the link
  // works in both directions before any real command.
  await client.surface.system.heartbeat({});
  session.markConnected();
  return {
    client,
    dispose: () => session.destroy(),
  };
}
