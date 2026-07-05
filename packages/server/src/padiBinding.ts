/**
 * kolu-server's PADI BINDER — the composition root for the W2.2 cutover.
 *
 * Before W2.2 kolu-server served `padiSurface` IN-PROCESS (it ran the terminal
 * domain itself and dialed a kaval daemon). Now kolu-server runs NO terminal
 * domain: it SPAWNS/ADOPTS a separate `padi` PROCESS over padi's digest-keyed
 * unix socket, handshakes the FROZEN control core, and RE-SERVES `padiSurface`
 * to browsers through W2.1's {@link reServeSurface}. This module is the padi twin
 * of `@kolu/padi/ptyHost/{connect,localDriver,index}` (which supervise kaval),
 * but supervising PADI — plus the ONE piece with no kaval analog: a
 * {@link PadiBindingSession} that turns the one-shot supervisor {@link Endpoint}
 * into the reconnect-mirror `HostSession` shape `reServeSurface`'s pump loops
 * over.
 *
 * The DIAL itself (`connectPadi` / `dialPadiHello` — dial + control-core
 * handshake + typed skew refusal) is imported from `@kolu/padi/dial`: W2.3 carved
 * it into padi's package as the client-side dial kit `padi-tui` shares. And padi's
 * CONVERGENCE declaration into the shared daemon-convergence kit (the contract-skew
 * {@link PADI_CONVERGENCE_POLICY}, the FROZEN-control-core {@link probePadiForConvergence}
 * probe, and the drain plumbing) lives in `./padiConvergence.ts`: W4 ledger L6 carved it
 * out because it varies with daemon-lifecycle skew policy, a different volatility than the
 * binder. What stays HERE is the binder proper — the parts that spawn/supervise/re-serve:
 *   1. `localPadiDriver`      — the twin of `localKavalDriver`: how to launch padi.
 *   2. `PadiBindingSession`   — Endpoint → reconnect-mirror `HostSession` (the crux).
 *   3. `ensurePadiBinding`    — the twin of `ensureLocalEndpoint`: boot the binding.
 *
 * padi is NEVER kill-9'd. The boot/reconnect convergence DELEGATES to the shared
 * daemon-convergence kit (`@kolu/surface-daemon-supervisor`'s `converge`): {@link
 * ensurePadiBinding} feeds it padi's declared policy + probe (from `./padiConvergence.ts`),
 * and the kit owns the mechanism, the two-axis ordering (contract drain-newer/refuse-older;
 * build-mismatch drain-once, #1670), and the build fence — see that file's header for the
 * full two-axis behaviour. And the "restart" verb DRAINS the running padi (persist + exit;
 * the PTYs survive in kaval) via the frozen control core (`drainViaControlCore`, same
 * plumbing), then the reconnect loop re-spawns it.
 */

import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  currentPadiBuildId,
  padiGatePath,
  padiSocketPath,
  padiStderrLogPath,
  resolvePadiStateRoot,
} from "@kolu/padi/assembly";
// The client-side dial kit — carved out of THIS module in W2.3 so `padi-tui` and
// the binder share it (`@kolu/padi/dial`). What stays here is SUPERVISION: the
// drivers, the reconnect-mirror session, and the re-serve — everything that mutates
// padi's lifecycle, never a mere dial. (padi's convergence policy + probe + drain
// carved out to `./padiConvergence.ts` in L6.)
import {
  connectPadi,
  type PadiConnectionMetadata,
  type PadiDaemonClient,
  type PadiIdentity,
  type PadiSurfaceClient,
  scopePadiSurface,
} from "@kolu/padi/dial";
import { PADI_SURFACE_VERSION, type padiSurface } from "@kolu/padi/surface";
import type { PadiConvergence } from "kolu-common/surface";
import {
  converge,
  createBuildDrainFence,
  createEndpoint,
  type DaemonDriver,
  type Endpoint,
  type EndpointStatus,
  outcomeAdopted,
  scrubDaemonNodeOptions,
  survivableSpawnDriver,
} from "@kolu/surface-daemon-supervisor";
import type {
  HostSessionState,
  RemoteMirrorSession,
} from "@kolu/surface-nix-host";
import { match, P } from "ts-pattern";
import { log } from "./log.ts";
// padi's convergence declaration into the shared daemon-convergence kit — the
// contract-skew POLICY, the FROZEN-control-core probe, and the drain plumbing the
// probe and the "restart" verb share. Carved out of this file in W4 ledger L6: it
// varies with daemon-lifecycle skew policy, a different volatility than the binder.
import {
  drainViaControlCore,
  PADI_CONVERGENCE_POLICY,
  probePadiForConvergence,
} from "./padiConvergence.ts";

