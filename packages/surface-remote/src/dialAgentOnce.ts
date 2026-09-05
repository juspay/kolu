/**
 * `dialAgentOnce<C>` — the one-shot CLI dial: provision a Nix-shipped surface
 * agent on a remote host over ssh and hand back a `{ client, dispose }` with the
 * link already proven live. This is the missing receptacle that sat one step
 * short of the socket every `--host` consumer needs: `makeSession` plus
 * `sshConnector` own the HARD volatility (ssh/reconnect/provision), but each CLI
 * was re-wiring the same
 * composition on top of it — source-ref validation, target derivation resolution, and the
 * pin → probe → markConnected → leak-safe-destroy lifecycle. That composition is
 * a single primitive; it lives here, once.
 *
 * A CLI supplies only its genuinely-volatile values: the binary name and
 * protocol policy. Surface Remote reads the source flake baked by the Nix
 * wrapper at its own boundary. Proving the link is the framework's job, not the
 * CLI's: the dial
 * defaults to the reserved `system.live` round-trip (`probeSurfaceLive`) — the
 * same reserved probe the session's periodic watchdog uses — so no CLI
 * nominates its own liveness verb. A CLI overrides `probe` only for a protocol
 * assertion that goes beyond liveness (padi-tui's padiSurface contract-version gate).
 *
 * This is the *one-shot* shape: it fires `markConnected()` itself and discards
 * the session, because a one-shot CLI needs no provisioning/connecting overlay
 * and never reads `onState`. A long-lived consumer that wants the session's
 * `onState`/`markConnected` seam composes its own variant carrying `session`
 * (as mini-ci's dialer does) — it does NOT reuse this `{ client, dispose }`.
 */

import type { Logger } from "@kolu/log";
import type { Effect } from "effect";
import type { Surface, SurfaceSpec } from "@kolu/surface/define";
import type { SurfaceDispatch } from "@kolu/surface/link";
import { probeSurfaceLive } from "@kolu/surface/liveness";
import { readBakedAgentSource } from "./agentDrv";
import { makeSession, runProbe } from "./session";
import type { SshKeepalive } from "./keepalive";
import type { MakeSessionOptions } from "./session";
import { type AgentClient, sshConnector, type SshProv } from "./sshConnector";

/** A live one-shot agent connection: the surface FACE plus a `dispose` that tears
 *  the ssh session down. NON-generic — see {@link AgentClient}. */
export interface AgentDial {
  client: AgentClient;
  /** The link's tag-keyed dispatch behind {@link AgentDial.client} — the seam a
   *  consumer builds a SECOND sibling's face over. `client` is ONE face built from
   *  ONE surface; a daemon that serves sibling surfaces (padi's versioned surface
   *  beside the frozen control core) is one wire with two, and only the dispatch
   *  reaches the other.
   *
   *  OPTIONAL, mirroring {@link Connection.dispatch}: it is a property of the
   *  TRANSPORT, not of the dial. Every `sshConnector` dial supplies one, so a
   *  consumer that genuinely needs the second face should treat `undefined` as the
   *  loud error it is rather than degrading — this field exists so that consumer
   *  can be written at all, not so it can guess. */
  dispatch?: SurfaceDispatch;
  dispose: () => void;
}

