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
import { daemonBuild, decide } from "@kolu/surface-daemon-supervisor";
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
// padi's convergence policy — ONE declaration, consumed by BOTH arms: the local binder
// feeds it to the kit's `converge()`, this remote arm to the pure `decide()`.
import {
  drainAndAwaitExit,
  drainRejectionSuffix,
  PADI_CONVERGENCE_POLICY,
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
/** How many times a SINGLE build-mismatched padi instance may be drained before the
 *  binder gives up and adopts it loudly. Bounds a flapping ssh link so it converges to
 *  a loud state instead of re-draining forever. */
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

/** {@link admitDrain}'s verdict: drain this instance (with the attempt number), or GIVE
 *  UP draining it. Give-up carries `why` so the caller can distinguish the two
 *  anti-livelock exits — `cross-supervisor` (a DIFFERENT live instance keeps replacing
 *  the one we drained: another supervisor is fighting us → D3 fail-honest, both axes),
 *  vs `budget` (the SAME instance survived every drain: a flapping link → the axis's own
 *  fallback, `unconverged` for contract / `adopt-stale` for build). */
type DrainAdmission =
  | { kind: "drain"; attempt: number }
  | { kind: "giveUp"; why: "cross-supervisor" | "budget"; reason: string };

/** The convergence deps — the binder's side of the two-axis drain decision + the
 *  instance-keyed drain budget. All default to production values; injected in tests. */
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

  // ── Arm-local convergence state (closures, not class fields) ────────────────
  // The standing convergence anomaly `convergence()` surfaces (adopted-stale / skew /
  // unconverged / link-failed), or null when healthy/bound.
  let convergence: PadiConvergence | null = null;
  // The COMBINED dialed client (control.core + padi), stashed by the connector so the
  // post-connect `admit` + `renew` can reach `control.core.hello`/`.drain`. The
  // SESSION's client is the padi-SCOPED view; both are one connection.
  let combined: PadiDaemonClient | null = null;
  // Instance-keyed build-drain state (NOT a global boolean fence — over ssh a hello()
  // rejection can be a link BLIP, so a once-per-boot boolean would falsely spend and
  // then adopt the stale build forever). `drainedInstance` is the `startedAt` of the
  // instance we are converging; `drainAttempts` how many drains that SAME instance
  // survived. Reset only when a matched build is adopted.
  let drainedInstance: number | null = null;
  let drainAttempts = 0;
  // D2: the running/expected padiSurface CONTRACT version pair for a STANDING
  // `skew-refused` verdict — set alongside `convergence` in the "refuse" branch below,
  // cleared alongside it on "adopt". `entryFailedDetail()` (below) attaches it as the
  // TYPED sidecar on the `contract-skew-refused` cause (D2's "zero string-scans").
  let skewVersions: { running: string; expected: string } | null = null;
  // D3: a STANDING cross-supervisor verdict's detail (a DIFFERENT live supervisor is
  // respawning this host's padi — `admitDrain`'s different-instance fight-detection),
  // or `null`. Set alongside `convergence` in `crossSupervisor()`, cleared everywhere a
  // NON-cross convergence lands (each set-site owns it, mirroring `skewVersions`). Drives
  // the map's TYPED `cross-supervisor` cause (checked FIRST in `computeEntryFailedDetail`,
  // since `crossSupervisor` parks under the `unconverged` convergence banner).
  let crossSupervisorDetail: string | null = null;
  // D1: the drv-resolution fault this instance's LAST dial attempt hit, or `null` —
  // set by the `resolveDrvPath` wrapper below (via `PadiDrvFault`), reset at the START
  // of every attempt so a later successful resolve clears a stale fault.
  let drvFaultCause: DrvFaultCause | null = null;

  /** The D1+D2 domain detail for the map's `EntryStatus` — derived from the SAME
   *  `convergence`/`skewVersions`/`drvFaultCause` closures above rather than a
   *  separately-maintained parallel state machine, so it can never drift out of sync
   *  with `convergence()`'s own (already-correct) lifecycle. `cross-supervisor` is
   *  RESERVED (see `EntryFailedCause`'s doc) — never returned here yet. */
  function computeEntryFailedDetail(): PadiEntryFailedDetail | null {
    // FIRST: a cross-supervisor fight parks under the `unconverged` convergence banner
    // (no dedicated PadiConvergence state), so its dedicated flag must win over the
    // `unconverged` cause below — else a genuine cross-supervisor would misreport.
    if (crossSupervisorDetail !== null) return { cause: "cross-supervisor" };
    if (convergence?.state === "skew-refused") {
      return skewVersions
        ? { cause: "contract-skew-refused", ...skewVersions }
        : { cause: "contract-skew-refused" };
    }
    if (convergence?.state === "unconverged") return { cause: "unconverged" };
    // A standing drv fault BEFORE the generic link banner: a terminal give-up
    // sets `convergence = link-failed` (the `onState` tracker below), but when
    // the dial's own resolution named a finer fault — an ssh refusal, an
    // unbaked source — THAT is the actionable truth, and "can't reach this
    // host" would mask its remedy. `drvFaultCause` resets at the start of
    // every attempt, so it is always the CURRENT campaign's finding, never a
    // stale one outliving a recovery.
    if (drvFaultCause !== null) return { cause: drvFaultCause };
    if (convergence?.state === "link-failed") return { cause: "link-failed" };
    return null;
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

  // ── Drain plumbing: the ssh arm's plug into the shared drainAndAwaitExit ──────
  /** Drain the combined client over the frozen control core, then confirm the daemon
   *  exited. The shared {@link drainAndAwaitExit} skeleton owns the arm-before-drain,
   *  fire-and-forget, and ceiling race; this arm supplies only the ssh exit signal —
   *  a `hello` POLL until it rejects (ssh has no socket-close event). Returns
   *  `took: true` if the link died within the window (drain took → reconnect respawns),
   *  `false` if the daemon kept answering (drain did not take — adopt/refuse, NEVER a
   *  kill). */
  function drainAndAwaitClose(
    c: PadiDaemonClient,
  ): Promise<{ took: boolean; drainRejection: string | null }> {
    return drainAndAwaitExit(
      c,
      // The ssh exit signal: keep pinging the frozen control core until `hello`
      // rejects (the daemon is gone). The abort signal — raised the instant the
      // skeleton's ceiling wins — stops the poll so a not-taken drain never leaks
      // an ssh hello every tick after it returns.
      async (signal) => {
        while (!signal.aborted) {
          try {
            await c.surface.control.core.hello();
          } catch {
            return; // hello rejected — the daemon exited, drain took
          }
          if (signal.aborted) return;
          await sleep(drainPollMs);
        }
      },
      { ceilingMs: drainCeilingMs },
    );
  }

  /** Instance-keyed drain ADMISSION — shared by both convergence axes. Re-draining the
   *  SAME never-exited instance (a blip) is admitted up to a per-instance budget; a
   *  DIFFERENT instance still wrong after a drain this boot (two supervisors / the
   *  absent-id dev loop) is the treadmill → give up. */
  function admitDrain(instance: number | null, why: string): DrainAdmission {
    if (drainedInstance !== null && instance !== drainedInstance) {
      return {
        kind: "giveUp",
        why: "cross-supervisor",
        reason: `${why}: a DIFFERENT padi instance (startedAt ${instance}) is still wrong after draining ${drainedInstance} this boot — another supervisor is respawning it (anti-livelock)`,
      };
    }
    if (instance === drainedInstance && drainAttempts >= maxDrains) {
      return {
        kind: "giveUp",
        why: "budget",
        reason: `${why}: instance startedAt ${instance} survived ${drainAttempts} drain attempts without exiting — a flapping link / respawn loop that will not converge`,
      };
    }
    drainedInstance = instance;
    drainAttempts += 1;
    return { kind: "drain", attempt: drainAttempts };
  }

  // ── The admit hook: control-core hello + decide → adopt / refuse / replaced ──
  const admit: Admit<PadiSurfaceClient> = async (): Promise<AdmitVerdict> => {
    const c = combined;
    if (c === null) {
      // The connector always stashes before admit runs; a null here is a real bug.
      throw new Error("remote padi admit: no combined client stashed");
    }
    const hello = await c.surface.control.core.hello();
    // The far-end clock offset is no longer hand-measured here: `makeSession` samples
    // it off the framework-reserved `system.clockNow` when it adopts this connection
    // and carries it on the session's own `connected` state (a keyed map reads it there).
    const running = hello.surfaceVersion;
    const instance = hello.startedAt ?? null;
    const runningBuild = hello.buildId ?? "";

    // The SAME pure `decide()` table the LOCAL arm runs, over ONE PADI_CONVERGENCE_POLICY.
    // `buildFenceSpent: false` — the kit's once-per-boot boolean fence is the LOCAL
    // arm's; over ssh `admitDrain`'s instance-keyed budget owns the drain decision.
    const decision = decide(
      { contractVersion: binderVersion, build: daemonBuild(binderBuildId) },
      { contractVersion: running, build: daemonBuild(runningBuild) },
      PADI_CONVERGENCE_POLICY,
      false,
    );

    switch (decision.kind) {
      case "adopt":
        // Contract-compatible + build match (or off-nix binder) → ADOPT. Any prior
        // drain genuinely took (a fresh instance replaced the drained one) — clear the
        // instance tracker so a later genuine mismatch starts its own budget fresh.
        drainedInstance = null;
        drainAttempts = 0;
        convergence = null;
        skewVersions = null;
        crossSupervisorDetail = null;
        return { kind: "adopt" };

      case "refuse": {
        // Contract skew + this binder OLDER/behind → REFUSE, never drain (#1313 +
        // monotonicity): leave the survivor standing + degraded, upgrade kolu-server.
        const msg = `padi contract skew: remote padi serves padiSurface ${running}, kolu-server needs ${binderVersion} — this binder is OLDER/behind, refusing`;
        log.warn(
          { host, binderVersion, running },
          "remote padi survivor is a padiSurface skew and this binder is OLDER/behind — " +
            "REFUSING (never draining a running padi; it is left standing + degraded).",
        );
        convergence = {
          state: "skew-refused",
          runningBuild: null,
          expectedBuild: null,
          detail: msg,
        };
        // D2: the TYPED contract-version pair — never re-scanned from `msg` by a
        // consumer (kills the last version string-scan).
        skewVersions = { running, expected: binderVersion };
        crossSupervisorDetail = null;
        return {
          kind: "refuse",
          state: { error: msg, cause: "remote" },
        };
      }

      case "drain-and-replace":
        return decision.axis === "contract"
          ? convergeNewerContract(running, instance)
          : convergeBuildMismatch(c, running, runningBuild, instance);

      default:
        throw new Error(
          `remote padi convergence: unreachable decision "${decision.kind}" for padi's policy with a live survivor`,
        );
    }
  };

  /** ENACT a NEWER-contract drain. Instance-keyed + BOUNDED via {@link admitDrain}. A
   *  treadmill / budget exhaustion → LOUD `unconverged`: an INCOMPATIBLE contract can
   *  never be adopted (unlike a build mismatch), so there is no working canvas to ride. */
  async function convergeNewerContract(
    running: string,
    instance: number | null,
  ): Promise<AdmitVerdict> {
    const admission = admitDrain(
      instance,
      `contract skew (binder ${binderVersion} newer than running ${running})`,
    );
    if (admission.kind === "giveUp")
      return admission.why === "cross-supervisor"
        ? crossSupervisor(admission.reason)
        : unconverged(admission.reason);
    const c = combined;
    if (c === null)
      throw new Error("remote padi: combined client gone mid-drain");
    log.info(
      { host, binderVersion, running, instance, attempt: admission.attempt },
      `remote padi is a padiSurface skew and this binder is NEWER — draining it (instance ` +
        `startedAt ${instance}, attempt ${admission.attempt}/${maxDrains})`,
    );
    const drain = await drainAndAwaitClose(c);
    if (drain.took) {
      // The reconnect brings up the newer closure; the cursor waits for it.
      convergence = null;
      crossSupervisorDetail = null;
      return {
        kind: "replaced",
        reason:
          "remote padi drained (newer contract) — reconnecting to the respawned newer build",
      };
    }
    return unconverged(
      `newer-binder drain did not take within ${drainCeilingMs}ms — the skewed padi kept answering (serves ${running}, kolu-server needs ${binderVersion})` +
        drainRejectionSuffix(drain.drainRejection),
    );
  }

  /** ENACT a build-mismatch drain (#1670). Instance-keyed + BOUNDED. A DIFFERENT
   *  still-mismatched instance / budget exhaustion → ADOPT-LOUDLY the resident (canvas
   *  WORKS, mismatch surfaced) — parity with the local kit's fence-spent→adopt row. */
  async function convergeBuildMismatch(
    c: PadiDaemonClient,
    running: string,
    runningBuild: string,
    instance: number | null,
  ): Promise<AdmitVerdict> {
    const admission = admitDrain(
      instance,
      `build mismatch (running=${runningBuild} expected=${binderBuildId})`,
    );
    if (admission.kind === "giveUp") {
      // A DIFFERENT instance keeps replacing the one we drained → another supervisor
      // is fighting us (D3): STOP + fail-honest with `cross-supervisor`, do NOT ride a
      // contested build (`adoptStale`) — the build we'd adopt is the loser of a race.
      // Only the SAME-instance budget exhaustion (a flapping link) adopts-stale.
      return admission.why === "cross-supervisor"
        ? crossSupervisor(admission.reason)
        : adoptStale(runningBuild, admission.reason);
    }
    log.info(
      {
        host,
        binderBuildId,
        runningBuild,
        running,
        instance,
        attempt: admission.attempt,
      },
      `padi build change on boot: running=${runningBuild} expected=${binderBuildId}` +
        ` — draining the survivor (instance startedAt ${instance}, attempt ${admission.attempt}/${maxDrains}; persist + exit, its kaval + PTYs survive) and respawning this binder's own build (drain-on-build-mismatch, #1670)`,
    );
    const drain = await drainAndAwaitClose(c);
    if (drain.took) {
      // Link died within the window — reconnect + re-handshake decides on the NEXT
      // hello's startedAt (drain took → fresh instance adopts; a blip → re-drain the
      // same, up to budget). NEVER adopt on this reply.
      return {
        kind: "replaced",
        reason:
          "remote padi drain / link death (build mismatch) — reconnecting to re-handshake the survivor",
      };
    }
    // The daemon kept ANSWERING past the window — alive, wedged. Could not drain-replace
    // → ADOPT-LOUDLY the resident build. Never a silent stale adopt.
    return adoptStale(
      runningBuild,
      `remote padi drain did not take within ${drainCeilingMs}ms — the daemon kept answering (running=${runningBuild} expected=${binderBuildId})` +
        drainRejectionSuffix(drain.drainRejection),
    );
  }

  /** ADOPT-LOUDLY a build-mismatched survivor we could NOT drain-replace. Ride the
   *  RESIDENT daemon (canvas WORKS — a LIVE client, `adopt`) and record a STANDING
   *  `adopted-stale` state via {@link convergence}, surfaced in the Padi dialog. */
  function adoptStale(runningBuild: string, reason: string): AdmitVerdict {
    const detail = `${reason} — riding the resident daemon; upgrade the winner or stop the respawner to converge`;
    log.warn(
      { host, runningBuild, expectedBuild: binderBuildId },
      `remote padi ADOPTED STALE (build mismatch, could not converge) — ${detail}`,
    );
    convergence = {
      state: "adopted-stale",
      runningBuild,
      expectedBuild: binderBuildId,
      detail,
    };
    crossSupervisorDetail = null;
    return { kind: "adopt" };
  }

  /** D3 — a DIFFERENT live supervisor is respawning this host's padi (the remote twin
   *  of the local `supervisor.pid` gate). The EXISTING anti-livelock fight-detection
   *  (`admitDrain`'s different-instance give-up) IS the signal; rather than spin
   *  (`unconverged`) or ride a contested build (`adoptStale`), STOP and fail HONEST with
   *  the TYPED `cross-supervisor` cause — the primary isolation lever is
   *  {@link KOLU_REMOTE_PADI_STATE_DIR_ENV}. REFUSE so the pump keeps the entry down +
   *  degraded and re-decides on the next handshake (never a kill). Parked under the
   *  `unconverged` convergence banner (no dedicated PadiConvergence state); the dedicated
   *  `crossSupervisorDetail` flag is what makes the map's cause `cross-supervisor`. */
  function crossSupervisor(msg: string): AdmitVerdict {
    log.error({ host }, `remote padi CROSS-SUPERVISOR — ${msg}`);
    convergence = {
      state: "unconverged",
      runningBuild: null,
      expectedBuild: null,
      detail: msg,
    };
    crossSupervisorDetail = msg;
    return {
      kind: "refuse",
      state: { error: msg, cause: "remote" },
    };
  }

  /** LOUD DEGRADED for the CONTRACT axis only — a NEWER-contract skew we could not
   *  drain away. An incompatible padiSurface can never be adopted, so surface the
   *  reason (like `refuse`) AND at `log.error`, and REFUSE so the pump keeps waiting. */
  function unconverged(msg: string): AdmitVerdict {
    log.error({ host }, `remote padi UNCONVERGED — ${msg}`);
    convergence = {
      state: "unconverged",
      runningBuild: null,
      expectedBuild: null,
      detail: msg,
    };
    crossSupervisorDetail = null;
    return {
      kind: "refuse",
      state: { error: msg, cause: "remote" },
    };
  }

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
        state: "link-failed",
        runningBuild: null,
        expectedBuild: null,
        detail: s.error,
      };
      // A genuine ssh link death supersedes a standing cross-supervisor verdict — the
      // link is now the honest failure; a reconnect re-decides ownership from scratch.
      crossSupervisorDetail = null;
      combined = null;
    } else if (s.phase === "disconnected") {
      // A refused/degraded verdict from admit is left standing (it re-decides on the
      // next handshake); only a previously-healthy bind clears to null.
      if (convergence === null || convergence.state === "link-failed") {
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