// ── Types ──────────────────────────────────────────────────────────────────
//
// The connection/identity/client types (`PadiDaemonClient`, `PadiSurfaceClient`,
// `PadiIdentity`, `PadiConnectionMetadata`, `PadiConnection`, `PadiDial`) moved
// into `@kolu/padi/dial` with `connectPadi` in W2.3 and are imported above. The
// SUPERVISION-only endpoint types stay here — they parameterize the supervisor
// `Endpoint` a binder owns, which a plain dial has no business naming.

type PadiEndpoint = Endpoint<
  PadiDaemonClient,
  PadiIdentity,
  PadiConnectionMetadata
>;
type PadiEndpointStatus = EndpointStatus<PadiIdentity, PadiConnectionMetadata>;

// ─────────────────────────────────────────────────────────────────────────────
// 1. localPadiDriver — the twin of localKavalDriver (…/ptyHost/localDriver.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The daemon-operational env padi needs that a transient systemd unit's env reset
 * would otherwise drop. Twin of `daemonEnv` (localDriver.ts), carrying padi's
 * state-anchoring vars too:
 *   - `XDG_RUNTIME_DIR`      — decides the digest-keyed socket dir.
 *   - `KOLU_STATE_DIR`       — the LEGACY conf path; padi's one-shot import
 *                              (importLegacy.ts) migrates it into the state-root
 *                              on first boot. Forwarded so the migration finds the
 *                              old `~/.config/kolu` blob.
 *   - `KOLU_PADI_STATE_DIR`  — the RESOLVED state-root, pinned explicitly so the
 *                              digest (socket + kaval) is stable and matches what
 *                              the binder dials.
 *   - `KOLU_KAVAL_SPAWN`     — forwarded so padi's OWN kaval driver honors the
 *                              detached escape for dev/e2e.
 *   - `LOG_LEVEL`            — the effective log level, so padi's OWN pino domain
 *                              logger (`packages/padi/src/log.ts`, what the relocated
 *                              domain code logs through) honors it across the
 *                              transient unit's env reset. `--verbose` forces `debug`
 *                              — the split-process twin of the pre-cutover
 *                              `padiLog.level = "debug"`; else an operator's explicit
 *                              `LOG_LEVEL` crosses the boundary.
 *   - `NODE_OPTIONS` (scrubbed) + `KOLU_DIAG_DIR` — as kaval's driver forwards.
 *
 * The nix-shell env WHITELIST rides padi's CLI flag (`--allow-nix-shell-with-env-
 * whitelist`, see `resolvePadiLaunch`); the whitelisted VARS themselves need no
 * explicit forwarding here — a whitelist only applies under a nix shell, which is
 * always the dev/e2e (`fromSource`) path, and the survivable-spawn driver layers
 * the child env OVER the full parent env on that path (systemd/prod runs off-nix).
 */
function daemonEnv(
  resolvedStateRoot: string,
  verbose: boolean,
): Record<string, string> {
  const env: Record<string, string> = {};
  if (process.env.XDG_RUNTIME_DIR)
    env.XDG_RUNTIME_DIR = process.env.XDG_RUNTIME_DIR;
  if (process.env.KOLU_STATE_DIR)
    env.KOLU_STATE_DIR = process.env.KOLU_STATE_DIR;
  // Pin padi's state-root explicitly so the digest (socket + kaval) is stable and
  // matches what the binder dials.
  env.KOLU_PADI_STATE_DIR = resolvedStateRoot;
  if (process.env.KOLU_KAVAL_SPAWN)
    env.KOLU_KAVAL_SPAWN = process.env.KOLU_KAVAL_SPAWN;
  // Carry the effective log level to padi's pino domain logger across the unit's env
  // reset — `--verbose` forces `debug` (the split-process twin of the pre-cutover
  // `padiLog.level = "debug"`), else forward an explicit operator `LOG_LEVEL`.
  const logLevel = verbose ? "debug" : process.env.LOG_LEVEL;
  if (logLevel) env.LOG_LEVEL = logLevel;
  const nodeOptions = scrubDaemonNodeOptions(process.env.NODE_OPTIONS);
  if (nodeOptions !== undefined) env.NODE_OPTIONS = nodeOptions;
  if (process.env.KOLU_DIAG_DIR) env.KOLU_DIAG_DIR = process.env.KOLU_DIAG_DIR;
  // Forward kaval's build identity for the FROM-SOURCE / dev path ONLY: the nix-built
  // padi wrapper BAKES `KAVAL_BUILD_ID` / `KAVAL_COMMIT_HASH` (padi owns kaval — its
  // closure knows them at build time; see default.nix), so a production padi already
  // has them. But a from-source padi (e2e / dev, no wrapper) would otherwise inherit
  // nothing, leaving its kaval-currency check (`expectedKaval`, terminalEndpoint/
  // reattach.ts) reading "" so the "update available" nudge can never fire. Forward
  // kolu-server's own baked value so dev matches production.
  if (process.env.KAVAL_BUILD_ID)
    env.KAVAL_BUILD_ID = process.env.KAVAL_BUILD_ID;
  if (process.env.KAVAL_COMMIT_HASH)
    env.KAVAL_COMMIT_HASH = process.env.KAVAL_COMMIT_HASH;
  return env;
}

/** Resolve how to launch padi: the built wrapper in production (`KOLU_PADI_BIN`),
 *  or the from-source `node --import <tsx> packages/padi/src/bin.ts` shape in
 *  dev/e2e. Twin of `resolveKavalLaunch`. padi is ALWAYS told its state-root via
 *  `--state-root` (so the digest, socket, and its kaval all follow it), the
 *  nix-shell whitelist via `--allow-nix-shell-with-env-whitelist` when set, and the
 *  kolu app version via `--spawn-version` — so spawned PTYs' `TERM_PROGRAM_VERSION`
 *  stays the kolu app version (byte-identical to the pre-cutover in-process spawn),
 *  not padi's own commit hash. Omit the version → padi falls back to its own commit
 *  (a standalone padi with no binder to forward the app version). */
export function resolvePadiLaunch(
  stateRoot: string,
  nixShellWhitelist: string | undefined,
  spawnVersion: string | undefined,
  legacyKavalSocket: string | undefined,
): { binPath: string; args: string[] } {
  const baseArgs = ["--state-root", stateRoot];
  if (nixShellWhitelist != null)
    baseArgs.push("--allow-nix-shell-with-env-whitelist", nixShellWhitelist);
  if (spawnVersion != null) baseArgs.push("--spawn-version", spawnVersion);
  // The W2.2 upgrade bridge: hand padi the binder's OWN listen-port legacy kaval
  // socket so a first W2.2 boot ADOPTS a running pre-W2.2 kaval instead of leaking
  // it. Passed on EVERY spawn (never import-gated); padi ignores it once its own
  // digest kaval is live, so it is a harmless no-op after the migration converges.
  if (legacyKavalSocket != null)
    baseArgs.push("--legacy-kaval-socket", legacyKavalSocket);

  const wrapper = process.env.KOLU_PADI_BIN;
  if (wrapper) return { binPath: wrapper, args: baseArgs };

  // Dev/e2e: reproduce padi's launcher from source. tsx resolved via the package
  // (not a hoisted .bin), exactly as localDriver.ts does for kaval.
  const require = createRequire(import.meta.url);
  const tsxLoader = pathToFileURL(require.resolve("tsx")).href;
  // packages/server/src/padiBinding.ts → packages/padi/src/bin.ts
  const binTs = fileURLToPath(
    new URL("../../padi/src/bin.ts", import.meta.url),
  );
  return {
    binPath: process.execPath,
    args: ["--import", tsxLoader, binTs, ...baseArgs],
  };
}

/** The padi driver: `survivableSpawnDriver` bound to padi's values. Twin of
 *  `localKavalDriver`. Under systemd-run (`--user`, INVOCATION_ID) so padi's
 *  NESTED kaval lands in its OWN unit that outlives padi restarts; `fromSource`
 *  is the detached escape (`KOLU_PADI_SPAWN=detached` OR no `KOLU_PADI_BIN`) — the
 *  exact twin of kaval's `KOLU_KAVAL_SPAWN`, not a new knob class. It covers dev/
 *  e2e (from-source, already detached) AND a nix-built kolu on a **bare,
 *  non-systemd box** (a `pu` box, a bare container): there `KOLU_PADI_BIN` is
 *  baked so the driver would try `systemd-run --user`, but with no user session
 *  that fails — set `KOLU_PADI_SPAWN=detached` to spawn detached instead. A real
 *  systemd host (kolu under `kolu.service`) needs neither. */
export function localPadiDriver(
  stateRoot: string,
  nixShellWhitelist: string | undefined,
  spawnVersion: string | undefined,
  verbose: boolean,
  legacyKavalSocket: string | undefined,
): DaemonDriver {
  const { binPath, args } = resolvePadiLaunch(
    stateRoot,
    nixShellWhitelist,
    spawnVersion,
    legacyKavalSocket,
  );
  const fromSource =
    !process.env.KOLU_PADI_BIN || process.env.KOLU_PADI_SPAWN === "detached";
  return survivableSpawnDriver({
    binPath,
    args,
    env: daemonEnv(stateRoot, verbose),
    unitPrefix: "padi",
    fromSource,
    // P0: the local padi daemon's RAW stderr (native errors / crash stacks pino can't see) →
    // its crash-catcher on the DETACHED (non-systemd) branch; its pino stream rides `padi.log`
    // via the daemon entrypoint's multistream (no flag). Under systemd, stderr → journald.
    stderrLog: padiStderrLogPath(stateRoot),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PadiBindingSession — Endpoint → reconnect-mirror `HostSession` adapter.
//    ⚠️ NO kaval analog. THIS is the crux the cutover adds. `reServeSurface`'s
//    pump loops on the `currentClient()` promise identity + `onState`; the
//    supervisor Endpoint holds ONE connection and flips to `degraded` on close
//    WITHOUT re-dialing. This adapter DRIVES the re-dial loop (`adoptOrSpawnOr-
//    Refuse` on degraded/dead) and projects endpoint status onto HostSessionState,
//    so the pump sees a fresh client per (re)bind.
// ─────────────────────────────────────────────────────────────────────────────

