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

import { buildSurfaceFace, type SurfaceFace } from "@kolu/surface/client";
import type { Surface, SurfaceSpec } from "@kolu/surface/define";
import { stdioLink } from "@kolu/surface/links/stdio";
import {
  awaitStdioReadiness,
  isStdioReadinessError,
} from "@kolu/surface/links/readiness";
import {
  buildAgentCommand,
  forEachLine,
  isLocalHost,
  ResolveDrvError,
} from "./host";
import { DEFAULT_SSH_KEEPALIVE, type SshKeepalive } from "./keepalive";
import type { ResolveSystemOptions } from "./arch";
import { resolveAgentDrv, type AgentResolutionContext } from "./agentDrv";
import type { AgentDerivation } from "./agentDerivation";
import { makeProvisionBudgets, provisionAgent } from "./nixCopy";
import { spawnOwnedProcessGroup } from "./processGroup";
import {
  type ClosedInfo,
  classifyClosed,
  ConnectError,
  type Connection,
  type Connector,
  surfaceLiveProbe,
} from "./session";

/** What an ssh agent's dial yields: the surface FACE —
 *  `client.surface.<member>.<verb>` — re-nested over the stdio link's erased
 *  dispatch by `buildSurfaceFace`.
 *
 *  NON-generic now, and deliberately STRUCTURAL (PLAN D2): the wire namespace is
 *  flat, and per-member precision lives in the spec-derived bound faces a consumer
 *  builds ON TOP of this one, never in a second precise mapped type over the same
 *  spec. It is the same value `probeSurfaceLive` / `probeSurfaceIdentity` /
 *  `measureSurfaceClockOffset` / `mirrorRemoteSurface` already walk structurally,
 *  so nothing in the session or the mirror changed shape. */
export type AgentClient = SurfaceFace;

/** The ssh connector's OWN provisioning-phase vocabulary — the `Prov` a
 *  `makeSession` over {@link sshConnector} carries. Each phase names what is
 *  ACTUALLY happening at the real command boundaries `nixCopy.ts` runs:
 *   - `"probing"`  — the OPENING phase: the ssh architecture probe and ASK-ONLY
 *                     target warm check. No potentially minutes-long Nix operation
 *                     runs here.
 *   - `"provisioning"` — an uncached exact-source evaluation and/or the cold target
 *                        `nix build`, plus every required GC-root commit. A warm
 *                        target still crosses this phase before its root refresh,
 *                        because a GC race can turn that commit into a restoration.
 *  A session opens at `"probing"` and advances once to `"provisioning"` before
 *  the first potentially long Nix operation or mandatory root commit. */
export type SshProv = "probing" | "provisioning";

/**
 * How long a freshly-spawned `--stdio` agent has to announce readiness before
 * the dial gives up on it (juspay/kolu#2101).
 *
 * **This is a BUDGET, and it has a terminal verdict** — the review's definition
 * of done for any new wait. Expiry raises a `"remote"` `ConnectError`, which
 * counts toward the session's bounded remote budget (five consecutive remote
 * failures — an interleaved `"network"` failure means the host went away and
 * starts the count over), so a host that is UP yet never greets reaches `failed`
 * in five attempts. There is no path here that waits forever and none that
 * silently degrades to "assume ready".
 *
 * **The number is derived from OUR ceilings, not from Effect's ping cadence** —
 * which is the whole point of gating *before* the protocol layer exists, and why
 * this needs no `BETA-ASSUMPTION` marker. A daemon-owning front (`padi --stdio`,
 * `kaval --stdio`) does its full convergence BEFORE it greets, so the worst
 * honest case is the sum of that convergence's own bounds:
 *
 *   - `REAP_TERM_CEILING_MS` 120_000 + `REAP_KILL_CEILING_MS` 5_000 = 125_000ms
 *     — a cross-epoch TAKEOVER: SIGTERM, wait, SIGKILL, wait.
 *   -  30_000ms — the endpoint's `socketReadyMs`: the replacement daemon binding
 *     its socket.
 *   -   8_000ms — `UNSPEAKABLE_SILENCE_MS`: the probe's silence deadline, the
 *     longest a single classification pass can take before it decides.
 *   -  10_000ms — `frontDaemonOverStdio`'s `DEFAULT_DAEMON_WAIT_MS`: the front
 *     polling for the daemon's socket after it spawns one.
 *
 * = 173_000ms worst case, rounded up to 180_000 for the ssh round-trips and
 * process-start latency that sit between them. Anything slower than three
 * minutes is not a slow takeover, it is a host that is not going to converge —
 * and saying so terminally beats an eternal spinner.
 */
