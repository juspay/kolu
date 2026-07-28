/**
 * kolu-server's REMOTE padi binder — the ssh arm of a bound padi (post-S9).
 *
 * The local binder ({@link ./padiBinding.ts}) spawns/adopts a padi PROCESS on THIS
 * host over a unix socket. The remote binder does the byte-identical thing one ssh
 * hop away: it fronts a padi on another machine, provisioning it with Nix, and
 * re-serves its `padiSurface` to browsers through the SAME `reServeSurface` seam. The
 * knob {@link KOLU_PADI_HOST_ENV} picks which arm runs — unset → local, set → the
 * whole canvas becomes the remote host.
 *
 * Post-S9 there is no `RemotePadiSession` class and no `HostSession`: the transport
 * is `makeSession({ connectOnce: sshConnector({ binary: "padi" }), admit: padiAdmit })`.
 * `sshConnector` owns ssh/provision/reconnect; the ONE padi-specific thing the ssh
 * arm adds — the control-core handshake + skew/build convergence + drain enactment — is
 * the post-connect `admit` hook. The daemon supervision members (`convergence` · `renew`
 * · `preservation`) are added to the base session by spread ({@link asPadiSession}).
 *
 * ── The ssh-user 0700 caveat (carried over from the kaval-sessions era) ──
 * The remote padi runs AS THE SSH USER: `ssh <host> padi --stdio` executes under
 * whatever account the ssh identity authenticates as, and padi serves its socket in a
 * `0700` owner-only runtime dir keyed by a digest of ITS state-root — so the SSH
 * identity IS the daemon owner. Pick your ssh user deliberately — it decides who owns
 * the host's terminals.
 */

import { currentPadiBuildId } from "@kolu/padi/assembly";
import {
  type PadiDaemonClient,
  type PadiSurfaceClient,
  scopePadiSurface,
} from "@kolu/padi/dial";
import {
  PADI_SURFACE_VERSION,
  type PadiDaemonContract,
} from "@kolu/padi/surface";
import {
  convergeAdmit,
  createDrainBudget,
  daemonBuild,
  instanceKeyFromStartedAt,
} from "@kolu/surface-daemon-supervisor";
import {
  type Admit,
  type AdmitVerdict,
  type Connector,
  makeSession,
  ResolveDrvError,
  resolveBakedAgentDrv,
  type Session,
  type SshConnectorOptions,
  sshConnector,
  type SshProv,
} from "@kolu/surface-remote";
import { composeSpawnEnv } from "kolu-pty";
import { encodeHostKey, parseHostInput } from "kolu-common/hostKey";
import type { PadiConvergence } from "kolu-common/surface";
import {
  type EntryFailedCause,
  type HostKey,
  LOCAL_HOST,
} from "kolu-common/surfacesWithPadi";
import { log } from "../log.ts";
// padi's convergence policy — ONE declaration for BOTH arms. The remote arm enacts
// via `convergeAdmit` (same decision table + budget as the local `converge(endpoint)`).
import {
  drainAndAwaitExit,
  drainRejectionSuffix,
  padiConvergencePolicy,
} from "./padiConvergence.ts";
import {
  asPadiSession,
  type PadiEntryFailedDetail,
  type PadiSession,
} from "./padiSession.ts";

/** How long the build/contract-mismatch drain waits for the ssh-bridged link to die
 *  before treating the drain as not-taken — the transport-adapted twin of the local
 *  `DRAIN_TEARDOWN_CEILING_MS`. Sized above the local 2s because each liveness poll is
 *  a full ssh round-trip; a real drain exits well within it. Never a kill either way. */
const REMOTE_DRAIN_TEARDOWN_CEILING_MS = 6000;
/** Poll cadence for the post-drain liveness check (an ssh `control.core.hello`
 *  round-trip each tick). */
const REMOTE_DRAIN_POLL_MS = 150;
/** Default maxAttempts for the drain budget when deps do not override — matches
 *  {@link padiConvergencePolicy}'s production budget. */
