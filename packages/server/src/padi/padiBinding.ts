/**
 * kolu-server's PADI BINDER — the composition root for the W2.2 cutover.
 *
 * Before W2.2 kolu-server served `padiSurface` IN-PROCESS (it ran the terminal
 * domain itself and dialed a kaval daemon). Now kolu-server runs NO terminal
 * domain: it SPAWNS/ADOPTS a separate `padi` PROCESS over padi's digest-keyed
 * unix socket, handshakes the FROZEN control core, and RE-SERVES `padiSurface`
 * to browsers through W2.1's {@link reServeSurface}. This module is the padi twin
 * of `@kolu/padi/ptyHost/{connect,localDriver,index}` (which supervise kaval),
 * but supervising PADI — plus the ONE piece with no kaval analog: an
 * `endpointConnector` that turns the self-converging supervisor {@link Endpoint}
 * into the `connectOnce` transport plug `makeSession` loops over (post-S9 there is
 * no wrapper class — the session is a base `Session` + the daemon members by spread).
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
 *   2. `ensurePadiBinding`    — the twin of `ensureLocalEndpoint`: build the binding
 *                               (`makeSession` over a self-converging `endpointConnector`,
 *                               daemon members by spread — the crux, no wrapper class).
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
  residentPadiSocket,
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
  type PadiHelloIdentity,
  type PadiSurfaceClient,
  scopePadiSurface,
} from "@kolu/padi/dial";
import { PADI_SURFACE_VERSION } from "@kolu/padi/surface";
import {
  buildLabel,
  type ConvergenceOutcome,
  converge,
  createBuildDrainFence,
  createEndpoint,
  type DaemonDriver,
  daemonBuild,
  scrubDaemonNodeOptions,
  survivableSpawnDriver,
} from "@kolu/surface-daemon-supervisor";
import {
  type ClosedInfo,
  ConnectError,
  type Connector,
  makeSession,
  measureClockOffset,
  type Session,
} from "@kolu/surface-remote";
import { log } from "../log.ts";
// padi's convergence declaration into the shared daemon-convergence kit — the
// contract-skew POLICY, the FROZEN-control-core probe, and the drain plumbing the
// probe and the "restart" verb share. Carved out of this file in W4 ledger L6: it
// varies with daemon-lifecycle skew policy, a different volatility than the binder.
import {
  drainViaControlCore,
  PADI_CONVERGENCE_POLICY,
  probePadiForConvergence,
} from "./padiConvergence.ts";
import { asPadiSession, type PadiSession } from "./padiSession.ts";

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
 *  `--state-root` (so its kaval + digest follow it) AND its socket via `--socket`
 *  — the EXACT path {@link ensurePadiBinding} already computed with
 *  {@link padiSocketPath} for its own wait side (`createEndpoint`'s `socketPath`,
 *  what `dialPadiHello` dials). This is the single-source fix (the #1713 pattern):
 *  padi's OWN `padiSocketPath(stateRoot, opts.socketOverride)` call
 *  (`daemonMain.ts`) would otherwise re-read `$XDG_RUNTIME_DIR` in ITS process at
 *  spawn time — which can genuinely differ from the binder's reading (e.g. a
 *  transient `systemd-run --user` unit inherits the user manager's OWN default
 *  environment for anything not explicitly `--setenv`'d, so an unset
 *  `XDG_RUNTIME_DIR` in the binder's env does not imply unset in padi's). Passing
 *  the resolved path verbatim makes `padiSocketPath`'s override branch return it
 *  untouched, so construction (here) and expectation (padi's bind) cannot diverge
 *  under ANY env. Also carries the nix-shell whitelist via
 *  `--allow-nix-shell-with-env-whitelist` when set, and the kolu app version via
 *  `--spawn-version` — so spawned PTYs' `TERM_PROGRAM_VERSION` stays the kolu app
 *  version (byte-identical to the pre-cutover in-process spawn), not padi's own
 *  commit hash. Omit the version → padi falls back to its own commit (a standalone
 *  padi with no binder to forward the app version). */