const AGENT_READINESS_DEADLINE_MS = 180_000;

/** The owning dial context a deferred derivation resolver may consume.
 *
 *  It EXTENDS {@link ResolveSystemOptions}, so the documented
 *  `resolveSystem(host, ctx)` idiom actually compiles — which is what makes
 *  forwarding the whole context the path of least resistance rather than a
 *  suggestion a consumer has to hand-assemble around. Hand-building
 *  `{ signal, onProgress }` instead silently opens the arch probe's
 *  `ControlMaster` under the DEFAULT policy while the rest of the dial asks for
 *  another (see `ResolveSystemOptions.keepalive`). */
export interface ResolveDrvPathContext
  extends AgentResolutionContext,
    ResolveSystemOptions {
  signal: AbortSignal;
  /** The progress sink, under this context's own long-standing name. Identical
   *  to the inherited `onProgress` — one sink, two spellings, because
   *  `localProgress` is what every existing resolver destructures and
   *  `onProgress` is the name the option types downstream of it use. */
  localProgress: (line: string) => void;
  /** This dial's ssh dead-peer policy — REQUIRED here (it is optional on
   *  {@link ResolveSystemOptions}, which has out-of-tree callers). Carried so
   *  the documented `resolveSystem(host, ctx)` idiom threads it STRUCTURALLY: a
   *  resolver that forwards the whole context gets the connector's policy on its
   *  arch probe for free, and cannot accidentally open the host's shared
   *  `ControlMaster` under a different one. */
  keepalive: SshKeepalive;
}