const MAX_BUILD_DRAINS_PER_INSTANCE = 3;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** The host-selection knob: an ssh host (an `~/.ssh/config` alias or `user@host`).
 *  Unset → the LOCAL padi binding (byte-identical to today). */
export const KOLU_PADI_HOST_ENV = "KOLU_PADI_HOST";

/** P0 / D3 PRIMARY DEFENSE — the REMOTE padi's state-root, forwarded as this
 *  kolu-server's `--state-root <dir>` to every remote padi it binds. Two kolus
 *  binding the SAME remote host with DIFFERENT `KOLU_REMOTE_PADI_STATE_DIR` values
 *  reach two DISTINCT remote padis (distinct state-root digest → distinct socket),
 *  so they never co-supervise one remote daemon — the remote twin of the local
 *  `supervisor.pid` gate's isolation remedy. Unset → the remote **nix-built padi
 *  wrapper** supplies `KOLU_PADI_STATE_DIR` on the host (the single-kolu common
 *  case; #1334 deleted the silent code default). The value is a path ON THE
 *  REMOTE host; ssh carries only the command line, so it rides `--state-root` in
 *  `extraArgs`, never an env var (there is no env channel over the ssh exec).
 *  dev / e2e that bind a remote host set this to an isolated path. */
export const KOLU_REMOTE_PADI_STATE_DIR_ENV = "KOLU_REMOTE_PADI_STATE_DIR";

/** Parse `KOLU_PADI_HOST` as a comma-separated SEED list of pool hosts (W4 "the
 *  switch"). `LOCAL_HOST` is ALWAYS the implicit, unremovable default — prepended.
 *  Every token parses via `parseHostInput` (the HUMAN-input codec: the literal word
 *  `"local"` names the default, everything else is a remote target taken literally) —
 *  total, so there is no reserved-name/malformed-entry reject to skip: a `HostKey` is
 *  now a nominal sum, not an in-band string a bad value could collide with. Remote
 *  hosts are order-preserved after the local default, deduped by their encoded form. */
export function parseKoluPadiHostSeed(): HostKey[] {
  const raw = process.env[KOLU_PADI_HOST_ENV]?.trim();
  const listed = raw
    ? raw
        .split(",")
        .map((h) => h.trim())
        .filter((h) => h.length > 0)
    : [];
  const seen = new Set<string>([encodeHostKey(LOCAL_HOST)]);
  const remotes: HostKey[] = [];
  for (const h of listed) {
    const parsed = parseHostInput(h);
    const enc = encodeHostKey(parsed);
    if (seen.has(enc)) continue;
    seen.add(enc);
    remotes.push(parsed);
  }
  return [LOCAL_HOST, ...remotes];
}

/** A host that cannot be removed from the pool — the local default (and the server's
 *  boot default). `hosts.remove` rejects with this rather than silently no-op'ing
 *  (the #1708 pin: `remove(default)` must fail LOUD, not "succeed"). */
export class UnremovableHostError extends Error {
  constructor(host: string, why: string) {
    super(`cannot remove host ${JSON.stringify(host)}: ${why}`);
    this.name = "UnremovableHostError";
  }
}

/** Guard the pool's UNREMOVABLE default: a `hosts.remove` of the local host (`.kind ===
 *  "local"`) or `defaultHost` (the boot default — encoded-form compared, since a
 *  `HostKey` is an object with no reference identity across independent decodes) THROWS
 *  `UnremovableHostError` — the canvas must always keep a host to fall back to, and
 *  "being able to override" is never a feature. The #1708 pin: `remove(default)` fails
 *  LOUD, never silently no-ops. */
export function assertRemovableHost(host: HostKey, defaultHost: HostKey): void {
  if (
    host.kind === "local" ||
    encodeHostKey(host) === encodeHostKey(defaultHost)
  ) {
    throw new UnremovableHostError(
      encodeHostKey(host),
      "it is the unremovable local default",
    );
  }
}