export function resolvePadiLaunch(
  stateRoot: string,
  socketPath: string,
  nixShellWhitelist: string | undefined,
  spawnVersion: string | undefined,
  legacyKavalSocket: string | undefined,
): { binPath: string; args: string[] } {
  const baseArgs = ["--state-root", stateRoot, "--socket", socketPath];
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
  // packages/server/src/padi/padiBinding.ts → packages/padi/src/bin.ts
  const binTs = fileURLToPath(
    new URL("../../../padi/src/bin.ts", import.meta.url),
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
  socketPath: string,
  nixShellWhitelist: string | undefined,
  spawnVersion: string | undefined,
  verbose: boolean,
  legacyKavalSocket: string | undefined,
): DaemonDriver {
  const { binPath, args } = resolvePadiLaunch(
    stateRoot,
    socketPath,
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
  /** Invoked with the {@link PadiAdoptionRefusedError} on EVERY dial that reaches a
   *  genuine 'refused' convergence outcome — the very first boot dial AND every
   *  later RECONNECT dial alike. #1313's refuse-a-skew verdict is structurally
   *  unresolvable (retrying can never make an incompatible padiSurface contract
   *  compatible), so it must fail loudly no matter which dial discovers it.
   *
   *  This exists because the composition root's boot `pin()` await only observes
   *  the FIRST dial's rejection: every dial AFTER that runs through the session's
   *  own fire-and-forget reconnect loop (`@kolu/surface-remote`'s `session.ts`,
   *  `launchAttempt`), which deliberately swallows a `connectOnce` rejection into
   *  the state cell and never rethrows it anywhere a caller could observe. Without
   *  this hook, a refusal reached on a reconnect — e.g. a second binder taking over
   *  the state root between this binder's boot and a later reconnect — would be
   *  silently retried as "network" forever, recreating the exact silent spinner the
   *  boot-time fail-fast was meant to kill. The composition root wires this to the
   *  SAME `handlePadiBootFailure` the boot pin's rejection already reaches, so a
   *  first-dial and a later-dial refusal fail exactly the same way (calling it
   *  twice for a first-dial refusal — once here, once via the boot pin's own catch
   *  — is a harmless, deliberate redundancy, not a bug). */
  onAdoptionRefused?: (err: PadiAdoptionRefusedError) => void;
}

/** The single local padi host id — the endpoint's status key. Distinct from
 *  kaval's daemon-status key (padi's own `HostLocation` axis, encoded via
 *  `encodeHostLocation` — kaval now lives INSIDE padi). */
export const PADI_HOST_ID = "padi-local";

/**
 * A resident padi owns this state root at a `padiSurface` contract this binder
 * cannot speak, and — per #1313 (never kill a running padi) — the binder REFUSED
 * to touch it (left it standing + degraded). This is thrown ONLY for that
 * structurally-unresolvable case: retrying can never make an incompatible
 * contract compatible, so looping forever (fail-open's usual stance for a
 * transient boot hiccup) would just be a silent spinner behind the scenes — the
 * ONE outcome the boot acceptance bar forbids. The composition root
 * (`server/src/index.ts`) catches this specifically off the boot `pin()` and
 * exits non-zero with the message here, naming the conflict + the remedy,
 * instead of logging a buried error and serving a UI that will never connect.
 */
export class PadiAdoptionRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PadiAdoptionRefusedError";
  }
}

/** The connector's `conn === undefined` failure, classified — extracted as its own
 *  pure function (no I/O, no closures) so the ONE branch-point between "structurally
 *  unresolvable, exit" and "possibly transient, retry" is unit-testable directly off a
 *  hand-built {@link ConvergenceOutcome}, without booting a real padi. `outcome.kind
 *  === "refused"` reaching here (i.e. with no connection adopted — a raced
 *  refuse-but-actually-adopted never reaches this branch, see the connector) is the
 *  ONE case #1313's REFUSE policy produces: a genuine padiSurface CONTRACT skew
 *  against a survivor this binder must never touch. Every other reason `conn` is
 *  undefined (unreachable survivor, "not-adopted") is possibly transient — the
 *  existing fail-open `ConnectError`/`"network"` reconnect stance, unchanged. */