export interface SshConnectorOptions<S extends SurfaceSpec> {
  /** The surface the remote agent SERVES. Required, and a VALUE rather than the
   *  old type parameter: Effect RPC builds its client from the surface's flat
   *  `RpcGroup` (`surface.group`), and the face is re-nested from `surface.spec`
   *  at `surface.tagPrefix` — neither is recoverable from a type alone. It is also
   *  what keeps the dialled face and the served group provably the same tag set. */
  surface: Surface<S>;
  /** ssh target; `localhost` runs the realised binary directly. */
  host: string;
  /** Executable name inside the realised closure — the full spawn path is
   *  `${agentPath}/bin/${binary}`, run as `<binary> --stdio`. */
  binary: string;
  /** Resolve the agent derivation for this host. Called at the top of EVERY dial (not
   *  once up front), so the round-trip that picks the derivation — typically an ssh
   *  `nix-instantiate` arch probe via `resolveSystem` — lives inside the session's
   *  own reconnect machinery. An unreachable host makes the resolver reject, which
   *  the loop treats as a `"network"` fault (retry forever). To mark a resolver
   *  rejection as a NON-transport, bounded → terminal fault (the host probed fine but
   *  no derivation is baked for its system), reject with a {@link ResolveDrvError}
   *  carrying `failureCause: "remote"`.
   *
   *  Pass `directAgentDerivation(drvPath, binaryCache)` when the caller already
   *  owns the store path and has no probe to defer — obtain the cache with
   *  `readBakedBinaryCache(source)` wherever a source is baked, so the
   *  declaration comes from the flake's own `nixConfig` instead of a hand-typed
   *  copy; `agentBinaryCache({…})` states one inline when there is no baked
   *  source. `resolveAgentDrv` constructs the nominal flake-backed arm (reading
   *  that same sidecar itself) so Nix owns evaluation through realisation. */
  resolveDrvPath: (ctx: ResolveDrvPathContext) => Promise<AgentDerivation>;
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
  /** How long ssh may get no answer from the peer before it declares the
   *  transport dead and exits non-zero — see {@link SshKeepalive}. Defaults to
   *  {@link DEFAULT_SSH_KEEPALIVE} (≈30s), the right answer for an interactive
   *  tool: a host that stopped answering must stop looking connected.
   *
   *  **What this buys, exactly: it bounds how long a DEAD or HALF-OPEN ssh
   *  transport takes to be NOTICED.** Without it, an ssh parked on a half-open
   *  socket waits for the OS TCP stack — effectively forever — and the dial
   *  wedges with no recovery. With it, that eternity becomes an
   *  `intervalS × countMax` failure the reconnect loop can retry. Raising it
   *  therefore buys tolerance of an unresponsive NETWORK and costs exactly the
   *  same window on a genuinely dead host. Built with
   *  `sshKeepalive(intervalS, countMax)`, the only producer, which throws on an
   *  out-of-range policy at the literal the consumer wrote — never at the first
   *  dial, and never clamped.
   *
   *  **What it does NOT buy — because it is only ONE of four independent bounds
   *  on how long a link may be silent, and it is the LOOSEST of them:**
   *
   *   1. **Effect RPC's own pinger, on a connected link — 5–10s, NOT a knob.**
   *      `RpcClient.makeProtocolSocket` pings every 5s and ends the socket the
   *      moment a tick finds the previous ping unanswered. No option exposes that
   *      cadence and no retry survives it. Canonical account: the docstring at
   *      `@kolu/surface`'s `links/wire.ts` (`neverReconnect`), measured by
   *      `links/stdioPingStall.test.ts`. This is the bound that actually ends a
   *      connected link, and nothing here can move it.
   *   2. **`makeSession`'s heartbeat — ≈25s at its defaults, tunable via
   *      `MakeSessionOptions.liveness`.** Per (1) it never gets a vote on a
   *      connected link: the lower deadline always wins. Tune it for its own
   *      reasons, not as a way to ride out a blip.
   *   3. **The provisioning progress-liveness budget —
   *      `PROVISION_STEP_SILENCE_BASE_MS` 120s, which GROUP-KILLS the child.**
   *      ssh keepalives are protocol-level traffic and produce no child stdout,
   *      so they do not reset it. A blip during a build is bounded by THIS, not
   *      by the policy here; raising the policy past 120s is inert for a build.
   *      (The budget doubles per expiry, `PROVISION_STEP_MAX_EXPIRIES` = 4.)
   *   4. **This option** — the ssh transport's own death, the backstop
   *      underneath all three.
   *
   *  So: do not read a raised policy as "this lane now survives a five-minute
   *  interruption". It does not. A connected link is gone in 5–10s and a silent
   *  build's child is killed at 120s. What a raised policy prevents is the
   *  opposite failure — a 30s dead-peer verdict tearing down a dial whose peer
   *  was merely slow to answer a probe — and an unbounded park on a transport
   *  that is genuinely gone.
   *
   *  Threaded into EVERY ssh the dial spawns (arch probe, cache prefetch, warm
   *  validity check, GC-root pin, closure ship, Nix's own remote-store ssh, and
   *  the agent command), and the shared `ControlMaster` socket is keyed by it, so
   *  a second policy to the same host opens its own master rather than silently
   *  inheriting this one's `ServerAlive*`. */
  keepalive?: SshKeepalive;
}

/** Build an ssh {@link Connector} for `(host, binary)`. Each `connectOnce` call
 *  resolves the drv (fail → classified `ConnectError`), provisions the closure,
 *  spawns the ssh child, and returns a {@link Connection} whose `closed` resolves on
 *  the child's exit/error and whose `isAlive` is the reserved `system.live` probe. */
