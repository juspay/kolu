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
  measureClockOffset,
  parseDrvBySystem,
  ResolveDrvError,
  resolveSystem,
  type Session,
  sshConnector,
} from "@kolu/surface-remote";
import { encodeHostKey, parseHostInput } from "kolu-common/hostKey";
import type { PadiConvergence } from "kolu-common/surface";
import { type HostKey, LOCAL_HOST } from "kolu-common/surfacesWithPadi";
import { log } from "./log.ts";
// padi's convergence policy — ONE declaration, consumed by BOTH arms: the local binder
// feeds it to the kit's `converge()`, this remote arm to the pure `decide()`.
import {
  drainAndAwaitExit,
  drainRejectionSuffix,
  PADI_CONVERGENCE_POLICY,
} from "./padiConvergence.ts";
import { asPadiSession, type PadiSession } from "./padiSession.ts";

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

/** The per-system `{ system → padi .drv }` map env var, baked onto kolu-server's Nix
 *  wrapper. `"{}"` / unset means the server was not built with the map — fail loud. */
const PADI_AGENT_DRVS_ENV = "PADI_AGENT_DRVS_JSON";

/** The host-selection knob: an ssh host (an `~/.ssh/config` alias or `user@host`).
 *  Unset → the LOCAL padi binding (byte-identical to today). */
export const KOLU_PADI_HOST_ENV = "KOLU_PADI_HOST";

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

/** Whether `KOLU_PADI_HOST` names any REMOTE host — i.e. the pool is multi-host and
 *  the client should render the selector strip. Drives the published gate cell; the
 *  client never reads env. Env unset / local-only → `false` → zero multi-host UI. */
