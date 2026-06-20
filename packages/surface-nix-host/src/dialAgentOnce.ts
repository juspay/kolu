/**
 * `dialAgentOnce<C>` — the one-shot CLI dial: provision a Nix-shipped surface
 * agent on a remote host over ssh and hand back a `{ client, dispose }` with the
 * link already proven live. This is the missing receptacle that sat one step
 * short of the socket every `--host` consumer needs: `HostSession` owns the
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
import { type AgentClient, HostSession } from "./hostSession";

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
  /** The already-read env value. The caller reads it itself (rather than this
   *  helper doing `process.env[envVar]`) so the call site can hold the env-var
   *  name in a single constant — `envVar: NAME, agentDrvsJson: process.env[NAME]`
   *  — and TS sees one source for both, instead of a bare literal and a
   *  `process.env.FOO` property that could silently drift. */
  agentDrvsJson: string | undefined;
  /** Noun for the "no <noun> derivation baked for system=…" error (e.g.
   *  `kaval`, `arivu`). */
  drvNoun: string;
  /** The EXACT stderr prefix the remote agent writes before its fatal message,
   *  right before exiting (e.g. `arivu:`, `kaval --stdio:`). Required and
   *  caller-supplied because it is NOT always `${drvNoun}:` — kaval's `--stdio`
   *  front writes `kaval --stdio:`, not `kaval:`. The agent's fatal is the LAST
   *  thing it writes, so `dialAgentOnce` surfaces everything from the last line
   *  carrying this prefix through the end of the remote stderr as the dial's
   *  failure reason — capturing a multi-line block (e.g. arivu's "more than one
   *  kaval" error listing each `--kaval <socket>` candidate), not just the
   *  prefixed first line. */
  fatalPrefix: string;
  /** Roundtrip one cheap RPC on `client` to prove the link before
   *  `markConnected` flips the connect watchdog off. Required and caller-supplied
   *  because surfaces differ: kaval has `system.heartbeat`, arivu reads the first
   *  frame of its `version` cell. The result is discarded; a rejection fails the
   *  dial (and destroys the session). */
  probe: (client: AgentClient<C>) => Promise<unknown>;
  /** Extra args appended after `--stdio` on the remote agent command. Omit to let
   *  the agent's own default apply. The same generic spawn-arg carrier as
   *  `HostSessionOptions.extraArgs` / `buildAgentCommand` — what the args mean is
   *  the caller's concern (see the arivu-tui `--kaval` call site). */
  extraArgs?: readonly string[];
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
  // Unpooled — NOT `getHostSession`. The pool is keyed only by `(host, binary)`,
  // keeps a destroyed session in the map (no `isDestroyed` eviction), and lets
  // the FIRST caller's `opts` win. A one-shot dial is independent by contract:
  // its `dispose()` calls `session.destroy()`, so a second same-host/binary
  // dial in the same process would otherwise be handed back the prior dial's
  // destroyed session (stale resolver, no reconnect — `scheduleReconnect`
  // early-returns when `destroyed`), and two concurrent dials would share one
  // session where either `dispose()` kills the other's link. A fresh
  // `HostSession` per dial closes both holes: each gets its own resolver/drv
  // map and its own teardown.
  const session = new HostSession<C>({
    host: opts.host,
    binary: opts.binary,
    extraArgs: opts.extraArgs,
    resolveDrvPath: () => resolveAgentDrv(opts.host, drvBySystem, opts.drvNoun),
  });
  // The agent's OWN fatal reason, read off the session AFTER a failed dial. When
  // the agent exits before serving — a bad `--kaval` pick, a startup crash — the
  // `probe` below rejects with the transport's opaque "stream closed" error, but
  // the agent's last stderr (on the session's `remoteProgressLines`) is the real
  // reason. The agent writes its fatal as `<fatalPrefix> <message>` to its own
  // stderr right before exiting (see arivu's / kaval's bin.ts), forwarded onto
  // `remoteProgressLines` — the remote-origin lines, already separated from the
  // session's OWN local lifecycle chatter ("agent exited", "reconnecting in
  // 2000ms…"). Reading them BY ORIGIN (the field) rather than re-parsing the
  // session's internal `[remote] ` tag keeps the only shared convention here the
  // agent's own `<fatalPrefix>` fatal shape (caller-supplied — it is NOT always
  // `${drvNoun}:`; kaval's `--stdio` front writes `kaval --stdio:`).
  //
  // The fatal is the LAST thing the agent writes, so it is the TAIL of
  // `remoteProgressLines` (never evicted by the `MAX_PROGRESS_LINES` cap, which
  // drops the oldest) — captured FROM the last prefixed line THROUGH the end, not
  // just that one line. arivu's ambiguity error is multi-line (the "more than one
  // kaval" header plus each `--kaval <socket>` candidate the user needs to
  // recover): `forEachLine` splits it into separate `remoteProgressLines` entries
  // where only the first carries the prefix, so matching a single prefixed line
  // would drop the candidates. We read the WHOLE current tail once, on the catch
  // path — no `onState` accumulator (a cached partial block could otherwise
  // short-circuit a later full read under stderr fragmentation).
  const agentFatal = (remoteLines: readonly string[]): string | undefined => {
    const prefix = opts.fatalPrefix;
    // Walk back to the last line that opens the fatal block.
    let start = -1;
    for (let i = remoteLines.length - 1; i >= 0; i--) {
      if (remoteLines[i]?.startsWith(prefix)) {
        start = i;
        break;
      }
    }
    if (start === -1) return undefined;
    // Strip the prefix from the opening line; keep the continuation lines (the
    // candidate list, the `(e.g. …)` hint) verbatim — they are the block.
    const block = [
      remoteLines[start]?.slice(prefix.length).trimStart(),
      ...remoteLines.slice(start + 1),
    ].join("\n");
    return block.trim() || undefined;
  };
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
    // The probe's stream-closed rejection can win the race with the child's
    // `exit` event, so yield once to let that handler land the agent's stderr on
    // the session state before we read the whole current tail.
    await new Promise((resolve) => setImmediate(resolve));
    const reason = agentFatal(session.current().remoteProgressLines);
    // Best-effort teardown — a throw from `destroy()` (it kills the ssh child
    // and clears timers) must NOT replace the failure the caller needs to see.
    try {
      session.destroy();
    } catch {
      // teardown failed; the error below is the one that matters.
    }
    // Surface the agent's own reason ("more than one kaval …") over the
    // transport's opaque "[AsyncIdQueue] … closed" / the session's reconnect
    // chatter when the agent itself quit.
    if (reason) throw new Error(reason);
    throw err;
  }
}