/** The padi domain causes a dial's drv-resolution can fault with — the D1
 *  enrichment vocabulary {@link PadiDrvFault} carries and the binder's
 *  `drvFaultCause` closure holds. One alias so the two can never drift. */
type DrvFaultCause = Extract<
  EntryFailedCause,
  | "agent-source-unbaked"
  | "agent-cache-unbaked"
  | "agent-drv-unavailable"
  | "auth-required"
  | "host-key-unverified"
  | "nix-unavailable"
>;

/** EVERY `resolveDrvPath` fault this binder enriches, as ONE table: the domain
 *  cause it renames to, and whether the message gets the "…or unset the env"
 *  hint. Both facts are data, not `match` arms — four structurally-identical
 *  arms hid which kinds actually RENAME (`unavailable` → `agent-drv-unavailable`,
 *  `auth-refused` → `auth-required`) versus pass through, and splitting the
 *  hint into a second table hid that the two tables together were supposed to
 *  cover the kind space.
 *
 *  `Exclude<…, "network-exhausted">` is the load-bearing part: that one kind is
 *  rethrown untouched (it is the connector's own verdict), and every OTHER kind
 *  must appear here. A new `ResolveDrvFailure` kind is then a COMPILE error at
 *  this table — the one place that knows the mapping — instead of a runtime
 *  surprise at `.exhaustive()` or, worse, a card wearing the wrong remedy. */
const DRV_FAULT: Record<
  Exclude<ResolveDrvError["resolution"]["kind"], "network-exhausted">,
  { cause: DrvFaultCause; unsetHint: boolean }
> = {
  // The two SOURCE-CONFIGURATION faults. Both get the hint; they differ only in
  // the cause, and that difference is load-bearing — the ref-unbaked card tells
  // the operator to launch through the Nix wrapper, the cache-unbaked one must
  // not, because the ref IS baked.
  "source-unbaked": { cause: "agent-source-unbaked", unsetHint: true },
  "binary-cache-unbaked": { cause: "agent-cache-unbaked", unsetHint: true },
  // The pass-through faults: an unresolvable baked drv, and (probe-classified
  // terminal — see `resolveSystem`) the two ssh refusals plus an unrunnable
  // remote Nix. Each names the actual remedy on the host-down card (set up key
  // auth, accept the host key, install Nix) instead of the generic
  // "can't reach this host".
  unavailable: { cause: "agent-drv-unavailable", unsetHint: false },
  "auth-refused": { cause: "auth-required", unsetHint: false },
  "host-key-unverified": { cause: "host-key-unverified", unsetHint: false },
  "nix-unavailable": { cause: "nix-unavailable", unsetHint: false },
};

/** A {@link ResolveDrvError} subclass that additionally carries the D1 domain
 *  `cause` — the source-ref/arch faults (`"agent-source-unbaked"` /
 *  `"agent-drv-unavailable"`), the ssh refusals (`"auth-required"` /
 *  `"host-key-unverified"`), and an unrunnable remote Nix
 *  (`"nix-unavailable"`). The framework resolution rides through unchanged
 *  (retry policy AND terminality stay the framework's verdict); Padi enriches
 *  it with a typed domain cause, never reclassifies it. */
class PadiDrvFault extends ResolveDrvError {
  constructor(
    message: string,
    readonly domainCause: DrvFaultCause,
    resolution: ResolveDrvError["resolution"],
  ) {
    super(message, resolution);
    this.name = "PadiDrvFault";
  }
}

/** Build the `resolveDrvPath` thunk `sshConnector` runs at the top of EVERY dial:
 *  validate the baked source ref, probe the remote arch (an ssh round-trip), and
 *  evaluate that source's matching padi `.drv`. Validation is LAZY — inside this
 *  thunk, not at seed time — so an ABSENT ref (a non-Nix-wrapper dev run) becomes THIS
 *  entry's TERMINAL fault (the session goes `failed`, the chip reads the reason), NOT a
 *  boot-brick that takes the whole server + the healthy local default down with it
 *  (F6). A source that cannot resolve padi for the probed system is likewise a
 *  TERMINAL config fault; an unreachable host rejects plainly → `"network"` (retry). */
