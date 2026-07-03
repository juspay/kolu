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
 * THREE parts + the adapter:
 *   1. `connectPadi`         — the twin of `connectKaval`: dial + handshake.
 *   2. `localPadiDriver`      — the twin of `localKavalDriver`: how to launch padi.
 *   3. `PadiBindingSession`   — Endpoint → reconnect-mirror `HostSession` (the crux).
 *   4. `ensurePadiBinding`    — the twin of `ensureLocalEndpoint`: boot the binding.
 *
 * padi is NEVER kill-9'd: the boot policy is `adoptOrSpawnOrRefuse` (a proven
 * `padiSurface` skew REFUSES rather than recycling a running padi), and the
 * "restart" verb DRAINS the running padi (persist + exit; the PTYs survive in
 * kaval) via the frozen control core, then the reconnect loop re-spawns it.
 */

import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  padiGatePath,
  padiSocketPath,
  resolvePadiStateRoot,
} from "@kolu/padi/assembly";
import {
  PADI_SURFACE_VERSION,
  type PadiDaemonContract,
  type padiSurface,
} from "@kolu/padi/surface";
import {
  isContractVersionCompatible,
  scopeSibling,
} from "@kolu/surface/define";
import { stdioLink } from "@kolu/surface/links/stdio";
import {
  createEndpoint,
  type DaemonConnection,
  DaemonContractSkewError,
  type DaemonDriver,
  dialSocket,
  type Endpoint,
  type EndpointStatus,
  survivableSpawnDriver,
} from "@kolu/surface-daemon-supervisor";
import type {
  AgentClient,
  HostSessionState,
  RemoteMirrorSession,
} from "@kolu/surface-nix-host";
import { log } from "./log.ts";

// ── Types ──────────────────────────────────────────────────────────────────

/** The client the dial produces — typed to the COMBINED contract, so the
 *  handshake reaches `.surface.control.core.hello()` AND the re-serve can scope
 *  `.surface.padi`. */
type PadiDaemonClient = AgentClient<PadiDaemonContract>;

/** The padi-SIBLING-scoped client the re-serve mirrors: `{ surface: <padi> }`, so
 *  the relay's `client.surface.<member>` walk resolves at `/surface/padi/<member>`.
 *  Produced by `scopeSibling(combined, "padi")`. */
type PadiSurfaceClient = AgentClient<typeof padiSurface.contract>;

/** padi's wire identity, from its control-core `hello`. */
type PadiIdentity = { stateRoot: string; surfaceVersion: string } | undefined;
type PadiConnectionMetadata = {
  surfaceVersion: string;
  controlCoreVersion: string;
};
type PadiConnection = DaemonConnection<
  PadiDaemonClient,
  PadiIdentity,
  PadiConnectionMetadata
>;
type PadiEndpoint = Endpoint<
  PadiDaemonClient,
  PadiIdentity,
  PadiConnectionMetadata
>;
type PadiEndpointStatus = EndpointStatus<PadiIdentity, PadiConnectionMetadata>;

// ─────────────────────────────────────────────────────────────────────────────
// 1. connectPadi — the twin of connectKaval (packages/padi/src/ptyHost/connect.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dial padi at `socketPath`, handshake the FROZEN control core, and return the
 * live connection. Mirrors `connectKaval` EXACTLY on link choice: `dialSocket`
 * (from the supervisor) + `stdioLink` — NOT `unixSocketLink`, because the endpoint
 * needs the socket's `close` event for `onClose` (which `unixSocketLink` hides).
 * Typed to `PadiDaemonContract` so the handshake reaches
 * `client.surface.control.core.hello()`.
 *
 * The handshake gates on the SURFACE version (`hello.surfaceVersion` vs
 * `PADI_SURFACE_VERSION`), NOT the frozen control-core version (which never
 * moves). Three failure classes, same as connectKaval:
 *   - raw socket error → plain reject (transient);
 *   - unreadable hello → plain Error (non-skew);
 *   - genuine surface skew → `DaemonContractSkewError` — REFUSED (never recycled).
 */
