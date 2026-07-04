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
 * PURE: resolve WHICH discovered kaval socket kolu's padi actually HOLDS, mirroring
 * padi's adopt precedence (the record padi writes for the held daemon). padi keys its
 * kaval by a DIGEST of its state-root and SPAWNS there; on a W2.2 upgrade it instead
 * ADOPTS a live pre-W2.2 `kaval-<port>/` (the binder's legacy-socket hint), keeping the
 * PTYs. So the held socket is the DIGEST address when a kaval is live there (primary),
 * else the LEGACY address when one is live there (adopted), else the digest address (the
 * address padi will spawn at — nothing live yet). This is the SAME digest-primary,
 * legacy-hint order the adopter applies, read off the observable live-socket set.
 */
export function resolveActiveKavalSocket(
  daemons: readonly KavalDaemon[],
  digestSocket: string,
  legacySocket: string,
): string {
  const live = new Set(daemons.map((d) => d.socket));
  if (live.has(digestSocket)) return digestSocket;
  if (live.has(legacySocket)) return legacySocket;
  return digestSocket;
}

/**
 * PURE: assemble the wire `RunningKaval[]` from discovered kaval daemons, their
 * best-effort status probes (keyed by socket), the socket kolu's padi actually HOLDS
 * (from {@link resolveActiveKavalSocket}), and the pre-padi LEGACY socket the binder
 * would adopt.
 *
 * `active` is decided by SOCKET IDENTITY against the held socket — exactly the
 * padi-held kaval reads "in use by kolu", even when that is the legacy-port address
 * after an upgrade adoption. `atLegacyAddress` marks that adopted-at-the-old-address
 * case (active AND held socket === the legacy socket): a KNOWN converging state, not a
 * leak. A legacy `port`-kind kaval that is NOT the held one stays the genuine
 * stray/leak (flagged via its `kind` in the dialog). `activeSocket` `null` → none
 * active. A probe absent for a socket folds to all-`null` fields (honesty #1034).
 */
export function assembleKavalInventory(
  daemons: readonly KavalDaemon[],
  probes: ReadonlyMap<string, KavalProbe>,
  activeSocket: string | null,
  legacySocket: string,
): RunningKaval[] {
  return daemons.map((d) => {
    const probe = probes.get(d.socket) ?? EMPTY_PROBE;
    const active = activeSocket !== null && d.socket === activeSocket;
    return {
      socket: d.socket,
      label: d.label,
      kind: d.kind,
      gatePid: d.gatePid,
      terminalCount: probe.terminalCount,
      buildCommit: probe.buildCommit,
      contractVersion: probe.contractVersion,
      active,
      // Only the HELD kaval sitting at the pre-padi legacy address — an adoption that
      // will converge onto the digest address on the next restart/reboot. Never a stray.
      atLegacyAddress: active && d.socket === legacySocket,
    };
  });
}

/**
 * PURE: assemble `RunningPadi[]` from discovered padi daemons, the socket of the padi
 * kolu-server is bound to, and that bound padi's honest `surfaceVersion` + `buildCommit`
 * (both off its control-core `hello`).
 *
 * `active` is decided by SOCKET IDENTITY. Only the ACTIVE padi gets a `surfaceVersion`
 * and `buildCommit` — kolu-server already knows them from the bind handshake, so no
 * re-dial is needed (mirroring how the kaval probe carries kaval's build); a padi
 * kolu-server is NOT bound to reads `null` (not probed), the honest "unknown".
 */
export function assemblePadiInventory(
  daemons: readonly PadiDaemon[],
  activeSocket: string | null,
  activeSurfaceVersion: string | null,
  activeBuildCommit: string | null,
): RunningPadi[] {
  return daemons.map((d) => {
    const active = activeSocket !== null && d.socket === activeSocket;
    return {
      socket: d.socket,
      stateRoot: d.stateRoot,
      gatePid: d.gatePid,
      surfaceVersion: active ? activeSurfaceVersion : null,
      buildCommit: active ? activeBuildCommit : null,
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
 *  `digestKavalSocket`/`legacyKavalSocket`/`activePadiSocket` are the deterministic
 *  sockets kolu's bound padi owns/would-adopt (constants, from padi's state-root digest
 *  and this binder's listen port). */
export interface DaemonInventoryDeps {
  /** Read-only discovery of every running kaval daemon (`discoverKavalDaemons`). */
  discoverKavals: () => KavalDaemon[];
  /** Read-only discovery of every running padi daemon (`discoverPadiDaemons`). */
  discoverPadis: () => PadiDaemon[];
  /** Best-effort read-only status probe of a kaval socket. */
  probe: (socket: string) => Promise<KavalProbe>;
  /** The DIGEST-keyed kaval socket padi spawns at — deterministic from padi's
   *  state-root digest (constant). The primary address padi's kaval normally holds. */
  digestKavalSocket: string;
  /** The pre-padi LEGACY `kaval-<port>/` socket the binder hands padi as an adopt
   *  hint (`legacyKavalSocketPath(this binder's listen port)`, constant). The address
   *  an upgrade-adopted kaval sits at until it converges onto the digest one. */
  legacyKavalSocket: string;
  /** The socket of the LOCAL padi kolu-server is bound to (constant). Only consulted for
   *  a LOCAL binding (`boundHost === null`) — a remote binding owns no local socket. */
  activePadiSocket: string;
  /** The ssh host the bound padi lives on (`KOLU_PADI_HOST`), or `null` for a LOCAL
   *  binding — the SINGLE source for both "is this a remote bind?" and the dialog label.
   *  When non-null the bound padi lives on ANOTHER host, so NO locally-discovered daemon
   *  is kolu's active one: `boundLocally` (DERIVED = `boundHost === null`) suppresses the
   *  local active-marking (kaval + padi) AND the remote-identity attribution, so the
   *  diagnostic never falsely labels a local daemon "in use by kolu" or pins the remote
   *  padi's version onto a local socket; and the dialog labels this LOCAL scan "this
   *  machine, not the bound host <boundHost>". The remote padi's own inventory is a later
   *  slice; here the local list stays honest (leaks visible, none marked active). */
  boundHost: string | null;
  /** The bound padi's honest `surfaceVersion` off its control-core `hello`, or `null`
   *  while padi is unbound — read fresh each tick so a (re)bind updates it. */
  activePadiSurfaceVersion: () => string | null;
  /** The bound padi's honest navigable git `commit` off its control-core `hello`, or
   *  `null` while unbound / a survivor padi predating the field — read fresh each tick.
   *  Mirrors how the kaval probe carries kaval's build commit. */
  activePadiBuildCommit: () => string | null;
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
  const boundLocally = deps.boundHost === null;
  // Which kaval padi actually holds — the digest address normally, the adopted legacy
  // address after a W2.2 upgrade (mirroring padi's adopt precedence off the live set).
  // A REMOTE binding owns no local kaval, so mark NONE active (a stray local kaval is
  // still listed — just never labelled "in use by kolu").
  const activeKavalSocket = boundLocally
    ? resolveActiveKavalSocket(
        kavalDaemons,
        deps.digestKavalSocket,
        deps.legacyKavalSocket,
      )
    : null;
  deps.publish({
    boundHost: deps.boundHost,
    // The BOUND padi's honest identity (both arms) — read fresh off the session's hello
    // readouts, so the Padi dialog's version + build-commit rows work over ssh even
    // though no LOCAL padi is `active` under a remote binding.
    boundPadi: {
      surfaceVersion: deps.activePadiSurfaceVersion(),
      buildCommit: deps.activePadiBuildCommit(),
    },
    kavals: assembleKavalInventory(
      kavalDaemons,
      probes,
      activeKavalSocket,
      deps.legacyKavalSocket,
    ),
    padis: assemblePadiInventory(
      padiDaemons,
      // Remote binding: no local padi is kolu's active one, so pass a null active
      // socket — `assemblePadiInventory` then marks none active AND attributes the
      // remote padi's version/commit to nothing (they only annotate the active row).
      boundLocally ? deps.activePadiSocket : null,
      deps.activePadiSurfaceVersion(),
      deps.activePadiBuildCommit(),
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
