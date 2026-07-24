/**
 * `dialAgentOnce<C>` — the one-shot CLI dial: provision a Nix-shipped surface
 * agent on a remote host over ssh and hand back a `{ client, dispose }` with the
 * link already proven live. This is the missing receptacle that sat one step
 * short of the socket every `--host` consumer needs: `HostSession` owns the
 * HARD volatility (ssh/reconnect/provision), but each CLI was re-wiring the same
 * composition on top of it — source-ref validation, target derivation resolution, and the
 * pin → probe → markConnected → leak-safe-destroy lifecycle. That composition is
 * a single primitive; it lives here, once.
 *
 * A CLI supplies only its genuinely-volatile values: the binary name and
 * protocol policy. Surface Remote reads the source flake baked by the Nix
 * wrapper at its own boundary. Proving the link is the framework's job, not the
 * CLI's: the dial
 * defaults to the reserved `system.live` round-trip (`probeSurfaceLive`) — the
 * same receptacle HostSession's periodic watchdog plugs into — so no CLI
 * nominates its own liveness verb. A CLI overrides `probe` only for a protocol
 * assertion that goes beyond liveness (padi-tui's padiSurface contract-version gate).
 *
 * This is the *one-shot* shape: it fires `markConnected()` itself and discards
 * the `HostSession`, because a one-shot CLI needs no copying/connecting overlay
 * and never reads `onState`. A long-lived consumer that wants the session's
 * `onState`/`markConnected` seam composes its own variant carrying `session`
 * (as mini-ci's dialer does) — it does NOT reuse this `{ client, dispose }`.
 */

import type { Logger } from "@kolu/log";
import { probeSurfaceLive } from "@kolu/surface/liveness";
import type { AnyContractRouter } from "@orpc/contract";
import { readBakedAgentSource, resolveAgentDrv } from "./agentDrv";
import { makeSession } from "./session";
import { type AgentClient, sshConnector, type SshProv } from "./sshConnector";

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
  /** The EXACT stderr prefix the remote agent writes before its fatal message,
   *  right before exiting (e.g. the retired pulam's `pulam:`, or `kaval --stdio:`). Required and
   *  caller-supplied because it is NOT always `${binary}:` — kaval's `--stdio`
   *  front writes `kaval --stdio:`, not `kaval:`. The agent's fatal is the LAST
   *  thing it writes, so `dialAgentOnce` surfaces everything from the last line
   *  carrying this prefix through the end of the remote stderr as the dial's
   *  failure reason — capturing a multi-line block (e.g. the retired pulam's "more than one
   *  kaval" error listing each `--kaval <socket>` candidate), not just the
   *  prefixed first line. */
  fatalPrefix: string;
  /** Roundtrip one cheap RPC on `client` to prove the link before
   *  `markConnected` flips the connect watchdog off. Optional — it DEFAULTS to the
   *  framework-reserved `system.live` round-trip (`probeSurfaceLive`), the same
   *  receptacle HostSession's periodic watchdog plugs into, so every
   *  `defineSurface` agent is provable without nominating an app verb. Override
   *  ONLY for a genuine protocol assertion that goes BEYOND liveness — padi-tui
   *  gates the padiSurface contract version, which is a contract check,
   *  not merely "is the link alive". The result is discarded; a rejection fails
   *  the dial (and destroys the session). */
  probe?: (client: AgentClient<C>) => Promise<unknown>;
  /** Extra args appended after `--stdio` on the remote agent command. Omit to let
   *  the agent's own default apply. The same generic spawn-arg carrier as
   *  `HostSessionOptions.extraArgs` / `buildAgentCommand` — what the args mean is
   *  the caller's concern (see the remote padi binding's `--state-root` call site). */
  extraArgs?: readonly string[];
  /** The COMPLETE env for a localhost dial's direct `spawn` — REQUIRED (threaded to
   *  `sshConnector` → `buildAgentCommand`). A localhost agent runs with EXACTLY this
   *  env, never the caller's ambient `process.env`, so identity vars can't ride an
   *  ambient inherit into a locally-hosted agent (#1872 / PR1.5). Unused on a real
   *  remote (the ssh client inherits). The caller composes a clean env — kolu CLIs via
   *  kolu-pty's `composeSpawnEnv`; surface-remote stays policy-free. */
  localEnv: Record<string, string>;
  /** Structured diagnostic logger, forwarded to `MakeSessionOptions.log`. Omit
   *  and the session writes its `nix copy` progress / connection transitions /
   *  forwarded remote stderr to `process.stderr` (what a plain CLI wants). An
   *  alt-screen consumer (an OpenTUI board) passes its own logger so these
   *  never corrupt the rendered screen — the lines stay in the session state
   *  for failure reads. */
  log?: Logger;
}

/** Dial an agent on `host` over ssh, one-shot. Provisions the daemon's closure,
 *  runs `<binary> --stdio`, proves the link with `probe`, and returns the
 *  contract-typed `{ client, dispose }`.
 *
 *  The baked source ref is validated ONCE, eagerly — before any session exists.
 *  A missing ref is a terminal config error (the user ran the
 *  raw entrypoint instead of the Nix wrapper), so it throws synchronously here
 *  rather than inside the deferred resolver, where `HostSession` would
 *  misclassify it as a retryable `"network"` fault and a long-lived consumer
 *  would spin on it forever. The genuinely-per-host arch probe and one-package
 *  Nix evaluation stay deferred inside `resolveDrvPath`. */