export function sshConnector<S extends SurfaceSpec>(
  opts: SshConnectorOptions<S>,
): Connector<AgentClient, SshProv> {
  // The fused per-step progress-liveness budgets, owned HERE (the connector closure) so
  // their doubling + kill-budget persist across a campaign's retry-dials (#1908 C5). The
  // campaign reset is `budgets.onCampaign(ctx.campaignEpoch)` at the top of each dial
  // (below) — provisionAgent is campaign-ignorant; the connector is the only caller.
  const budgets = makeProvisionBudgets();
  // Resolved once, at construction: ONE value for the whole connector, so every
  // ssh a dial spawns provably carries the same policy (they share a
  // ControlMaster keyed by it — see `controlMaster.ts`). No validation here —
  // an `SshKeepalive` can only have come from `sshKeepalive()`, which threw at
  // the literal the consumer wrote.
  const keepalive = opts.keepalive ?? DEFAULT_SSH_KEEPALIVE;

  return async (ctx): Promise<Connection<AgentClient>> => {
    // Reconcile the per-campaign budget reset HERE — the session↔nixCopy bridge, where the
    // campaign generation is known — so `provisionAgent` stays campaign-ignorant. Monotonic
    // (`onCampaign` ignores an epoch `<= last`), so a stale/superseded dial can't roll a
    // newer campaign's budget back (#1908 F6).
    budgets.onCampaign(ctx.campaignEpoch);
    // Resolve the derivation first — where the arch probe (or any deferred per-host
    // drv lookup) runs. A host unreachable at probe time rejects here and is
    // classified `"network"` (retry forever) unless it is a `ResolveDrvError`
    // carrying an explicit cause (an unsupported/mis-baked system → `"remote"`,
    // bounded → terminal).
    let derivation: AgentDerivation;
    try {
      derivation = await opts.resolveDrvPath({
        signal: ctx.signal,
        localProgress: ctx.localProgress,
        // The same sink under the name `ResolveSystemOptions` uses, so
        // `resolveSystem(host, ctx)` compiles (see `ResolveDrvPathContext`).
        onProgress: ctx.localProgress,
        keepalive,
        resolveAgentDrv: (flakeRef, packageName) =>
          resolveAgentDrv(opts.host, flakeRef, packageName, {
            signal: ctx.signal,
            onProgress: ctx.localProgress,
            onEvaluation: () => ctx.provisioning("provisioning"),
            budget: budgets.evaluation,
            keepalive,
          }),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const cause =
        err instanceof ResolveDrvError
          ? err.resolution.failureCause
          : "network";
      const terminal =
        err instanceof ResolveDrvError ? err.resolution.terminal : false;
      throw new ConnectError(reason, cause, terminal);
    }

    const provision = await provisionAgent({
      host: opts.host,
      derivation,
      onProgress: (line) => ctx.localProgress(line),
      // Advance before this call's first potentially long required operation:
      // a cold build or a warm target's root repair.
      onProvisioning: () => ctx.provisioning("provisioning"),
      budgets,
      keepalive,
      // The per-dial abort — recheck's abort-in-flight group-kills any provisioning
      // child so the session can redial NOW instead of waiting out a wedge (#1908 R6b).
      signal: ctx.signal,
    });
    if (!provision.ok) {
      // `provisionAgent` classifies why: a `"remote"` rejection (e.g. `trusted-users`
      // won't accept the closure) is bounded → terminal; a `"network"` failure (the
      // host went unreachable mid-provision, after the probe succeeded) keeps retrying; a
      // budget-EXHAUSTED silent step is `terminal` → give up NOW (#1908 C5).
      throw new ConnectError(
        provision.reason,
        provision.cause,
        provision.terminal ?? false,
      );
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
      keepalive,
    });
    const transport = spawnOwnedProcessGroup(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      // `env` is the caller-composed localhost env, or `undefined` on the ssh arm
      // (inherit — the local ssh client needs `SSH_AUTH_SOCK` / `~/.ssh`). A localhost
      // spawn therefore NEVER inherits the caller's ambient env (#1872 / PR1.5).
      env,
    });
    const child = transport.child;

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
      // Tear the just-spawned child down before throwing — a bare `throw` here would
      // leak the ssh process with no owner (ironic in the #1908 lifetime-ownership
      // lane; the one-hop debt R10 names).
      transport.terminate();
      throw new Error("ssh subprocess has no stdin/stdout — unreachable");
    }
    // ── The epoch gate: read the agent's readiness banner BEFORE attaching ────
    //
    // juspay/kolu#2101. Everything below this point builds an `RpcClient`, and
    // building one starts Effect RPC's pinger. A remote daemon from a PREVIOUS
    // protocol epoch accepts the splice and then says nothing — it is waiting
    // for a greeting in a protocol we no longer speak — so the pinger kills the
    // link ~10s later on its unanswered keep-alive (the mechanism is argued in
    // `duplexWireLink`'s `keepAliveWentUnanswered`), the session classifies that
    // as `"network"`, and `"network"` retries forever. That is the incident:
    // every remote host wedged in a permanent loop, with a log line
    // indistinguishable from an unreachable box.
    //
    // A CLEARER MESSAGE DOES NOT SHORTEN THIS LOOP — a previous-epoch peer is
    // silent forever, so the retry is just as permanent however honestly the
    // death is named. The gate below is what stops it.
    //
    // So the banner is read FIRST, and the proof it mints is the only way to
    // construct the link at all (see `@kolu/surface/links/readiness`).
    //
    // Raced against the child's own death, because both are real outcomes and
    // the wait must not outlive the process it is waiting on: a genuinely-down
    // host fails at ssh spawn / exit 255 BEFORE any banner, and that arm keeps
    // its existing `closed` classification untouched (`"network"`, retry
    // forever) — nothing changes for a host that is merely off.
    const readiness = await Promise.race([
      awaitStdioReadiness({
        read: child.stdout,
        deadlineMs: AGENT_READINESS_DEADLINE_MS,
        describe: `${opts.binary} on ${opts.host}`,
      }),
      closed.then((info): never => {
        // The child left before greeting. Classify it with the LOOP'S OWN
        // authority (`classifyClosed`), never a verdict invented here: a child
        // that exits before it greets is the same fact as a child that exits
        // before its first RPC — bounded `"remote"` — while an ssh transport
        // failure stays the unbounded `"network"` a merely-unreachable host has
        // always been. Restating that rule here is how the gate would quietly
        // un-bound a broken agent or condemn a sleeping laptop.
        const { reason, cause } = classifyClosed(info, false);
        throw new ConnectError(
          `${opts.binary} on ${opts.host} exited before it announced readiness — ${reason}`,
          cause,
        );
      }),
    ]).catch((err: unknown) => {
      // A gate REFUSAL / expiry / undecodable prelude is a REMOTE fault, not a
      // network one: the host answered, and what it said (or failed to say) is
      // about the daemon there, not the wire in between. `"remote"` is what
      // counts toward the session's BOUNDED remote budget (five consecutive
      // remote failures — an interleaved `"network"` failure means the host went
      // away and starts the count over), so a host that is UP yet keeps refusing
      // reaches a terminal `failed` in a bounded number of attempts through the
      // EXISTING budget — no new budget invented, and no retry-forever left
      // standing.
      // The app's typed anomaly rides along verbatim so the binder can render a
      // real verdict instead of string-parsing this message.
      transport.terminate();
      if (isStdioReadinessError(err)) {
        throw new ConnectError(err.message, "remote", false, err.anomaly);
      }
      throw err;
    });
    // The wire link is ASYNC now (building the protocol layer and its fibers is
    // an effect) and owns a `Scope` holding those fibers — so `teardown` must
    // dispose it, not just kill the child, or every dial leaks a protocol fiber.
    const link = await stdioLink({
      group: opts.surface.group,
      read: child.stdout,
      write: child.stdin,
      readiness,
    });
    const client = buildSurfaceFace(opts.surface, link.dispatch);

    return {
      client,
      // The link's own dispatch, handed back so a consumer can build a SECOND
      // sibling's face over the same wire without re-dialing (a two-sibling daemon
      // — padi's versioned surface plus the frozen control core — is one link with
      // two faces, and `client` is only the first).
      dispatch: link.dispatch,
      closed,
      // The framework-reserved `system.live` round-trip — contract-agnostic, so no
      // consumer probe is needed. A rejection still counts as alive (the round-trip
      // completed); only a true non-answer (the loop's watchdog timeout) cycles.
      isAlive: surfaceLiveProbe(client),
      teardown: () => {
        // Release the link's scope FIRST (its protocol fibers, its response
        // handlers), then kill the child. `dispose` is async and idempotent; a
        // teardown fault must not replace the reason the caller is tearing down,
        // so it is swallowed the same way the kill already is.
        void link.dispose().catch(() => {
          /* best-effort — a link already disposed is fine */
        });
        transport.terminate();
      },
    };
  };
}