export function padiConnectFailure(
  outcome: ConvergenceOutcome,
  stateRoot: string,
  socketPath: string,
): Error {
  if (outcome.kind === "refused") {
    return new PadiAdoptionRefusedError(
      "a padi is already serving this workspace at a padiSurface contract this " +
        `kolu cannot speak (state dir: ${stateRoot}; its socket: ${socketPath}) — ` +
        "left standing, never touched (#1313: a binder never kills a running padi). " +
        "If a kolu is already running against it, use that one. To run a second, " +
        "independent instance here, set KOLU_STATE_DIR=<dir> (and " +
        "KOLU_PADI_STATE_DIR=<dir> for an isolated padi too).",
    );
  }
  // converge left padi standing + degraded (unreachable, or a raced refuse that
  // still holds no connection) — reconnect (network, retry with backoff) rather
  // than crash, matching the pre-S9 scheduleReconnect. NEVER a kill.
  return new ConnectError(
    "padi did not come up (left degraded / refused)",
    "network",
  );
}

/** Report a classified connect failure through the injected `onAdoptionRefused`
 *  hook — extracted as its own pure function (no I/O) so the ONE thing that must
 *  hold on EVERY dial (first AND every later reconnect) is unit-testable directly,
 *  without a real session or daemon. Called at the connector's throw site itself
 *  (not left to whichever dial's promise a caller happens to await): the
 *  composition root's boot `pin()` only observes the FIRST dial's rejection, and
 *  every later dial runs through the session's own fire-and-forget reconnect loop
 *  (`@kolu/surface-remote`'s `launchAttempt`), which swallows a `connectOnce`
 *  rejection with no rethrow. Calling the hook HERE — synchronously, before the
 *  throw — means a later dial's refusal is reported exactly the same way the first
 *  dial's is, closing that gap. A no-op for every other (retryable) classification. */
export function reportAdoptionRefusal(
  err: Error,
  onAdoptionRefused: ((err: PadiAdoptionRefusedError) => void) | undefined,
): void {
  if (err instanceof PadiAdoptionRefusedError) onAdoptionRefused?.(err);
}

/** The composition root's boot-`pin()` failure handler — extracted so it is
 *  unit-testable without booting the whole server. Distinguishes the ONE fatal case
 *  ({@link PadiAdoptionRefusedError}: adoption structurally cannot proceed, #1313) from
 *  every other boot hiccup, which stays fail-open (the reconnect loop already
 *  scheduled its own retry; this only logs). `deps` are injected (never read `log`/
 *  `process.exit` off a module global) so a test observes the exact calls without a
 *  real process teardown. */