export interface DialAgentOnceOptions<S extends SurfaceSpec> {
  /** The surface the remote agent serves — threaded to `sshConnector` to build
   *  the wire link's group and the face. Required, never inferred. */
  surface: Surface<S>;
  /** ssh target; `localhost` runs the realised binary directly. */
  host: string;
  /** Executable name inside the realised closure, run as `<binary> --stdio`. */
  binary: string;
  /** Flake attr to resolve and provision — the CLOSURE shipped to the host, as
   *  distinct from the `binary` exec'd inside it. **Required, never defaulted.**
   *
   *  They separate when a host must receive MORE than the daemon: kolu ships
   *  `padi-agent` (padi plus the client CLIs a terminal on that host needs) and
   *  still runs `padi`. `sshConnector` has always taken these as two parameters;
   *  this one-shot wrapper collapsed them into `binary`, so a CLI dial
   *  provisioned a different closure than the long-lived binder for the same
   *  host — the two-behaviours bug this field exists to remove. A default of
   *  `binary` would be that same expression, one keystroke away: every dial path
   *  to a given host must name the SAME attr, and stating it is how a caller is
   *  made to notice which one. */
  package: string;
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
   *  reserved probe the session's periodic watchdog plugs into, so every
   *  `defineSurface` agent is provable without nominating an app verb. Override
   *  ONLY for a genuine protocol assertion that goes BEYOND liveness — padi-tui
   *  gates the padiSurface contract version, which is a contract check,
   *  not merely "is the link alive". The result is discarded; a rejection fails
   *  the dial (and destroys the session). */
  probe?: (client: AgentClient) => Effect.Effect<unknown, unknown>;
  /** Extra args appended after `--stdio` on the remote agent command. Omit to let
   *  the agent's own default apply. The same generic spawn-arg carrier as
   *  `SshConnectorOptions.extraArgs` / `buildAgentCommand` — what the args mean is
   *  the caller's concern (see the remote padi binding's `--state-root` call site). */
  extraArgs?: readonly string[];
  /** The COMPLETE env for a localhost dial's direct `spawn` — REQUIRED (threaded to
   *  `sshConnector` → `buildAgentCommand`). A localhost agent runs with EXACTLY this
   *  env, never the caller's ambient `process.env`, so identity vars can't ride an
   *  ambient inherit into a locally-hosted agent (#1872 / PR1.5). Unused on a real
   *  remote (the ssh client inherits). The caller composes a clean env — kolu CLIs via
   *  kolu-pty's `composeSpawnEnv`; surface-remote stays policy-free. */
  localEnv: Record<string, string>;
  /** This dial's ssh dead-peer policy, forwarded verbatim to
   *  `SshConnectorOptions.keepalive` (see it for the full argument and the
   *  `ControlMaster` caveat). Defaults to `DEFAULT_SSH_KEEPALIVE` (≈30s).
   *
   *  It belongs on the one-shot facade too, and not only on `sshConnector`: this
   *  is the path every `--host` CLI takes (`kaval-tui`, `padi-tui`, `kolu-cli`)
   *  and the one an unattended runner reaches for, so leaving it off would pin
   *  exactly the consumer the option exists for to the interactive default with
   *  no recourse short of dropping a layer and composing `makeSession` by hand.
   *
   *  **The DIALLING half only — pair it with {@link liveness}.** This governs
   *  `probing`/`provisioning`; on a CONNECTED link the heartbeat watchdog is the
   *  faster judge and force-cycles at ≈25s by default, well before any raised
   *  ssh tolerance elapses (`keepaliveOrdering.test.ts` pins that). A dial that
   *  raises this for an unattended lane must raise `liveness` too, or the
   *  documented remedy is inert on the very facade that ships the option. */
  keepalive?: SshKeepalive;
  /** The CONNECTED half of the same question {@link keepalive} answers for the
   *  dialling phases — forwarded verbatim to `MakeSessionOptions.liveness`. Omit
   *  for the ≈25s default; `false` disables the watchdog entirely.
   *
   *  Exposed here for exactly the reason `keepalive` is: half a coupled pair
   *  crossing the facade would pin an unattended runner to a policy it cannot
   *  complete, with no recourse short of abandoning `dialAgentOnce` and
   *  re-deriving `initialConnection: "probing"` and the `host:<host>` label by
   *  hand. The heartbeat's own ceilings (`MAX_HEARTBEAT_INTERVAL_MS` 300s +
   *  `MAX_HEARTBEAT_TIMEOUT_MS` 120s) bound what is reachable here. */
  liveness?: MakeSessionOptions<AgentClient, SshProv>["liveness"];
  /** Structured diagnostic logger, forwarded to `MakeSessionOptions.log`. Omit
   *  and the session writes its provisioning progress / connection transitions /
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
 *  rather than inside the deferred resolver, where the session would
 *  misclassify it as a retryable `"network"` fault and a long-lived consumer
 *  would spin on it forever. The genuinely-per-host arch probe and one-package
 *  Nix evaluation stay deferred inside `resolveDrvPath`. */
export async function dialAgentOnce<S extends SurfaceSpec>(
  opts: DialAgentOnceOptions<S>,
): Promise<AgentDial> {
  const source = readBakedAgentSource();
  if (source.isErr()) throw source.error;
  const flakeRef = source.value;
  // A fresh `makeSession` per dial (no shared pool — the pool is deleted, S10). A
  // one-shot dial is independent by contract: its `dispose()` calls
  // `session.destroy()`, and each dial gets its own connector (source resolver)
  // and its own teardown, so two concurrent dials never share a session where
  // either `dispose()` kills the other's link.
  const session = makeSession<AgentClient, SshProv>({
    connectOnce: sshConnector<S>({
      surface: opts.surface,
      host: opts.host,
      binary: opts.binary,
      extraArgs: opts.extraArgs,
      localEnv: opts.localEnv,
      keepalive: opts.keepalive,
      resolveDrvPath: (ctx) => ctx.resolveAgentDrv(flakeRef, opts.package),
    }),
    // The ssh connector provisions before transport is up, so this session opens
    // at "probing" for the architecture check. It advances to "provisioning"
    // before an uncached source evaluation or cold target build/root transaction.
    initialConnection: "probing",
    // The CONNECTED half of the link-silence pair whose DIALLING half is
    // `keepalive` above. Forwarding only one of the two would make the raised
    // ssh tolerance provably inert on this facade (the watchdog force-cycles
    // first), with the documented remedy unreachable through it.
    liveness: opts.liveness,
    log: opts.log,
    // Preserve the pre-S9 `[host:<host> …]` diagnostic prefix byte-for-byte (the tag
    // every session line carried), so an alt-screen consumer's log filtering
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
    // `pin()` runs the provision (one Nix evaluation/transfer/realisation
    // operation followed by the required target-store root commit, BEFORE the
    // connect watchdog arms) and spawns
    // the ssh child, resolving once the stdio link is live. Pin (not acquire)
    // because this is a process-lifetime hold released only by `dispose`.
    const client = await session.pin();
    // Roundtrip one cheap RPC and flip the session to `connected`: this disarms
    // the connect watchdog that would otherwise SIGTERM the ssh child mid a
    // long-running command, and proves the link works in both directions before
    // any real command. Default to the framework-reserved `system.live` probe —
    // the session's periodic watchdog also plugs into — so a CLI
    // need not nominate its own liveness verb; only a deliberate protocol
    // assertion (padi-tui's contract-version gate) overrides it.
    // The override and the default are BOTH Effects, and the union is annotated
    // rather than inferred. That is load-bearing: an inferred
    // "Promise | Effect" union would make the `await` legal on both arms, and
    // awaiting a non-thenable Effect resolves to the Effect itself — the link
    // would never be probed and the dial would report success against a dead
    // agent. One shape means there is no such arm to get wrong.
    //
    // It crosses at `runProbe` — the session's own probe edge — so the package
    // has ONE place where a reserved probe becomes a Promise, not one per file.
    const probe: (c: AgentClient) => Effect.Effect<unknown, unknown> =
      opts.probe ?? probeSurfaceLive;
    await runProbe(probe(client));
    session.markConnected();
    return {
      client,
      // The live connection's dispatch, read at hand-back. `sshConnector` always
      // supplies one; a session standing in for the connector (a test's fake) may
      // not, which is why the field is optional rather than asserted here — see
      // {@link AgentDial.dispatch}.
      dispatch: session.currentDispatch?.(),
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
