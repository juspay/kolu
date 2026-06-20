/**
 * `dialAgentOnce<C>` — the one-shot CLI dial: provision a Nix-shipped surface
 * agent on a remote host over ssh and hand back a `{ client, dispose }` with the
 * link already proven live. This is the missing receptacle that sat one step
 * short of the socket every `--host` consumer needs: `getHostSession` owns the
 * HARD volatility (ssh/reconnect/provision), but each CLI was re-wiring the same
 * composition on top of it — env-var parse, arch-probe + drv lookup, and the
 * pin → probe → markConnected → leak-safe-destroy lifecycle. That composition is
 * a single primitive; it lives here, once.
 *
 * A CLI supplies only its genuinely-volatile values: the binary name, the
 * already-read drv-map JSON (the env-var NAME stays in the caller, since the
 * Nix-wrapper boundary spells it per-agent), a noun for the "no derivation
 * baked" error, and a one-line `probe` closure that roundtrips one cheap RPC
 * (`system.heartbeat`, the first frame of a `version` cell, …) so the dial can
 * prove the link before flipping the connect watchdog off.
 *
 * This is the *one-shot* shape: it fires `markConnected()` itself and discards
 * the `HostSession`, because a one-shot CLI needs no copying/connecting overlay
 * and never reads `onState`. A long-lived consumer that wants the session's
 * `onState`/`markConnected` seam composes its own variant carrying `session`
 * (as mini-ci's dialer does) — it does NOT reuse this `{ client, dispose }`.
 */

import type { AnyContractRouter } from "@orpc/contract";
import { resolveSystem } from "./arch";
import { type AgentClient, getHostSession } from "./hostSession";

/** Parse + validate a `{ system → drvPath }` map from an already-read env value.
 *  The env-var NAME is the caller's (the Nix-wrapper boundary spells it
 *  per-agent), so it's passed in only to render honest, actionable errors —
 *  never re-typed as a literal here. */
function parseDrvBySystem(
  envVar: string,
  raw: string | undefined,
): Record<string, string> {
  if (raw === undefined || raw === "") {
    throw new Error(
      `${envVar} is not set — --host needs the per-system agent derivations baked into the build. Run it from its Nix wrapper.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${envVar} is not valid JSON: ${(err as Error).message}`);
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
      `${envVar} must be a JSON object of { system: drvPath } strings.`,
    );
  }
  return parsed as Record<string, string>;
}

/** Resolve the agent's `.drv` for `host` against an already-validated
 *  `{ system → drv }` map: probe the host's nix-system over ssh
 *  (`resolveSystem`), then look it up. This is the ONLY genuinely-per-host,
 *  genuinely-volatile step — and it's the only thing the deferred resolver thunk
 *  runs, so an unreachable host (or a lookup miss for the host's arch) folds into
 *  the session's reconnect machinery. The static-config axis (env-var present /
 *  valid JSON / right shape) is parsed eagerly by `dialAgentOnce`, so a
 *  missing/malformed map never reaches the session to be misclassified as a
 *  retryable `"network"` fault. */
async function resolveAgentDrv(
  host: string,
  drvBySystem: Record<string, string>,
  drvNoun: string,
): Promise<string> {
  const system = await resolveSystem(host);
  const drv = drvBySystem[system];
  if (drv === undefined) {
    const known = Object.keys(drvBySystem).join(", ") || "none";
    throw new Error(
      `${host}: no ${drvNoun} derivation baked for system=${system} (have: ${known}).`,
    );
  }
  return drv;
}

/** A live one-shot agent connection: the client plus a `dispose` that tears the
 *  ssh session down. */
export interface AgentDial<C extends AnyContractRouter> {
  client: AgentClient<C>;
  dispose: () => void;
}

export interface DialAgentOnceOptions<C extends AnyContractRouter> {
  /** ssh target; `localhost` runs the realised binary directly. */
  host: string;
  /** Executable name inside the realised closure, run as `<binary> --stdio`. */
  binary: string;
  /** The env-var NAME the drv map is read from (e.g. `KAVAL_AGENT_DRVS_JSON`).
   *  Caller-owned because the Nix-wrapper boundary spells it per-agent — passed
   *  here only so the parse/validate errors name it. */
  envVar: string;
  /** The already-read env value (typically `process.env[envVar]`). The caller
   *  reads it so the env-var name is named exactly once on the TS side. */
  agentDrvsJson: string | undefined;
  /** Noun for the "no <noun> derivation baked for system=…" error (e.g.
   *  `kaval`, `arivu`). */
  drvNoun: string;
  /** Roundtrip one cheap RPC on `client` to prove the link before
   *  `markConnected` flips the connect watchdog off. Required and caller-supplied
   *  because surfaces differ: kaval has `system.heartbeat`, arivu reads the first
   *  frame of its `version` cell. The result is discarded; a rejection fails the
   *  dial (and destroys the session). */
  probe: (client: AgentClient<C>) => Promise<unknown>;
}

/** Dial an agent on `host` over ssh, one-shot. Provisions the daemon's closure,
 *  runs `<binary> --stdio`, proves the link with `probe`, and returns the
 *  contract-typed `{ client, dispose }`.
 *
 *  The baked drv map is parsed + validated ONCE, eagerly — before any session
 *  exists. A missing/malformed map is a terminal config error (the user ran the
 *  raw entrypoint instead of the Nix wrapper), so it throws synchronously here
 *  rather than inside the deferred resolver, where `HostSession` would
 *  misclassify it as a retryable `"network"` fault and a long-lived consumer
 *  would spin on it forever. Only the genuinely-per-host arch probe + lookup
 *  stays deferred (inside `resolveDrvPath`). */
export async function dialAgentOnce<C extends AnyContractRouter>(
  opts: DialAgentOnceOptions<C>,
): Promise<AgentDial<C>> {
  const drvBySystem = parseDrvBySystem(opts.envVar, opts.agentDrvsJson);
  const session = getHostSession<C>({
    host: opts.host,
    binary: opts.binary,
    resolveDrvPath: () => resolveAgentDrv(opts.host, drvBySystem, opts.drvNoun),
  });
  // Until a `Connection` (whose `dispose` owns teardown) is handed back, a
  // failure anywhere in pin/probe must destroy the session itself — otherwise
  // its ref-counted reconnect loop/watchdog timer leaks for any caller that
  // catches the rejection (the CLI exits, but this dialer is also used by tests).
  try {
    // `pin()` runs the provision (`nix copy` → realise — which happens BEFORE
    // the connect watchdog arms, so a cold copy doesn't time it out) and spawns
    // the ssh child, resolving once the stdio link is live. Pin (not acquire)
    // because this is a process-lifetime hold released only by `dispose`.
    const client = await session.pin();
    // Roundtrip one cheap RPC and flip the session to `connected`: this disarms
    // the connect watchdog that would otherwise SIGTERM the ssh child mid a
    // long-running command, and proves the link works in both directions before
    // any real command.
    await opts.probe(client);
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