/** Project an endpoint status onto the browser-facing `HostSessionState` the
 *  connection cell reads (via `pipeSessionStateToCell`). The endpoint's
 *  connecting|connected|degraded|dead|restarting collapse onto the cell's
 *  connecting|connected|disconnected — degraded/dead stays "disconnected" so the
 *  re-serve reads as honestly reconnecting (the loop always re-dials). */
function projectEndpointStatus(s: PadiEndpointStatus): HostSessionState {
  const connection = match(s.state)
    .with("connected", () => "connected" as const)
    .with(P.union("connecting", "restarting"), () => "connecting" as const)
    // degraded | dead → disconnected: the loop always re-dials.
    .with(P.union("degraded", "dead"), () => "disconnected" as const)
    .exhaustive();
  return {
    connection,
    progressLines: [],
    remoteProgressLines: [],
    lastError: null,
    failureCause: null,
  };
}

/**
 * What kolu-server needs from a bound padi, LOCAL or REMOTE: the
 * `RemoteMirrorSession` role `reServeSurface` consumes (pin · currentClient ·
 * onState · markConnected · isDestroyed · destroy) PLUS the four kolu-server-facing
 * readouts/verbs — the bound padi's honest identity (uptime · contract version ·
 * build commit, off the control-core `hello`) and the "restart" drain. index.ts
 * types `padiSession` as this, so the {@link PadiBindingSession} (local Endpoint)
 * and W3.1's `RemotePadiSession` (ssh HostSession) are interchangeable at the
 * composition root — the knob picks one, the re-serve and the router are identical.
 */