export function handlePadiBootFailure(
  err: unknown,
  deps: {
    log: { error: typeof log.error; fatal: typeof log.fatal };
    exit: (code: number) => void;
  },
): void {
  if (err instanceof PadiAdoptionRefusedError) {
    deps.log.fatal({ err }, err.message);
    deps.exit(1);
    return;
  }
  deps.log.error({ err }, "padi endpoint failed to come up at boot");
}

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
export function ensurePadiBinding(opts: EnsurePadiBindingOptions): PadiSession {
  const stateRoot = resolvePadiStateRoot(opts.stateRoot);
  // DISCOVER a resident before computing our own drawer (the #1713 adopt-path
  // sibling's fix): `residentPadiSocket` reads back the `state-root` manifest a
  // running padi wrote about ITSELF, across every drawer this host could
  // plausibly have registered one under (this process's own env, the /tmp
  // fallback, and the systemd-standard `/run/user/$UID` — the last checked even
  // when THIS process's own `$XDG_RUNTIME_DIR` is unset). A manifest match wins
  // over our own-env guess unconditionally, so an XDG-unset kolu ADOPTS a
  // resident serving at XDG instead of waiting at a drawer nobody is listening
  // in. No resident found (a genuine fresh boot) → fall back to our own-env
  // socket, unchanged from before — the single-source-of-truth path the SPAWN
  // side (`resolvePadiLaunch`'s `--socket`) already threads verbatim.
  const socketPath = residentPadiSocket(stateRoot) ?? padiSocketPath(stateRoot);
  const gatePath = padiGatePath(socketPath);

  // The endpoint reports degraded/dead via `onStatus`; the connector routes that to the
  // CURRENT dial's `closed`, so `makeSession`'s loop reconnects (re-runs converge). The
  // endpoint holds ONE connection and does NOT self-reconnect — the loop owns that.
  let currentClosed: ((info: ClosedInfo) => void) | null = null;
  const ep = createEndpoint<
    PadiDaemonClient,
    PadiHelloIdentity,
    PadiConnectionMetadata
  >({
    hostId: PADI_HOST_ID,
    gatePath, // reuse padi's pid gate as-is.
    socketPath,
    driver: localPadiDriver(
      stateRoot,
      socketPath,
      opts.nixShellWhitelist,
      opts.spawnVersion,
      opts.verbose ?? false,
      opts.legacyKavalSocket,
    ),
    connect: () => connectPadi(socketPath),
    log,
    onStatus: (_hostId, status) => {
      // A degraded/dead close ends the current dial → resolve its `closed` so the
      // session loop reconnects. connecting/connected/restarting are transient warmth
      // the loop's own state covers; the binder's health rides the re-serve `connection`
      // cell, so there is nothing to publish to daemonStatus.
      if (status.state === "degraded" || status.state === "dead") {
        const resolve = currentClosed;
        currentClosed = null;
        // `Endpoint`'s in-process daemon link died with NO child process — a
        // both-null `{kind: "exit"}` here would render as "agent exited
        // code=null", the process-exit story for a death that was never a
        // process exit. `endpoint-down` is the honest variant for exactly
        // this case (see `ClosedInfo` in `@kolu/surface-remote/session`).
        resolve?.({ kind: "endpoint-down" });
      }
    },
  });

  // The build axis's once-per-binder-boot fence + this binder's baked expected padi
  // build id, created ONCE here (per server boot) and closed over by `convergePadi`, so
  // the build-mismatch drain fires at most once across this binder's life (#1670).
  const buildDrainFence = createBuildDrainFence();
  const binderBuildId = currentPadiBuildId();
  // The local padi's clock offset (ms) — measured at each connect over the frozen
  // control core (same machine → ~0, measured honestly, not assumed). Folded into the
  // keyed map's `EntryStatus.connected`.
  let clockOffset: number | null = null;

  // SELF-CONVERGE (pre-connect): `converge` probes the running padi's control-core
  // identity, decides per `PADI_CONVERGENCE_POLICY`, and ENACTS through the endpoint
  // (drain-if-newer / refuse-if-older / adopt / build-drain-once). Run at the top of
  // EVERY dial by the connector — this is why the LOCAL arm needs no post-connect
  // `admit`: its transport converges at connect (the Endpoint is unchanged).
  const convergePadi = async (): Promise<ConvergenceOutcome> => {
    const outcome = await converge({
      endpoint: ep,
      baked: {
        contractVersion: PADI_SURFACE_VERSION,
        build: daemonBuild(binderBuildId),
      },
      probe: () => probePadiForConvergence(socketPath),
      policy: PADI_CONVERGENCE_POLICY,
      buildFence: buildDrainFence,
      log,
    });
    // Preserve the #1670 build-change breadcrumb — the binder's OWN domain line. The
    // adoption-padi-upgrade VM arm greps `padi build change on boot: running=<hex>`.
    if (outcome.kind === "drained-replacing" && outcome.axis === "build") {
      log.info(
        {
          binderBuildId,
          runningBuild: buildLabel(outcome.running.build),
          running: outcome.running,
        },
        `padi build change on boot: running=${buildLabel(outcome.running.build)} expected=${binderBuildId}` +
          " — draining the survivor once (persist + exit; its kaval + PTYs survive) and " +
          "respawning this binder's own build (drain-on-build-mismatch, #1670).",
      );
    }
    return outcome;
  };

  // The LOCAL transport CONNECTOR (`endpointConnector`, a kolu-server leaf): self-
  // converge, then hand the loop the endpoint's held connection, scoped to the padi
  // sibling (the pump mirrors `/surface/padi/*`; `identity()` reads its `system.identity`).
  const connector: Connector<PadiSurfaceClient> = async (ctx) => {
    ctx.connecting();
    const outcome = await convergePadi();
    const conn = ep.current();
    if (conn === undefined) {
      // Classified by the extracted, unit-testable `padiConnectFailure`: a genuine
      // `"refused"` contract skew (#1313) is FATAL (a distinguished error the
      // composition root's boot `pin()` catches specifically, to exit loudly with the
      // conflict + the remedy); everything else reconnects (network, retry with
      // backoff), matching the pre-S9 scheduleReconnect. NEVER a kill.
      const err = padiConnectFailure(outcome, stateRoot, socketPath);
      // Report a fatal refusal HERE, synchronously, on every dial this connector
      // ever runs — not just whichever dial a caller happens to await. Reconnect
      // dials run through the session's own fire-and-forget loop and would
      // otherwise swallow this throw silently (see `onAdoptionRefused`'s doc).
      reportAdoptionRefusal(err, opts.onAdoptionRefused);
      throw err;
    }
    // Sample the local clock offset over the frozen control core (offset-at-connect,
    // re-measured each dial) before handing the loop the connection. A probe failure
    // is logged then rethrown — `attempt()` (session.ts) turns that into an honest
    // `disconnected` + reconnect, never a silent eternal `connecting`.
    clockOffset = await measureClockOffset(conn.client, (line) =>
      log.warn({ line }, "local padi clock-offset probe"),
    );
    const closed = new Promise<ClosedInfo>((resolve) => {
      currentClosed = resolve;
    });
    return {
      client: scopePadiSurface(conn.client),
      closed,
      // The FROZEN control-core hello round-trip — the liveness probe the watchdog uses.
      isAlive: () =>
        conn.client.surface.control.core.hello().then(() => undefined),
      teardown: () => conn.dispose(),
    };
  };

  // The LOCAL endpoint arm — `Prov = never` (no provisioning phases): the local
  // daemon is already here, nothing to nix-copy or probe, so `initialConnection` can
  // ONLY be "connecting" and this session's state can NEVER contain a provisioning
  // phase ("probing"/"copying"/"building"). `makeSession<_, never>` makes
  // `initialConnection: "probing"` a COMPILE error here — the illegal state is
  // unrepresentable, not merely unused (juspay/kolu#1716). The `Session<_, never>` is
  // still assignable to the pool's heterogeneous `Session` slot (a local session
  // satisfies the full contract by never emitting a provisioning phase).
  const base: Session<PadiSurfaceClient, never> = makeSession<
    PadiSurfaceClient,
    never
  >({
    connectOnce: connector,
    initialConnection: "connecting",
    reconnectDelayMs: opts.reconnectDelayMs,
    label: PADI_HOST_ID,
    onLog: (line) => log.info({ line }, "local padi session"),
  });

  // NB: this builds the session but does NOT dial — the loop warms on the first `pin()`.
  // The composition root (`index.ts`) BOOT-AWAITS that pin for the LOCAL arm before it
  // serves browsers (the pre-S9 stance), so the first re-served-surface request meets a
  // live upstream. Keeping `ensurePadiBinding` side-effect-free lets the arm's unit tests
  // observe `convergence()`/`identity()`/`renew()` with no real padi spawned.
  return asPadiSession(base, {
    // The LOCAL arm surfaces no convergence anomaly (parity with the pre-S9
    // PadiBindingSession, whose `padiConvergence()` returned null): the shared kit
    // collapses a fence-spent adopt to a bare `{kind:"adopted"}`, so local adopt-stale
    // can't be surfaced without a kit change (L23 follow-up).
    convergence: () => null,
    clockOffset: () => clockOffset,
    // Same parity: the local arm has no drv-resolution/skew channel (no ssh, no arch
    // probe, no baked drv map) and its OWN contract-skew refusal is FATAL at boot
    // (`PadiAdoptionRefusedError`, never a live down-session to publish a cause for)
    // — nothing here to classify.
    entryFailedDetail: () => null,
    /** DRAIN the bound padi (the "restart" verb): invoke the FROZEN control core's
     *  `drain` over the endpoint's held connection — padi persists + exits, its kaval +
     *  PTYs survive, the socket closes → the loop reconnects. NEVER a kill-9. The
     *  RPC/socket-close race is handled by the shared {@link drainViaControlCore}. */
    renew: async () => {
      const conn = ep.current();
      if (conn === undefined) {
        throw new Error(
          "padi is not bound — cannot drain (the daemon is down)",
        );
      }
      await drainViaControlCore(conn);
    },
  });
}