export function isMultiHost(): boolean {
  return parseKoluPadiHostSeed().length > 1;
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

/** Parse + validate the baked `{ system → padi .drv }` map. Called LAZILY from
 *  `makeResolvePadiDrv` (at the first dial), NOT at seed time: a missing/malformed map is
 *  a BUILD defect (kolu-server not run from its Nix wrapper), so it throws a loud Error
 *  the caller re-raises as a TERMINAL `ResolveDrvError` — that entry settles
 *  `failed(reason)` while the server + the healthy local default keep serving (F6).
 *  Fail-fast, but at the ENTRY scope, never boot. */
function parsePadiDrvMap(): Record<string, string> {
  const raw = process.env[PADI_AGENT_DRVS_ENV]?.trim();
  // The binder's own config-fault: an unbaked (empty or literal "{}") map carries the
  // remote-specific hint (unset KOLU_PADI_HOST to bind local). The JSON-parse + { system →
  // drv string } shape-check is the SAME across every agent, so reuse surface-remote's
  // `parseDrvBySystem` (the one authority) rather than a drift-prone copy.
  if (!raw || raw === "{}") {
    throw new Error(
      `${PADI_AGENT_DRVS_ENV} is not baked — a remote padi binding (${KOLU_PADI_HOST_ENV}) needs kolu-server run from its Nix wrapper, which bakes the arch-keyed padi drv map. Unset ${KOLU_PADI_HOST_ENV} to bind the local padi.`,
    );
  }
  return parseDrvBySystem(PADI_AGENT_DRVS_ENV, raw);
}

/** Build the `resolveDrvPath` thunk `sshConnector` runs at the top of EVERY dial:
 *  parse the baked drv map, probe the remote arch (`resolveSystem`, an ssh round-trip),
 *  and pick the baked padi `.drv` for it. The parse is LAZY — inside this thunk, not at
 *  seed time — so an ABSENT/malformed map (a non-Nix-wrapper dev run) becomes THIS
 *  entry's TERMINAL fault (the session goes `failed`, the chip reads the reason), NOT a
 *  boot-brick that takes the whole server + the healthy local default down with it (F6:
 *  the seed invariant — a seeded remote with no drv map is that entry's `failed(reason)`,
 *  never a crash; boot never parses per-host config eagerly). A host whose arch has no
 *  baked drv is likewise a TERMINAL config fault (`ResolveDrvError` `"remote"`); an
 *  unreachable host makes `resolveSystem` reject plainly → `"network"` (retry). */
function makeResolvePadiDrv(host: string): () => Promise<string> {
  return async () => {
    // Parse the baked map here (lazy). A missing/malformed map can't self-heal on a
    // retry, so re-raise it as a TERMINAL `ResolveDrvError("remote")` — the session
    // settles on `failed` and the entry publishes the reason, rather than retrying a
    // config/deploy fault forever.
    let map: Record<string, string>;
    try {
      map = parsePadiDrvMap();
    } catch (err) {
      throw new ResolveDrvError((err as Error).message, "remote");
    }
    const system = await resolveSystem(host);
    const drv = map[system];
    if (!drv) {
      throw new ResolveDrvError(
        `no padi derivation baked for system=${system} (${PADI_AGENT_DRVS_ENV} has: ${Object.keys(map).join(", ") || "none"})`,
        "remote",
      );
    }
    return drv;
  };
}

/** {@link admitDrain}'s verdict: drain this instance (with the attempt number), or GIVE
 *  UP draining it (with the reason). The caller decides what give-up MEANS per axis —
 *  build ADOPTS the resident stale build, contract goes `unconverged`. */
type DrainAdmission =
  | { kind: "drain"; attempt: number }
  | { kind: "giveUp"; reason: string };

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
 * AFTER the `--stdio` it already runs the binary with. F2: this must NEVER re-add
 * `--stdio`. Only `--spawn-version` (the kolu app version) rides through to
 * `runPadiDaemon`.
 */
export function composePadiExtraArgs(
  spawnVersion: string | null | undefined,
): string[] {
  return spawnVersion != null ? ["--spawn-version", spawnVersion] : [];
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
  // The baked drv map is parsed LAZILY inside `makeResolvePadiDrv` (at the first dial),
  // NOT here at seed time: an absent map (a non-Nix-wrapper run) must fault THIS entry,
  // not brick boot for the whole pool (F6). `ensureRemotePadiBinding` therefore never
  // throws at seed — it always returns a session that warms, then fails loud if the map
  // is missing.
  const extraArgs = composePadiExtraArgs(opts.spawnVersion);

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
  // The far-end clock offset (ms), re-measured at each admit's hello round-trip
  // (RTT-halved) — folded into the keyed map's `EntryStatus.connected`. `null` until the
  // first admit succeeds (the entry stays warming until then).
  let clockOffset: number | null = null;

  // ── The ssh connector, wrapped to SCOPE + STASH ─────────────────────────────
  // `sshConnector` yields the COMBINED daemon client; the pump + `identity()` need the
  // padi-scoped view (`client.surface.<member>` at /surface/padi/*). So the wrapper
  // stashes the combined (for admit/drain) and hands the session the scoped client.
  const inner = sshConnector<PadiDaemonContract>({
    host,
    binary: "padi",
    extraArgs,
    resolveDrvPath: makeResolvePadiDrv(host),
  });
  const rawConnector: Connector<PadiSurfaceClient> = async (ctx) => {
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
        reason: `${why}: a DIFFERENT padi instance (startedAt ${instance}) is still wrong after draining ${drainedInstance} this boot — another supervisor is respawning it (anti-livelock)`,
      };
    }
    if (instance === drainedInstance && drainAttempts >= maxDrains) {
      return {
        kind: "giveUp",
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
    // Sample the far-end clock offset over the same frozen control core (offset-at-hello)
    // — refreshed every admit, so a reconnect re-measures. A probe failure is logged
    // then rethrown — the admit-catch in `attempt()` (session.ts) turns that into an
    // honest `disconnected` + reconnect, never a silent eternal `connecting`.
    clockOffset = await measureClockOffset(c, (line) =>
      log.warn({ host, line }, "remote padi clock-offset probe"),
    );
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
        return {
          kind: "refuse",
          state: { lastError: msg, failureCause: "remote" },
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
    if (admission.kind === "giveUp") return unconverged(admission.reason);
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
      return adoptStale(runningBuild, admission.reason);
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
    return { kind: "adopt" };
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
    return {
      kind: "refuse",
      state: { lastError: msg, failureCause: "remote" },
    };
  }

  // ── The base session + the daemon-member spread ─────────────────────────────
  const base: Session<PadiSurfaceClient> = makeSession<PadiSurfaceClient>({
    connectOnce: rawConnector,
    // The REMOTE ssh connector PROVISIONS — it nix-copies the padi closure to the
    // host before the transport is up — so this session opens at "copying".
    initialConnection: "copying",
    admit,
    onLog: (line) => log.info({ host, line }, "remote padi session"),
    label: `host:${host}`,
  });

  // Track the LINK phase onto `convergence`: a terminal `failed` (the ssh link gave up)
  // becomes a standing `link-failed`; a plain `disconnected` clears a healthy bind's
  // anomaly (a standing skew/adopted-stale verdict from admit stays until the next
  // handshake re-decides). Mirrors the pre-S9 hostUnsub.
  base.onState((s) => {
    if (s.connection === "failed") {
      convergence = {
        state: "link-failed",
        runningBuild: null,
        expectedBuild: null,
        detail:
          s.lastError ??
          "the remote ssh link failed and gave up (host unreachable / provisioning failed)",
      };
      combined = null;
    } else if (s.connection === "disconnected") {
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
    clockOffset: () => clockOffset,
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