export interface BoundPadi
  extends RemoteMirrorSession<typeof padiSurface.contract> {
  /** Narrowed from the role's `Promise<unknown>` to the padi-scoped client: both
   *  arms yield exactly this, and kolu-server's iframe-preview + memory-sampler
   *  routes call `.surface.padi.*` on it (a return-type narrowing is legal — the
   *  role stays satisfied). */
  pin(): Promise<PadiSurfaceClient>;
  currentClient(): Promise<PadiSurfaceClient> | null;
  /** DRAIN the bound padi (the "restart" verb): persist + exit; its kaval + PTYs
   *  survive; the reconnect loop re-adopts/re-spawns. Never a kill-9. */
  drainBoundPadi(): Promise<void>;
  /** The bound padi's boot time (ms epoch), or `null` while unbound — the rail's
   *  padi uptime. */
  padiStartedAt(): number | null;
  /** The bound padi's `padiSurface` version off its control-core `hello`, or `null`
   *  while unbound — the daemonInventory "contract v<x.y>" readout. */
  padiSurfaceVersion(): string | null;
  /** The bound padi's navigable git build commit off its control-core `hello`, or
   *  `null` while unbound / when a survivor padi predates the field. */
  padiBuildCommit(): string | null;
  /** A STANDING convergence anomaly to surface in the Padi dialog (adopted-stale build,
   *  contract skew, drain-failure, link-failure), or `null` when converged/healthy — so a
   *  degraded bind is a visible state, not a swallowed log line. The REMOTE arm returns the
   *  real descriptor; the LOCAL arm returns `null` for now — the shared convergence kit
   *  collapses a fence-spent adopt to a bare `{kind:"adopted"}` that drops the stale-vs-fresh
   *  distinction, so local adopt-stale can't be surfaced without a kit change (L23 follow-up;
   *  the local arm silently adopts today, pre-existing). */
  padiConvergence(): PadiConvergence | null;
}