export async function dialAgentOnce<C extends AnyContractRouter>(
  opts: DialAgentOnceOptions<C>,
): Promise<AgentDial<C>> {
  const flakeRef = readBakedAgentSource();
  // A fresh `makeSession` per dial (no shared pool — the pool is deleted, S10). A
  // one-shot dial is independent by contract: its `dispose()` calls
  // `session.destroy()`, and each dial gets its own connector (source resolver)
  // and its own teardown, so two concurrent dials never share a session where
  // either `dispose()` kills the other's link.
  const session = makeSession<AgentClient<C>, SshProv>({
    connectOnce: sshConnector<C>({
      host: opts.host,
      binary: opts.binary,
      extraArgs: opts.extraArgs,
      localEnv: opts.localEnv,
      resolveDrvPath: (ctx) =>
        resolveAgentDrv(opts.host, flakeRef, opts.binary, {
          signal: ctx.signal,
          onProgress: ctx.localProgress,
          budget: ctx.budget,
        }),
    }),
    // The ssh connector PROVISIONS — it nix-copies the agent closure to the remote
    // before the transport is up — so this session opens at "probing" (the arch probe +
    // warm check), advancing to "provisioning" only when a real cold provision runs.
    initialConnection: "probing",
    log: opts.log,
    // Preserve the pre-S9 `[host:<host> …]` diagnostic prefix byte-for-byte (the tag
    // every `HostSession` line carried), so an alt-screen consumer's log filtering
    // and the failure-read tail are unchanged.
    label: `host:${opts.host}`,
  });
  // The agent's OWN fatal reason, read off the session AFTER a failed dial. When
  // the agent exits before serving — a bad `--kaval` pick, a startup crash — the
  // `probe` below rejects with the transport's opaque "stream closed" error, but
  // the agent's last stderr (the REMOTE-origin lines of the session's `log` —
  // `log` entries with `source === "remote"`) is the real reason. The agent writes
  // its fatal as `<fatalPrefix> <message>` to its own stderr right before exiting
  // (see padi's / kaval's bin.ts), forwarded onto those remote-origin `log` lines,
  // already separated (by the `source` field) from the session's OWN local
  // lifecycle chatter ("agent exited", "reconnecting in 2000ms…"). Reading them BY
  // ORIGIN (`source === "remote"`) rather than re-parsing an in-band tag keeps the
  // only shared convention here the agent's own `<fatalPrefix>` fatal shape
  // (caller-supplied — it is NOT always `${binary}:`; kaval's `--stdio` front
  // writes `kaval --stdio:`).
  //
  // The fatal is the LAST thing the agent writes, so it is the TAIL of the
  // remote-origin lines (never evicted by the `MAX_PROGRESS_LINES` cap, which drops
  // the oldest) — captured FROM the last prefixed line THROUGH the end, not just
  // that one line. The retired pulam's ambiguity error was multi-line (the "more than one kaval"
  // header plus each `--kaval <socket>` candidate the user needs to recover):
  // `forEachLine` splits it into separate remote `log` entries where only the first
  // carries the prefix, so matching a single prefixed line would drop the
  // candidates. We read the WHOLE current tail once, on the catch path, off the
  // session's freshest frame (`currentState()`) — no `onState` accumulator (a cached
  // partial block could otherwise short-circuit a later full read under stderr
  // fragmentation).
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
  // failure anywhere in pin/probe must destroy the session itself. The session's
  // timers no longer pin the process (they are unref'd — docs/atlas
  // session-timer-unref), but an undestroyed session in a HELD process (tests,
  // a server embedding this dialer) would keep redialing/spawning ssh children
  // for as long as that process lives — the leak this destroy still prevents.
  try {
    // `pin()` runs the provision (`nix copy` → realise — which happens BEFORE
    // the connect watchdog arms, so a cold copy doesn't time it out) and spawns
    // the ssh child, resolving once the stdio link is live. Pin (not acquire)
    // because this is a process-lifetime hold released only by `dispose`.
    const client = await session.pin();
    // Roundtrip one cheap RPC and flip the session to `connected`: this disarms
    // the connect watchdog that would otherwise SIGTERM the ssh child mid a
    // long-running command, and proves the link works in both directions before
    // any real command. Default to the framework-reserved `system.live` probe —
    // the receptacle HostSession's periodic watchdog also plugs into — so a CLI
    // need not nominate its own liveness verb; only a deliberate protocol
    // assertion (padi-tui's contract-version gate) overrides it.
    const probe = opts.probe ?? probeSurfaceLive;
    await probe(client);
    session.markConnected();
    return {
      client,
      dispose: () => {
        session.destroy();
      },
    };
  } catch (err) {
    // The probe's stream-closed rejection can win the race with the child's
    // `exit` event, so yield once to let that handler land the agent's stderr on
    // the session state before we read the whole current tail.
    await new Promise((resolve) => setImmediate(resolve));
    const reason = agentFatal(
      session
        .currentState()
        .log.filter((e) => e.source === "remote")
        .map((e) => e.line),
    );
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