function makeResolvePadiDrv(): SshConnectorOptions["resolveDrvPath"] {
  return async (ctx) => {
    // Validate the baked ref here (lazy). A missing ref can't self-heal on a
    // retry, so represent it as a TERMINAL `ResolveDrvError("remote")` — the session
    // settles on `failed` and the entry publishes the reason, rather than retrying a
    // config/deploy fault forever.
    try {
      return await resolveBakedAgentDrv("padi", ctx);
    } catch (err) {
      if (!(err instanceof ResolveDrvError)) throw err;
      // ONE enrichment arm over `DRV_FAULT`: which cause, and whether the hint
      // is appended, are the table's job. The only kind with its OWN body is
      // `network-exhausted` — rethrown untouched, because it is the connector's
      // own verdict rather than a fault padi renames.
      const resolution = err.resolution;
      if (resolution.kind === "network-exhausted") throw err;
      const fault = DRV_FAULT[resolution.kind];
      throw new PadiDrvFault(
        fault.unsetHint
          ? `${err.message} Or unset ${KOLU_PADI_HOST_ENV} to bind only the local padi.`
          : err.message,
        fault.cause,
        resolution,
      );
    }
  };
}

/** The convergence deps — binder identity + budget/ceiling knobs for tests. */
export interface RemotePadiSessionDeps {
  binderVersion?: string;
  binderBuildId?: string;
  maxBuildDrainsPerInstance?: number;
  drainTeardownCeilingMs?: number;
  drainPollMs?: number;
}

/**
 * The remote padi front's `extraArgs`, which `sshConnector`/`buildAgentCommand` appends
 * AFTER the `--stdio` it already runs the binary with (POSIX-quoted). F2: this must NEVER
 * re-add `--stdio`. Carries `--spawn-version` (the kolu app version) and, when this
 * kolu-server isolates its remote padis ({@link KOLU_REMOTE_PADI_STATE_DIR_ENV}),
 * `--state-root <dir>` — so two kolus binding one host reach two distinct remote padis.
 */
export function composePadiExtraArgs(
  spawnVersion: string | null | undefined,
  remoteStateDir?: string | null,
): string[] {
  const args: string[] = [];
  // `--state-root` first so the remote padi resolves its digest/socket before the
  // version stamp is applied; both are order-insensitive to padi's CLI parser.
  if (remoteStateDir != null && remoteStateDir !== "")
    args.push("--state-root", remoteStateDir);
  if (spawnVersion != null) args.push("--spawn-version", spawnVersion);
  return args;
}

export interface EnsureRemotePadiBindingOptions {
  /** The ssh host to bind (an `~/.ssh/config` alias or `user@host`). */
  host: string;
  /** The kolu app version to stamp as the remote-spawned PTYs' `TERM_PROGRAM_VERSION`. */
  spawnVersion?: string;
}

/**
 * Bind a REMOTE padi over ssh and return the {@link PadiSession} `reServeSurface`
 * consumes — the twin of `ensurePadiBinding`, but one ssh hop away. Unlike the local
 * arm it does NOT await first-connect (provisioning a closure over ssh can take
 * seconds); the pump warms it the moment `reServeSurface` pins the session.
 */