export interface PadiBindingSessionDeps {
  endpoint: PadiEndpoint;
  /** Kick the boot/reconnect: `adoptOrSpawnOrRefuse` on boot, and again after a
   *  degraded close (re-adopt the surviving padi, or spawn fresh if it died). */
  connectOnce: () => Promise<boolean>;
  /** Backoff between a degraded close and the next reconnect attempt. */
  reconnectDelayMs?: number;
}

/**
 * The bound padi's HONEST identity off its control-core `hello` — the three
 * kolu-server-facing readouts as ONE value, so they can never disagree about
 * whether padi is bound. Present ⇔ padi is bound (a fresh `connected` sets the
 * whole record); `null` ⇔ unbound (a degraded/dead close, or `destroy`, clears
 * the whole record) — the three fields share EXACTLY one lifecycle, so one
 * nullable value makes a partial identity (e.g. an uptime with no version)
 * unrepresentable (illegal-states-unrepresentable; L6, collapsing three parallel
 * nullable fields set/cleared together in four places).
 *
 * Each member is itself nullable for an honest per-field "unknown" WHILE bound:
 *   - `startedAtMs` — boot time (ms epoch), off the connected status's `startedAt`
 *     (`hello.startedAt`). Feeds koluSurface's `processStartedAt` cell (the rail's
 *     padi uptime). `null` while unbound renders as the honest "unknown".
 *   - `surfaceVersion` — the `padiSurface` version the LIVE padi serves, off the
 *     handshake identity (`connectPadi` → `identity.surfaceVersion`; the handshake
 *     proved it compatible). Feeds `daemonInventory` (the Padi dialog + rail chip's
 *     "contract v<x.y>"). Read off the live padi, not the binder's build constant.
 *   - `buildCommit` — the running padi's navigable git commit off the same identity
 *     (`identity.commit`), or `null` when a survivor padi predates the field (off-nix
 *     reads "—", not a blank link). Feeds `daemonInventory`'s "build commit".
 */
type BoundIdentity = {
  startedAtMs: number | null;
  surfaceVersion: string | null;
  buildCommit: string | null;
};

/**
 * The reconnect-mirror session over the supervisor Endpoint. Drives:
 *   - boot: `connectOnce()` → `endpoint.current()` holds the live connection.
 *   - reconnect: on the endpoint reporting degraded/dead, wait a backoff then
 *     `connectOnce()` again → a FRESH `currentClient()` promise → the pump rebinds.
 *   - onState: projected from the endpoint's onStatus (wired in ensurePadiBinding).
 *
 * Each successful connect swaps `clientPromise` to a NEW resolved promise so the
 * pump's client cursor advances on identity. `currentClient()`/`pin()` return the
 * padi-SIBLING-scoped client (the dial kit's `scopePadiSurface(combined)`).
 */
export class PadiBindingSession implements BoundPadi {
  private clientPromise: Promise<PadiSurfaceClient> | null = null;
  private destroyed = false;
  /** The bound padi's HONEST identity (boot time · surface version · build commit)
   *  as ONE value, or `null` while padi is unbound. Managed on the SAME lifecycle as
   *  `clientPromise` — the whole record is set on a fresh `connected` (a respawned padi
   *  is a new process, so its identity is fresh) and cleared on a degraded/dead close —
   *  so the three readouts report the LIVE padi or an honest "unknown" together, never a
   *  stale mix from the old process. See {@link BoundIdentity} for each field's cell. */
  private boundIdentity: BoundIdentity | null = null;
  /** A reconnect timer is already scheduled — so overlapping degraded/dead events
   *  (a close, then the endpoint's own `dead` emit) don't STACK timers, each firing
   *  its own `adoptOrSpawnOrRefuse`. Cleared when the scheduled attempt fires. */
  private reconnectPending = false;
  private readonly stateListeners = new Set<(s: HostSessionState) => void>();
  private state: HostSessionState = projectEndpointStatus({
    state: "connecting",
  });

  constructor(private readonly deps: PadiBindingSessionDeps) {}

