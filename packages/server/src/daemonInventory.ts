/**
 * The host-daemon inventory sampler — the sole writer of koluSurface's
 * `daemonInventory` cell that the Kaval + Padi info dialogs list.
 *
 * WHY: srid hit this dogfooding the W2.2 cutover — after an upgrade a LEAKED
 * pre-W2.2 kaval was invisible in the UI; the only signal was a `kaval-tui: more
 * than one kaval daemon is running` CLI error. This enumerates EVERY running kaval
 * (and padi) on the host and marks which one kolu's bound padi actively owns, so an
 * orphan is diagnosable at a glance.
 *
 * STRICTLY READ-ONLY. It reuses the SAME discovery `kaval-tui` uses
 * (`discoverKavalDaemons` / `discoverPadiDaemons` — scan the runtime dir, read each
 * gate `.pid`, read the `state-root` manifest) and, for each kaval, a best-effort
 * `system.version` + `terminal.list` status probe over a short-lived client. It NEVER
 * spawns, writes, kills, or reaps — no path here touches a daemon's lifecycle.
 *
 * The `active` marking is decided by SOCKET IDENTITY against the kaval/padi kolu's
 * bound padi owns (deterministic from padi's state-root digest), never by re-parsing a
 * human label. The pure assembly functions (`assembleKavalInventory` /
 * `assemblePadiInventory`) carry that logic and are unit-tested in isolation.
 */

import {
  type UnixSocketConnection,
  unixSocketLink,
} from "@kolu/surface/links/unix-socket";
import type { PadiDaemon } from "@kolu/padi/assembly";
import type { KavalDaemon, ptyHostSurface } from "kaval";
import type {
  DaemonInventory,
  RunningKaval,
  RunningPadi,
} from "kolu-common/surface";

/** The best-effort status a kaval socket answered — every field `null` when the
 *  probe failed / the daemon didn't answer (honest "unknown", never a fake value). */
export interface KavalProbe {
  terminalCount: number | null;
  buildCommit: string | null;
  contractVersion: string | null;
}

/** The empty probe — what an unreachable / slow / failed kaval reads as. */
const EMPTY_PROBE: KavalProbe = {
  terminalCount: null,
  buildCommit: null,
  contractVersion: null,
};

/**
 * PURE: assemble the wire `RunningKaval[]` from discovered kaval daemons, their
 * best-effort status probes (keyed by socket), and the socket of the kaval kolu's
 * bound padi owns.
 *
 * `active` is decided by SOCKET IDENTITY — exactly the padi-owned kaval reads "in use
 * by kolu"; a legacy `port` kaval (not owned by any padi) is the un-owned leak, flagged
 * via its `kind` for the dialog. `activeSocket` `null` (no padi identity) → none active.
 * A probe absent for a socket folds to all-`null` fields (honesty #1034).
 */
export function assembleKavalInventory(
  daemons: readonly KavalDaemon[],
  probes: ReadonlyMap<string, KavalProbe>,
  activeSocket: string | null,
): RunningKaval[] {
  return daemons.map((d) => {
    const probe = probes.get(d.socket) ?? EMPTY_PROBE;
    return {
      socket: d.socket,
      label: d.label,
      kind: d.kind,
      gatePid: d.gatePid,
      terminalCount: probe.terminalCount,
      buildCommit: probe.buildCommit,
      contractVersion: probe.contractVersion,
      active: activeSocket !== null && d.socket === activeSocket,
    };
  });
}

/**
 * PURE: assemble `RunningPadi[]` from discovered padi daemons, the socket of the padi
 * kolu-server is bound to, and that bound padi's honest `surfaceVersion` (off its
 * control-core `hello`).
 *
 * `active` is decided by SOCKET IDENTITY. Only the ACTIVE padi gets a `surfaceVersion`
 * — kolu-server already knows it from the bind handshake, so no re-dial is needed; a
 * padi kolu-server is NOT bound to reads `null` (not probed), the honest "unknown".
 */
export function assemblePadiInventory(
  daemons: readonly PadiDaemon[],
  activeSocket: string | null,
  activeSurfaceVersion: string | null,
): RunningPadi[] {
  return daemons.map((d) => {
    const active = activeSocket !== null && d.socket === activeSocket;
    return {
      socket: d.socket,
      stateRoot: d.stateRoot,
      gatePid: d.gatePid,
      surfaceVersion: active ? activeSurfaceVersion : null,
      active,
    };
  });
}

/** How long a single kaval status probe (connect + version + list) may take before it
 *  folds to the empty probe — a slow/wedged daemon must never stall the sampler. */
const PROBE_TIMEOUT_MS = 1500;