export function ensureRemotePadiBinding(
  opts: EnsureRemotePadiBindingOptions,
  deps: RemotePadiSessionDeps = {},
): PadiSession {
  const { host } = opts;
  log.info(
    { host },
    `binding a REMOTE padi over ssh — one keyed host in the pool that ${KOLU_PADI_HOST_ENV} seeds`,
  );
  // The baked source ref is validated LAZILY inside `makeResolvePadiDrv` (at the first
  // dial), NOT here at seed time: an absent ref (a non-Nix-wrapper run) must fault THIS entry,
  // not brick boot for the whole pool (F6). `ensureRemotePadiBinding` therefore never
  // throws at seed — it always returns a session that warms, then fails loud if the
  // source ref is missing.
  const extraArgs = composePadiExtraArgs(
    opts.spawnVersion,
    process.env[KOLU_REMOTE_PADI_STATE_DIR_ENV],
  );

  const binderVersion = deps.binderVersion ?? PADI_SURFACE_VERSION;
  const binderBuildId = deps.binderBuildId ?? currentPadiBuildId();
  const maxDrains =
    deps.maxBuildDrainsPerInstance ?? MAX_BUILD_DRAINS_PER_INSTANCE;
  const drainCeilingMs =
    deps.drainTeardownCeilingMs ?? REMOTE_DRAIN_TEARDOWN_CEILING_MS;
  const drainPollMs = deps.drainPollMs ?? REMOTE_DRAIN_POLL_MS;

  // ONE policy object for both arms; budget memory is per-supervisor-boot and
  // SURVIVES adopts (no reset-on-adopt — that wiped the cross-supervisor signal).
  // createDrainBudget takes the whole policy so admit cannot cross-wire another.
  const policy = {
    ...padiConvergencePolicy(binderBuildId),
    // Tests may tighten the budget; production uses the policy's own maxAttempts.
    drainBudget: {
      maxAttempts: maxDrains,
      onGiveUp: "adopt-stale" as const,
    },
    // Allow a test to pin a different contract version than PADI_SURFACE_VERSION.
    baked: {
      contractVersion: binderVersion,
      build: daemonBuild(binderBuildId),
    },
  };
  const budget = createDrainBudget(policy);

  // ── Arm-local convergence state (closures, not class fields) ────────────────
  // The standing convergence anomaly `convergence()` surfaces (adopted-stale / skew /
  // unconverged / cross-supervisor / link-failed), or null when healthy/bound.
  // Framework anomalies ride here AS-IS; `link-failed` is session-owned (set by onState).
  let convergence: PadiConvergence | null = null;
  // The COMBINED dialed client (control.core + padi), stashed by the connector so the
  // post-connect `admit` + `renew` can reach `control.core.hello`/`.drain`. The
  // SESSION's client is the padi-SCOPED view; both are one connection.
  let combined: PadiDaemonClient | null = null;
  // D1: the drv-resolution fault this instance's LAST dial attempt hit, or `null`.
  // Separate axis from convergence (drv resolution fails before admit runs).
  let drvFaultCause: DrvFaultCause | null = null;

  /**
   * The D1+D2 domain detail for the map's `EntryStatus` — a single switch over
   * the standing convergence kind (typed evidence lives on the anomaly; no
   * sidecar). `drvFaultCause` is the one legitimate separate axis (pre-admit).
   */
  function computeEntryFailedDetail(): PadiEntryFailedDetail | null {
    // Single switch over the standing convergence kind — no ordering hazard
    // between convergence-derived causes. `drvFaultCause` is the one separate
    // axis (pre-admit drv resolution); it outranks the generic link-failed
    // banner but never masks a real admit verdict.
    switch (convergence?.kind) {
      case "cross-supervisor":
        return { cause: "cross-supervisor" };
      case "skew-refused":
        return {
          cause: "contract-skew-refused",
          running: convergence.running.contractVersion,
          expected: convergence.expected.contractVersion,
        };
      case "unconverged":
        return { cause: "unconverged" };
      case "adopted-stale":
        // Canvas-live degraded bind — not an entry failure.
        return null;
      case "link-failed":
      case undefined:
        if (drvFaultCause !== null) return { cause: drvFaultCause };
        if (convergence?.kind === "link-failed") {
          return { cause: "link-failed" };
        }
        return null;
      default: {
        const _exhaustive: never = convergence;
        throw new Error(
          `unreachable PadiConvergence: ${JSON.stringify(_exhaustive)}`,
        );
      }
    }
  }

  // ── The ssh connector, wrapped to SCOPE + STASH ─────────────────────────────
  // `sshConnector` yields the COMBINED daemon client; the pump + `identity()` need the
  // padi-scoped view (`client.surface.<member>` at /surface/padi/*). So the wrapper
  // stashes the combined (for admit/drain) and hands the session the scoped client.
  const resolveDrv = makeResolvePadiDrv();
  const inner = sshConnector<PadiDaemonContract>({
    host,
    binary: "padi",
    extraArgs,
    // localhost spawn env: clean allowlist via kolu-pty's composeSpawnEnv; see the
    // localEnv doc on buildAgentCommand. (Remote-padi operational overrides ride
    // `extraArgs`/`--state-root`, not env — the twin of the local arm's `daemonEnv`.)
    localEnv: composeSpawnEnv(process.env),
    // Reset-before-attempt, tag-on-fault: a fault classified on THIS dial stands
    // until the NEXT dial starts (whether that one succeeds, clearing it, or hits a
    // different fault, replacing it) — never a stale cause surviving a recovery.
    resolveDrvPath: async (ctx) => {
      drvFaultCause = null;
      try {
        return await resolveDrv(ctx);
      } catch (err) {
        if (err instanceof PadiDrvFault) drvFaultCause = err.domainCause;
        throw err;
      }
    },
  });
  const rawConnector: Connector<PadiSurfaceClient, SshProv> = async (ctx) => {
    const conn = await inner(ctx);
    combined = conn.client;
    return { ...conn, client: scopePadiSurface(conn.client) };
  };

  // ── Drain plumbing: the ssh arm's plugs into the framework drainAndAwaitExit ──
  /** Observe exit via hello-poll (ssh has no socket-close). Shared by drain + admit. */
  function awaitExitViaHello(
    c: PadiDaemonClient,
  ): (signal: AbortSignal) => Promise<void> {
    return async (signal) => {
      while (!signal.aborted) {
        try {
          await c.surface.control.core.hello();
        } catch {
          return; // hello rejected — the daemon exited
        }
        if (signal.aborted) return;
        await sleep(drainPollMs);
      }
    };
  }

  /** Fire the control-core drain + await exit via hello-poll. */
  function drainAndAwaitClose(
    c: PadiDaemonClient,
  ): Promise<{ took: boolean; drainRejection: string | null }> {
    return drainAndAwaitExit(
      () => c.surface.control.core.drain(),
      awaitExitViaHello(c),
      { ceilingMs: drainCeilingMs },
    );
  }

  // ── The admit hook: control-core hello → convergeAdmit ─────────────────────
  // No raw decide(), no admitDrain, no convergeNewerContract / convergeBuildMismatch —
  // the framework owns the decision table, budget, race, and cross-supervisor memory.
  const admit: Admit<PadiSurfaceClient> = async (): Promise<AdmitVerdict> => {
    const c = combined;
    if (c === null) {
      // The connector always stashes before admit runs; a null here is a real bug.
      throw new Error("remote padi admit: no combined client stashed");
    }
    const hello = await c.surface.control.core.hello();
    const runningBuild = hello.buildId ?? "";

    // Preserve the #1670 build-change breadcrumb when a build-axis drain fires —
    // the VM adoption arm greps this string. Logged here (before convergeAdmit)
    // only when the pure decision would drain on build; the framework logs its own
    // generic line too.
    const verdict = await convergeAdmit({
      running: {
        contractVersion: hello.surfaceVersion,
        build: daemonBuild(runningBuild),
        instanceKey: instanceKeyFromStartedAt(hello.startedAt),
      },
      budget,
      drain: () => c.surface.control.core.drain(),
      awaitExit: awaitExitViaHello(c),
      ceilingMs: drainCeilingMs,
      log: log.child({ host }),
    });

    // Breadcrumb for build-axis drains that took (or attempted) — keep the VM arm green.
    if (
      verdict.kind === "replaced" &&
      runningBuild !== "" &&
      runningBuild !== binderBuildId
    ) {
      log.info(
        { host, binderBuildId, runningBuild },
        `padi build change on boot: running=${runningBuild} expected=${binderBuildId}` +
          " — draining the survivor (persist + exit, its kaval + PTYs survive) and respawning this binder's own build (drain-on-build-mismatch, #1670)",
      );
    }

    switch (verdict.kind) {
      case "adopt": {
        // Clean adopt — budget memory SURVIVES (not reset). Clear standing anomaly.
        convergence = null;
        return { kind: "adopt" };
      }
      case "adopt-stale": {
        // Framework anomaly rides the wire as-is (typed running + expected).
        convergence = verdict.anomaly;
        return { kind: "adopt" };
      }
      case "replaced": {
        // Drain took → reconnect will re-handshake. Standing anomaly cleared; budget
        // retains the drained lineage so a foreign respawn is cross-supervisor.
        convergence = null;
        return { kind: "replaced", reason: verdict.reason };
      }
      case "refuse": {
        convergence = verdict.anomaly;
        return {
          kind: "refuse",
          state: { error: verdict.error, cause: "remote" },
        };
      }
      default: {
        const _exhaustive: never = verdict;
        throw new Error(
          `remote padi admit: unreachable verdict ${JSON.stringify(_exhaustive)}`,
        );
      }
    }
  };

  // ── The base session + the daemon-member spread ─────────────────────────────
  const base: Session<PadiSurfaceClient, SshProv> = makeSession<
    PadiSurfaceClient,
    SshProv
  >({
    connectOnce: rawConnector,
    // The remote ssh connector provisions padi before the transport is up. It
    // opens at `probing`, then advances to the one owned `provisioning` lifetime
    // only on a cold host.
    initialConnection: "probing",
    admit,
    // The session dispatches severity internally on the receiver (SK1); the
    // per-host context the old sink attached rides child bindings instead.
    log: log.child({ host }),
    label: `host:${host}`,
  });

  // Track the LINK phase onto `convergence`: a terminal `failed` (the ssh link gave up)
  // becomes a standing `link-failed`; a plain `disconnected` clears a healthy bind's
  // anomaly (a standing skew/adopted-stale verdict from admit stays until the next
  // handshake re-decides). Mirrors the pre-S9 hostUnsub.
  base.onState((s) => {
    if (s.phase === "failed") {
      // `lastError` is REQUIRED on the down arm (juspay/kolu SessionState sum
      // split) — a `failed` session always carries the real reason it gave up,
      // so there is no invented fallback text left to write here.
      convergence = {
        kind: "link-failed",
        detail: s.error,
      };
      combined = null;
    } else if (s.phase === "disconnected") {
      // A refused/degraded verdict from admit is left standing (it re-decides on the
      // next handshake); only a previously-healthy bind clears to null.
      if (convergence === null || convergence.kind === "link-failed") {
        convergence = null;
      }
      combined = null;
    }
  });

  return asPadiSession(base, {
    convergence: () => convergence,
    entryFailedDetail: computeEntryFailedDetail,
    /** DRAIN the bound padi (the "restart" verb): padi persists + exits, its kaval +
     *  PTYs survive, the front's relay ends → the session reconnects and re-adopts.
     *  Ground truth is the LINK DEATH (via {@link drainAndAwaitClose}), not the drain
     *  reply, and THROW if it does not exit in the window — never report a success that
     *  did not happen. */
    renew: async () => {
      const c = combined;
      if (c === null) {
        throw new Error(
          "remote padi is not bound — cannot drain (the daemon is unreachable)",
        );
      }
      const { took, drainRejection } = await drainAndAwaitClose(c);
      if (!took) {
        throw new Error(
          `remote padi drain did not complete — it did not exit within ${drainCeilingMs}ms (padi did not exit)` +
            drainRejectionSuffix(drainRejection),
        );
      }
    },
  });
}