export async function connectPadi(socketPath: string): Promise<PadiConnection> {
  const socket = await dialSocket(socketPath);
  const client = stdioLink<PadiDaemonContract>({
    read: socket,
    write: socket,
  }) as PadiDaemonClient;

  let hello: Awaited<
    ReturnType<PadiDaemonClient["surface"]["control"]["core"]["hello"]>
  >;
  try {
    hello = await client.surface.control.core.hello();
  } catch (err) {
    socket.destroy();
    throw new Error(
      `padi handshake failed — could not read control.core.hello (${(err as Error).message})`,
    );
  }

  if (
    !isContractVersionCompatible(hello.surfaceVersion, PADI_SURFACE_VERSION)
  ) {
    socket.destroy();
    // The ONE failure that proves the survivor is incompatible. In
    // `adoptOrSpawnOrRefuse` this is REFUSED (padi left standing + degraded),
    // never recycled — a binder never kill-9's a running padi (#1313 inversion).
    throw new DaemonContractSkewError(
      `padi contract skew: padi serves padiSurface ${hello.surfaceVersion}, binder needs ${PADI_SURFACE_VERSION}`,
    );
  }

  let closed = false;
  socket.once("close", () => {
    closed = true;
  });
  return {
    client,
    identity: {
      stateRoot: hello.stateRoot,
      surfaceVersion: hello.surfaceVersion,
    },
    // padi's HONEST boot time — stamped once at padi's daemon init and echoed by
    // the frozen `hello` (W2.2 added `startedAt` to `PadiHelloSchema`), so a
    // reconnect reports true uptime instead of resetting the age to `Date.now()`.
    startedAt: hello.startedAt,
    metadata: {
      surfaceVersion: hello.surfaceVersion,
      controlCoreVersion: hello.controlCoreVersion,
    },
    dispose: () => socket.destroy(),
    onClose: (cb) => {
      if (closed) queueMicrotask(cb);
      else socket.once("close", cb);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. localPadiDriver — the twin of localKavalDriver (…/ptyHost/localDriver.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** Strip dev-only flags from NODE_OPTIONS so the spawned padi doesn't inherit the
 *  SERVER's inspector / snapshot flags (which would point padi's captures at the
 *  server's cwd). Same shape as localDriver.ts's `scrubNodeOptions`. */
function scrubNodeOptions(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const kept = raw
    .split(/\s+/)
    .filter(
      (f) =>
        f !== "" &&
        !f.startsWith("--inspect") &&
        !f.startsWith("--heapsnapshot") &&
        !f.startsWith("--heap-prof") &&
        !f.startsWith("--cpu-prof"),
    );
  return kept.length > 0 ? kept.join(" ") : undefined;
}

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
 *   - `NODE_OPTIONS` (scrubbed) + `KOLU_DIAG_DIR` — as kaval's driver forwards.
 *
 * The nix-shell env WHITELIST rides padi's CLI flag (`--allow-nix-shell-with-env-
 * whitelist`, see `resolvePadiLaunch`); the whitelisted VARS themselves need no
 * explicit forwarding here — a whitelist only applies under a nix shell, which is
 * always the dev/e2e (`fromSource`) path, and the survivable-spawn driver layers
 * the child env OVER the full parent env on that path (systemd/prod runs off-nix).
 */
function daemonEnv(resolvedStateRoot: string): Record<string, string> {
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
  const nodeOptions = scrubNodeOptions(process.env.NODE_OPTIONS);
  if (nodeOptions !== undefined) env.NODE_OPTIONS = nodeOptions;
  if (process.env.KOLU_DIAG_DIR) env.KOLU_DIAG_DIR = process.env.KOLU_DIAG_DIR;
  return env;
}

/** Resolve how to launch padi: the built wrapper in production (`KOLU_PADI_BIN`),
 *  or the from-source `node --import <tsx> packages/padi/src/bin.ts` shape in
 *  dev/e2e. Twin of `resolveKavalLaunch`. padi is ALWAYS told its state-root via
 *  `--state-root` (so the digest, socket, and its kaval all follow it), and the
 *  nix-shell whitelist via `--allow-nix-shell-with-env-whitelist` when set. */
export function resolvePadiLaunch(
  stateRoot: string,
  nixShellWhitelist: string | undefined,
): { binPath: string; args: string[] } {
  const baseArgs = ["--state-root", stateRoot];
  if (nixShellWhitelist != null)
    baseArgs.push("--allow-nix-shell-with-env-whitelist", nixShellWhitelist);

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
): DaemonDriver {
  const { binPath, args } = resolvePadiLaunch(stateRoot, nixShellWhitelist);
  const fromSource =
    !process.env.KOLU_PADI_BIN || process.env.KOLU_PADI_SPAWN === "detached";
  return survivableSpawnDriver({
    binPath,
    args,
    env: daemonEnv(stateRoot),
    unitPrefix: "padi",
    fromSource,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. PadiBindingSession — Endpoint → reconnect-mirror `HostSession` adapter.
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
  const connection =
    s.state === "connected"
      ? "connected"
      : s.state === "connecting" || s.state === "restarting"
        ? "connecting"
        : "disconnected"; // degraded | dead
  return {
    connection,
    progressLines: [],
    remoteProgressLines: [],
    lastError: null,
    failureCause: null,
  };
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
 * The reconnect-mirror session over the supervisor Endpoint. Drives:
 *   - boot: `connectOnce()` → `endpoint.current()` holds the live connection.
 *   - reconnect: on the endpoint reporting degraded/dead, wait a backoff then
 *     `connectOnce()` again → a FRESH `currentClient()` promise → the pump rebinds.
 *   - onState: projected from the endpoint's onStatus (wired in ensurePadiBinding).
 *
 * Each successful connect swaps `clientPromise` to a NEW resolved promise so the
 * pump's client cursor advances on identity. `currentClient()`/`pin()` return the
 * padi-SIBLING-scoped client (`scopeSibling(combined, "padi")`).
 */
export class PadiBindingSession
  implements RemoteMirrorSession<typeof padiSurface.contract>
{
  private clientPromise: Promise<PadiSurfaceClient> | null = null;
  private destroyed = false;
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
    if (s.state === "connected") {
      const conn = this.deps.endpoint.current();
      if (conn) {
        // Scope the COMBINED dialed client down to the padi sibling so the relay's
        // `client.surface.<member>` resolves at /surface/padi/<member>.
        const scoped = scopeSibling(
          conn.client,
          "padi",
        ) as unknown as PadiSurfaceClient;
        this.clientPromise = Promise.resolve(scoped);
      }
    } else if (s.state === "degraded" || s.state === "dead") {
      // The live link dropped. Clear the client so a forward in the gap fails
      // honestly, then schedule ONE reconnect (padi survives its own unit; the
      // re-adopt re-attaches the surviving kaval + PTYs).
      this.clientPromise = null;
      this.scheduleReconnect();
    }
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
    this.deps.endpoint.current()?.dispose();
    // Re-publish to wake any cursor blocked on the next client so the pump exits.
    this.fire();
  }

  /** DRAIN the bound padi (the re-targeted "restart kaval" button, W2.2 gotcha 7):
   *  invoke the FROZEN control core's `drain` over the COMBINED dialed client —
   *  padi persists its layout + exits, its kaval + PTYs survive, the socket closes
   *  → the endpoint flips to degraded → the reconnect loop re-spawns padi onto the
   *  surviving kaval. NEVER a kill-9. The call may resolve OR reject as the socket
   *  tears down mid-response — either way the drain reached the core and did its
   *  job (the reconnect loop takes it from there). */
  async drainBoundPadi(): Promise<void> {
    const conn = this.deps.endpoint.current();
    if (!conn) {
      throw new Error("padi is not bound — cannot drain (the daemon is down)");
    }
    await conn.client.surface.control.core.drain().catch(() => {});
  }

  private setState(s: HostSessionState): void {
    this.state = s;
  }
  private fire(): void {
    for (const cb of [...this.stateListeners]) cb(this.state);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. ensurePadiBinding — the twin of ensureLocalEndpoint (…/ptyHost/index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface EnsurePadiBindingOptions {
  /** Explicit state-root override (dev/e2e); else `resolvePadiStateRoot`'s default
   *  (`KOLU_PADI_STATE_DIR` else the binary default). */
  stateRoot?: string;
  /** The nix-shell env whitelist forwarded to padi as its CLI flag. */
  nixShellWhitelist?: string;
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
    driver: localPadiDriver(stateRoot, opts.nixShellWhitelist),
    connect: () => connectPadi(socketPath),
    log,
    onStatus: (_hostId, status) => {
      // Drive the reconnect-mirror session; the binder's link health rides the
      // re-serve `connection` cell, so there is nothing to publish to daemonStatus.
      session?.onEndpointStatus(status);
    },
  });

  session = new PadiBindingSession({
    endpoint: ep,
    // Reconnect = re-run the boot policy: adopt the surviving padi (its socket +
    // its kaval's PTYs persist), or spawn fresh if it died. NEVER recycles on skew.
    connectOnce: () => ep.adoptOrSpawnOrRefuse(),
    reconnectDelayMs: opts.reconnectDelayMs,
  });

  try {
    await ep.adoptOrSpawnOrRefuse(); // skew → REFUSE (degraded), never recycle.
  } catch (err) {
    // The endpoint already reported `dead`; don't crash the server boot.
    log.error({ err }, "padi endpoint failed to come up at boot");
  }

  return session;
}