  /** Called by ensurePadiBinding on each endpoint status. Re-derives the scoped
   *  client on a fresh `connected`, and schedules a reconnect on degraded/dead. */
  onEndpointStatus(s: PadiEndpointStatus): void {
    // Manage the client handle FIRST (so a listener woken by fire() sees the fresh
    // currentClient()), then project + fire ONCE for every transition.
    match(s.state)
      .with("connected", () => {
        // padi's honest identity as ONE record. Boot time rides the connected STATUS
        // (`hello.startedAt` → endpoint `startedAt`), read off the status not
        // `endpoint.current()` so a respawned padi's FRESH boot time lands (never the
        // old process's); the surface version + build commit ride the held connection's
        // handshake identity (the version the LIVE padi serves, so the Padi dialog/rail
        // read it rather than the binder's build constant; commit "" → null, the honest
        // "unknown", so off-nix reads "—" not a blank link).
        const conn = this.deps.endpoint.current();
        this.boundIdentity = {
          startedAtMs: s.startedAt ?? null,
          surfaceVersion: conn?.identity?.surfaceVersion ?? null,
          buildCommit: conn?.identity?.commit || null,
        };
        if (conn) {
          // Scope the COMBINED dialed client down to the padi sibling so the relay's
          // `client.surface.<member>` resolves at /surface/padi/<member>. The binder
          // keeps `conn.client` (combined) for supervision (`control.core.drain`) and
          // uses the dial kit's projection only for the relay's scoped client.
          const scoped = scopePadiSurface(conn.client);
          this.clientPromise = Promise.resolve(scoped);
        }
      })
      .with(P.union("degraded", "dead"), () => {
        // The live link dropped. Clear the client so a forward in the gap fails
        // honestly, clear padi's identity so its uptime/version/commit read the honest
        // "unknown" together (never a stale mix), then schedule ONE reconnect (padi
        // survives its own unit; the re-adopt re-attaches the surviving kaval + PTYs).
        this.clientPromise = null;
        this.boundIdentity = null;
        this.scheduleReconnect();
      })
      // connecting | restarting: transient warming — no client-handle change; the
      // projected state below carries the frame.
      .with(P.union("connecting", "restarting"), () => {})
      .exhaustive();
    this.setState(projectEndpointStatus(s));
    this.fire();
  }

