/**
 * `arivu-tui --host <ssh>` — reach an `arivu` daemon on a remote machine over
 * ssh, provisioning it with Nix, and hand back a `Connection` of the SAME shape
 * the local unix-socket path returns. Every `cmd*()` (list/watch) is written
 * against `Connection`, so the transport is the only thing that changes — the
 * commands are byte-for-byte unchanged over ssh. This is the one-level-up clone
 * of `kaval-tui/src/hostConnect.ts`.
 *
 * The whole reach + provision + supervise machinery is `@kolu/surface-nix-host`'s
 * `getHostSession`: it resolves the daemon's `.drv` for the host's arch, ships
 * it (`nix copy --derivation` → realise), runs `ssh <host> arivu --stdio`, and
 * speaks `arivuSurface` over that child's stdio. arivu's `--stdio` mode (built
 * in P1c) is the serve seam the ssh dial speaks to — the remote arivu dials the
 * remote kaval locally and recomputes awareness from now. Unlike kaval, arivu is
 * ephemeral, so a re-provision just re-derives; nothing survives the link.
 *
 * This is the thin arivu-tui-side, CLI-local composition of `getHostSession`: a
 * one-shot dialer that fires `markConnected()` itself and discards the
 * `HostSession`, because a one-shot CLI needs no copying/connecting overlay and
 * never reads `onState`. A long-lived consumer (the kolu fold, remote-terminals
 * R-2) does NOT reuse this exact `Connection` — it composes its own variant
 * carrying `session`/`onState`.
 *
 * This is the ONLY place arivu-tui imports `@kolu/surface-nix-host` — it must
 * never leak into the arivu daemon closure (the staleKey allow-list). The dep is
 * consumed read-only and unchanged, so it needs no drishti mirror PR.
 */
import type { arivuSurface } from "@kolu/arivu-contract";
import { getHostSession, resolveSystem } from "@kolu/surface-nix-host";
import type { Connection } from "./connect.ts";
import { firstValue } from "./read.ts";

/** The executable name inside the realised closure — `${agentPath}/bin/arivu`,
 *  run as `arivu --stdio`. Matches the arivu derivation's `meta.mainProgram`. */
const ARIVU_BINARY = "arivu";

/** The per-system `{ system → arivu .drv }` map baked into this CLI's Nix
 *  wrapper (`ARIVU_AGENT_DRVS_JSON`), keyed to the arivu DAEMON drv (it carries
 *  the sensors + git/gh), not the arivu-tui viewer drv. The ssh path probes the
 *  host's nix-system and ships THAT system's derivation, so `--host` works
 *  cross-arch (an aarch64-darwin laptop provisioning an x86_64-linux box).
 *  Parsed once, eagerly, at the `--host` entry (so the static-config check never
 *  enters the session's reconnect path); a non-`--host` command never reaches
 *  this. */
function agentDrvBySystem(): Record<string, string> {
  const raw = process.env.ARIVU_AGENT_DRVS_JSON;
  if (raw === undefined || raw === "") {
    throw new Error(
      "ARIVU_AGENT_DRVS_JSON is not set — --host needs the per-system arivu derivations baked into the arivu-tui build. Run it from its Nix wrapper (e.g. `nix run .#arivu-tui`).",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `ARIVU_AGENT_DRVS_JSON is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    // An array is an `object` whose values can all be strings, so it would slip
    // past the shape check and only surface later as a host-system map miss
    // (after the ssh probe). Reject it here, eagerly, with the same config error.
    Array.isArray(parsed) ||
    Object.values(parsed).some((v) => typeof v !== "string")
  ) {
    throw new Error(
      "ARIVU_AGENT_DRVS_JSON must be a JSON object of { system: drvPath } strings.",
    );
  }
  return parsed as Record<string, string>;
}

/** Resolve the arivu daemon's `.drv` for `host` against an already-validated
 *  `{ system → drv }` map: probe the host's nix-system over ssh
 *  (`resolveSystem`), then look it up. This is the ONLY genuinely-per-host,
 *  genuinely-volatile step — and it's the only thing the deferred resolver
 *  thunk runs, so an unreachable host (or a lookup miss for the host's arch)
 *  folds into the session's reconnect machinery. The static-config axis
 *  (env-var present / valid JSON / right shape) is parsed eagerly by the caller
 *  via `agentDrvBySystem`, so a missing/malformed map never reaches the session
 *  to be misclassified as a retryable `"network"` fault. */
export async function resolveArivuAgentDrv(
  host: string,
  drvBySystem: Record<string, string>,
): Promise<string> {
  const system = await resolveSystem(host);
  const drv = drvBySystem[system];
  if (drv === undefined) {
    const known = Object.keys(drvBySystem).join(", ") || "none";
    throw new Error(
      `${host}: no arivu derivation baked for system=${system} (have: ${known}).`,
    );
  }
  return drv;
}

/** Dial an arivu on `host` over ssh. Provisions the daemon's closure, runs
 *  `arivu --stdio`, and returns the contract-typed `Connection`. */
export async function connectArivuViaHost(host: string): Promise<Connection> {
  // Parse + validate the baked drv map ONCE, eagerly — before any session
  // exists. A missing/malformed `ARIVU_AGENT_DRVS_JSON` is a terminal config
  // error (the user ran the raw entrypoint instead of the Nix wrapper), so it
  // must throw synchronously here (caught by `connectHost`'s fail-fast) rather
  // than inside the deferred resolver, where `HostSession` would misclassify it
  // as a retryable `"network"` fault and a long-lived consumer would spin on it
  // forever. Only the genuinely-per-host arch probe + lookup stays deferred.
  const drvBySystem = agentDrvBySystem();
  const session = getHostSession<typeof arivuSurface.contract>({
    host,
    binary: ARIVU_BINARY,
    resolveDrvPath: () => resolveArivuAgentDrv(host, drvBySystem),
  });
  // Until a `Connection` (whose `dispose` owns teardown) is handed back, a
  // failure anywhere in pin/probe must destroy the session itself — otherwise
  // its ref-counted reconnect loop/watchdog timer leaks for any caller that
  // catches the rejection (the CLI exits, but the exported dialer is also used
  // by tests and a future long-lived consumer).
  try {
    // `pin()` runs the provision (`nix copy` → realise — which happens BEFORE
    // the connect watchdog arms, so a cold copy doesn't time it out) and spawns
    // the ssh child, resolving once the stdio link is live. Pin (not acquire)
    // because this is a process-lifetime hold released only by `dispose`.
    const client = await session.pin();
    // Roundtrip one cheap RPC and flip the session to `connected`: this disarms
    // the connect watchdog that would otherwise SIGTERM the ssh child mid
    // `watch` (a command that runs far longer), and proves the link works in
    // both directions before any real command. arivu has no `system.heartbeat`
    // (its surface is the `awareness` collection + a `version` cell), so the
    // first frame of the `version` cell is the probe — which doubles as
    // exercising the seam the kolu fold's version-skew gate later consumes.
    await firstValue(await client.surface.version.get({}));
    session.markConnected();
    return {
      client,
      dispose: () => session.destroy(),
    };
  } catch (err) {
    session.destroy();
    throw err;
  }
}