/** Race a promise against a timeout — the loser rejects, and the caller's `catch`
 *  folds it to the empty probe. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("kaval probe timed out")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Best-effort READ-ONLY status probe of one kaval socket: dial it, read
 * `system.version` (contract + build) and `terminal.list` (live terminal count), then
 * dispose the short-lived client. Bounded by {@link PROBE_TIMEOUT_MS}. NEVER throws — a
 * dead/absent/slow daemon yields the all-`null` empty probe. Read-only: it calls only
 * status/list verbs; it never spawns, writes, kills, or reaps.
 */
export async function probeKavalStatus(
  socket: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<KavalProbe> {
  let conn: UnixSocketConnection<typeof ptyHostSurface.contract> | undefined;
  try {
    conn = await withTimeout(
      unixSocketLink<typeof ptyHostSurface.contract>({ socketPath: socket }),
      timeoutMs,
    );
    const { client } = conn;
    const version = await withTimeout(
      client.surface.system.version({}),
      timeoutMs,
    );
    const list = await withTimeout(client.surface.terminal.list({}), timeoutMs);
    return {
      terminalCount: list.entries.length,
      buildCommit: version.identity?.navigableCommit ?? null,
      contractVersion: version.contractVersion,
    };
  } catch {
    return EMPTY_PROBE;
  } finally {
    conn?.dispose();
  }
}

/** The seams the sampler reads/writes through — injected so the wiring is one call and
 *  a test can drive it without a real host. `discover` are the read-only enumerators;
 *  `activeKavalSocket`/`activePadiSocket` are the deterministic sockets kolu's bound
 *  padi owns (constant, from padi's state-root digest). */
export interface DaemonInventoryDeps {
  /** Read-only discovery of every running kaval daemon (`discoverKavalDaemons`). */
  discoverKavals: () => KavalDaemon[];
  /** Read-only discovery of every running padi daemon (`discoverPadiDaemons`). */
  discoverPadis: () => PadiDaemon[];
  /** Best-effort read-only status probe of a kaval socket. */
  probe: (socket: string) => Promise<KavalProbe>;
  /** The socket of the kaval kolu's bound padi owns — deterministic from padi's
   *  state-root digest (constant). Marks the "in use by kolu" kaval. */
  activeKavalSocket: string;
  /** The socket of the padi kolu-server is bound to (constant). */
  activePadiSocket: string;
  /** The bound padi's honest `surfaceVersion` off its control-core `hello`, or `null`
   *  while padi is unbound — read fresh each tick so a (re)bind updates it. */
  activePadiSurfaceVersion: () => string | null;
  /** Publish the assembled inventory — `koluSurfaceCtx.cells.daemonInventory.set`. */
  publish: (inv: DaemonInventory) => void;
}

/** Take one read-only reading of the host-daemon inventory and publish it: discover
 *  every kaval + padi, probe each kaval socket in parallel (best-effort), assemble +
 *  mark kolu's active daemons, and set the cell. Never throws — each probe folds its
 *  own failure to the empty probe. */
export async function enumerateDaemonInventoryOnce(
  deps: DaemonInventoryDeps,
): Promise<void> {
  const kavalDaemons = deps.discoverKavals();
  const padiDaemons = deps.discoverPadis();
  const probeEntries = await Promise.all(
    kavalDaemons.map(
      async (d) => [d.socket, await deps.probe(d.socket)] as const,
    ),
  );
  const probes = new Map(probeEntries);
  deps.publish({
    kavals: assembleKavalInventory(
      kavalDaemons,
      probes,
      deps.activeKavalSocket,
    ),
    padis: assemblePadiInventory(
      padiDaemons,
      deps.activePadiSocket,
      deps.activePadiSurfaceVersion(),
    ),
  });
}

/** Cadence of the inventory readout. Coarser than the 5s memory tick — the daemon set
 *  changes rarely (only on a spawn/adopt/leak), and each tick dials every kaval, so a
 *  10s poll is plenty live without chattering. */
export const DAEMON_INVENTORY_SAMPLE_INTERVAL_MS = 10_000;

/** Start the periodic inventory sampler. Fires once immediately (a T+0 anchor so the
 *  cell has a value before the first dialog open), then every {@link
 *  DAEMON_INVENTORY_SAMPLE_INTERVAL_MS}. Non-overlapping (a slow tick never doubles up)
 *  and `unref`'d so the interval never holds the process open on its own. An optional
 *  `subscribeResample` force-samples on a signal (padi (re)bind), so the active padi's
 *  `surfaceVersion` and marking refresh at once. */
export function startDaemonInventorySampler(
  deps: DaemonInventoryDeps,
  subscribeResample?: (resample: () => void) => void,
): void {
  let inFlight = false;
  const tick = (): void => {
    if (inFlight) return;
    inFlight = true;
    void enumerateDaemonInventoryOnce(deps).finally(() => {
      inFlight = false;
    });
  };
  tick();
  setInterval(tick, DAEMON_INVENTORY_SAMPLE_INTERVAL_MS).unref();
  subscribeResample?.(tick);
}