  /** Schedule a single reconnect, guarded so overlapping degraded/dead events
   *  don't stack timers. A fixed backoff is enough — `adoptOrSpawnOrRefuse` is
   *  itself idempotent (adopt the survivor, or spawn fresh). */
  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectPending) return;
    this.reconnectPending = true;
    setTimeout(() => {
      this.reconnectPending = false;
      if (this.destroyed) return;
      void this.deps.connectOnce().catch((err) => {
        // A failed reconnect leaves the endpoint reporting degraded/dead, which
        // fires onEndpointStatus again → the next scheduleReconnect keeps trying.
        log.error({ err }, "padi reconnect attempt failed");
      });
    }, this.deps.reconnectDelayMs ?? 2000);
  }

  pin(): Promise<PadiSurfaceClient> {
    // The pump pins ONCE. If no client yet, reject harmlessly — the cursor falls
    // through to currentClient() on the next onState fire.
    return (
      this.clientPromise ?? Promise.reject(new Error("padi not connected yet"))
    );
  }

  currentClient(): Promise<PadiSurfaceClient> | null {
    return this.destroyed ? null : this.clientPromise;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  /** The bound padi's boot time (ms epoch), or `null` while padi is unbound (or the
   *  session is destroyed). kolu-server publishes `now`-relative uptime from this onto
   *  koluSurface's `processStartedAt` cell; `null` renders as the honest "unknown". */
  padiStartedAt(): number | null {
    return this.destroyed ? null : (this.boundIdentity?.startedAtMs ?? null);
  }

  /** The bound padi's `padiSurface` version off its control-core `hello`, or `null`
   *  while padi is unbound (or the session is destroyed). koluSurface's
   *  `daemonInventory` cell carries it as the active padi's `surfaceVersion`; `null`
   *  renders as the honest "—". */
  padiSurfaceVersion(): string | null {
    return this.destroyed ? null : (this.boundIdentity?.surfaceVersion ?? null);
  }

  /** The bound padi's navigable git commit off its control-core `hello`, or `null`
   *  while unbound / when a survivor padi predates the field (or the session is
   *  destroyed). koluSurface's `daemonInventory` cell carries it as the active padi's
   *  `buildCommit`; `null` renders as the honest "—". */
  padiBuildCommit(): string | null {
    return this.destroyed ? null : (this.boundIdentity?.buildCommit ?? null);
  }

  /** The LOCAL arm surfaces no convergence anomaly today: the shared kit collapses a
   *  fence-spent build-mismatch adopt to a bare `{kind:"adopted"}` (converge.ts) that drops
   *  the stale-vs-fresh distinction, so an adopted-old-build here is indistinguishable from a
   *  clean adopt without a kit change. `null` = "nothing to surface" (pre-existing silent
   *  adopt). Surfacing local convergence is the L23 both-arms-unification follow-up; W3.1's
   *  adopt-loudly + degraded surfacing lands on the remote arm (its bindState knows the
   *  distinction firsthand). */
  padiConvergence(): PadiConvergence | null {
    return null;
  }

  onState(cb: (s: HostSessionState) => void): () => void {
    this.stateListeners.add(cb);
    cb(this.state); // snapshot-then-delta, like an inMemoryCell-backed onState.
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  markConnected(): void {
    // The pump calls this on the first folded frame. The endpoint already knows
    // it's connected (the handshake proved the link) and the connection cell is
    // driven by onState → projectConnection, so this is a no-op hook.
  }

  destroy(): void {
    this.destroyed = true;
    this.clientPromise = null;
    this.boundIdentity = null;
    this.deps.endpoint.current()?.dispose();
    // Re-publish to wake any cursor blocked on the next client so the pump exits.
    this.fire();
  }

  /** DRAIN the bound padi (the re-targeted "restart kaval" button, W2.2 gotcha 7):
   *  invoke the FROZEN control core's `drain` over the COMBINED dialed client —
   *  padi persists its layout + exits, its kaval + PTYs survive, the socket closes
   *  → the endpoint flips to degraded → the reconnect loop re-spawns padi onto the
   *  surviving kaval. NEVER a kill-9. The RPC/socket-close race is handled by the
   *  shared {@link drainViaControlCore} (the same plumbing the newer-binder
   *  convergence drain reuses), so the "restart" verb never reports success on a
   *  drain that did not happen. */
  async drainBoundPadi(): Promise<void> {
    const conn = this.deps.endpoint.current();
    if (!conn) {
      throw new Error("padi is not bound — cannot drain (the daemon is down)");
    }
    await drainViaControlCore(conn);
  }

  private setState(s: HostSessionState): void {
    this.state = s;
  }
  private fire(): void {
    // Guard each listener at the funnel: a throwing subscriber must NOT abort the
    // fan-out and silently drop this transition for the listeners after it. One
    // registrant exists today (`reServeSurface`'s state→cell pipe), but the public
    // `onState` Set can hold more. Log the throw (a listener that throws is a real
    // error, errors-must-log-at-error) and carry on. (callback-fanout-guarded-at-funnel.)
    for (const cb of [...this.stateListeners]) {
      try {
        cb(this.state);
      } catch (err) {
        log.error({ err }, "padi binding state listener threw");
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ensurePadiBinding — the twin of ensureLocalEndpoint (…/ptyHost/index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface EnsurePadiBindingOptions {
  /** Explicit state-root override (dev/e2e); else `resolvePadiStateRoot`'s default
   *  (`KOLU_PADI_STATE_DIR` else the binary default). */
  stateRoot?: string;
  /** The nix-shell env whitelist forwarded to padi as its CLI flag. */
  nixShellWhitelist?: string;
  /** The kolu app version to stamp as spawned PTYs' `TERM_PROGRAM_VERSION`,
   *  forwarded to padi's `--spawn-version` so the terminal identity stays the kolu
   *  app version (not padi's own commit). Omitted → padi falls back to its own
   *  commit/`dev` (a standalone padi with no binder forwarding the app version). */
  spawnVersion?: string;
  /** The LEGACY per-port kaval socket to hint padi — the binder computes it from its
   *  OWN listen port (`legacyKavalSocketPath(port)`), so a first W2.2 boot ADOPTS the
   *  running pre-W2.2 kaval instead of leaking it. Forwarded to padi's
   *  `--legacy-kaval-socket` on EVERY spawn. Omitting it (a standalone padi bring-up)
   *  disables legacy adoption entirely — the binder is the ONLY hinter, and only of
   *  its own port, so a dev instance at another port is never adopted. */
  legacyKavalSocket?: string;
  /** Forward the server's `--verbose` intent to padi's process as `LOG_LEVEL=debug`
   *  so padi's OWN pino domain logger emits debug — the split-process twin of the
   *  pre-cutover `padiLog.level = "debug"`. Omitted/false → padi honors an explicit
   *  operator `LOG_LEVEL`, else its `info` default. */
  verbose?: boolean;
  /** Reconnect backoff (test hook). */
  reconnectDelayMs?: number;
}

/** The single local padi host id — the endpoint's status key. Distinct from
 *  kaval's `LOCAL_HOST_ID` (kaval now lives INSIDE padi). */
export const PADI_HOST_ID = "padi-local";

/**
 * Boot the padi binding under the ADOPT-OR-SPAWN-OR-REFUSE policy and return the
 * reconnect-mirror session `reServeSurface` consumes. Twin of `ensureLocalEndpoint`,
 * but:
 *   - calls `ep.adoptOrSpawnOrRefuse()` — a proven `padiSurface` skew REFUSES
 *     (leaves padi standing + degraded), NEVER recycles a running padi (#1313);
 *   - has NO onAdopted/onNotAdopted/onBootSettled hooks — those are padi's OWN
 *     concern now (they run inside `runPadiDaemon`). The binder only establishes +
 *     re-serves the link;
 *   - the binder's own health (padi up/down) rides the re-serve's `connection`
 *     cell, NOT padi's `daemonStatus` collection (padi's own kaval publishes to
 *     THAT, and the re-serve mirrors it) — so this endpoint does not double-publish.
 *
 * Fail-open on boot error: the endpoint already reported `dead`; don't crash the
 * server boot (same stance as `ensureLocalEndpoint`).
 */
export async function ensurePadiBinding(
  opts: EnsurePadiBindingOptions,
): Promise<PadiBindingSession> {
  const stateRoot = resolvePadiStateRoot(opts.stateRoot);
  const socketPath = padiSocketPath(stateRoot);
  const gatePath = padiGatePath(socketPath);

  // The session is created after the endpoint (its onStatus drives the session),
  // but the endpoint's onStatus closure references `session` — assigned before the
  // first `adoptOrSpawnOrRefuse` await below, so no status can fire before it exists.
  let session!: PadiBindingSession;

  const ep = createEndpoint<
    PadiDaemonClient,
    PadiIdentity,
    PadiConnectionMetadata
  >({
    hostId: PADI_HOST_ID,
    gatePath, // reuse padi's pid gate as-is.
    socketPath,
    driver: localPadiDriver(
      stateRoot,
      opts.nixShellWhitelist,
      opts.spawnVersion,
      opts.verbose ?? false,
      opts.legacyKavalSocket,
    ),
    connect: () => connectPadi(socketPath),
    log,
    onStatus: (_hostId, status) => {
      // Drive the reconnect-mirror session; the binder's link health rides the
      // re-serve `connection` cell, so there is nothing to publish to daemonStatus.
      session?.onEndpointStatus(status);
    },
  });

  // The build axis's once-per-binder-boot fence + this binder's baked expected padi
  // build id (`PADI_BUILD_ID` — the id of the padi this binder would spawn, off the
  // koluBin wrapper). Created ONCE here (per server boot) and closed over by
  // `connectOnce`, so every reconnect shares the SAME fence and the build-mismatch
  // drain fires at most once across this binder's life (#1670).
  const buildDrainFence = createBuildDrainFence();
  const binderBuildId = currentPadiBuildId();

  // One bind attempt under the shared convergence kit: `converge` probes the running
  // padi's control-core identity (contract version — this binder's `PADI_SURFACE_VERSION`
  // vs the running padi's; AND build — `binderBuildId` vs its `buildId`), decides per
  // `PADI_CONVERGENCE_POLICY`, and enacts through the endpoint. Used for BOTH boot and
  // reconnect — a fresh deploy dialing a running padi is the primary case (a contract skew
  // drains if newer / refuses if older; a same-contract build change drains once → spawn
  // our own build); an unchanged redeploy adopts, UNCHANGED.
  const connectOnce = async (): Promise<boolean> => {
    const outcome = await converge({
      endpoint: ep,
      baked: { contractVersion: PADI_SURFACE_VERSION, buildId: binderBuildId },
      probe: () => probePadiForConvergence(socketPath),
      policy: PADI_CONVERGENCE_POLICY,
      buildFence: buildDrainFence,
      log,
    });
    // Preserve the #1670 build-change breadcrumb — the binder's OWN domain line, logged
    // from the build-axis drain outcome. The adoption-padi-upgrade VM arm greps exactly
    // `padi build change on boot: running=<hex> expected=<hex>`.
    if (outcome.kind === "drained-replacing" && outcome.axis === "build") {
      log.info(
        {
          binderBuildId,
          runningBuild: outcome.running.buildId,
          running: outcome.running,
        },
        `padi build change on boot: running=${outcome.running.buildId} expected=${binderBuildId}` +
          " — draining the survivor once (persist + exit; its kaval + PTYs survive) and " +
          "respawning this binder's own build (drain-on-build-mismatch, #1670; store " +
          "hashes don't order, so this fires at most once per binder boot)",
      );
    }
    return outcomeAdopted(outcome);
  };

  session = new PadiBindingSession({
    endpoint: ep,
    // Reconnect = re-run the boot policy: drain-if-newer, then adopt the surviving
    // padi (its socket + its kaval's PTYs persist), or spawn fresh if it died.
    // NEVER recycles on skew; older never drains.
    connectOnce,
    reconnectDelayMs: opts.reconnectDelayMs,
  });

  try {
    await connectOnce(); // newer → drain + spawn; older skew → REFUSE (degraded).
  } catch (err) {
    // The endpoint already reported `dead`; don't crash the server boot.
    log.error({ err }, "padi endpoint failed to come up at boot");
  }

  return session;
}
