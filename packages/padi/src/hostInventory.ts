/**
 * The host-daemon inventory scanner — the ONE implementation that enumerates every
 * running kaval + padi on a host, best-effort probes each kaval, and assembles the
 * shared-leaf {@link RunningKaval}/{@link RunningPadi} rows the Kaval + Padi info
 * dialogs list. padi OWNS the daemon domain (it discovers, adopts, and supervises
 * the host's daemons), so the scanner lives here — and two callers reuse it:
 *
 *   1. padi itself, for the `hostInventory` surface member it serves ({@link
 *      startPadiHostInventorySampler}) — its scan of its OWN host, marking the kaval
 *      it holds + itself `active`. This is what lets the dialog show the BOUND host's
 *      daemons even when kolu-server reaches padi over ssh: the member rides the
 *      re-served surface, so the list works identically local and remote.
 *   2. kolu-server's web shell, for the LOCAL-machine scan it publishes on
 *      koluSurface's `daemonInventory.localScan` under a REMOTE binding (the machine
 *      the browser is actually using is not the bound host). It runs {@link
 *      enumerateHostDaemons} with NO active socket — kolu is bound elsewhere, so no
 *      local daemon is "in use by kolu".
 *
 * STRICTLY READ-ONLY. It reuses the SAME discovery `kaval-tui`/`padi-tui` use
 * (`discoverKavalDaemons` / `discoverPadiDaemons` — scan the runtime dir, read each
 * gate `.pid`, read the `state-root` manifest) and, for each kaval, a best-effort
 * `system.version` + `terminal.list` status probe over a short-lived client. It NEVER
 * spawns, writes, kills, or reaps — no path here touches a daemon's lifecycle.
 */

import {
  type UnixSocketConnection,
  unixSocketLink,
} from "@kolu/surface/links/unix-socket";
import type {
  RunningKaval,
  RunningPadi,
} from "@kolu/terminal-workspace/schema";
import {
  type KavalDaemon,
  discoverKavalDaemons,
  type ptyHostSurface,
} from "kaval";
import { currentPadiCommitHash } from "./buildId.ts";
import { log } from "./log.ts";
import { padiSurfaceCtx } from "./padiSurfaceCtx.ts";
import { LOCAL_HOST_ID } from "./ptyHost/index.ts";
import { readDaemonStatus } from "./ptyHost/daemonStatus.ts";
import {
  type PadiDaemon,
  discoverPadiDaemons,
  padiKavalSocketPath,
} from "./stateRoot.ts";
import { PADI_SURFACE_VERSION, type PadiHostInventory } from "./surface.ts";

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
 * best-effort status probes (keyed by socket), the socket the scanning host's padi
 * actually HOLDS (or `null` — no daemon here is kolu's, e.g. a local-machine scan under
 * a remote binding), and whether that held socket is the pre-padi LEGACY address.
 *
 * `active` is decided by SOCKET IDENTITY against the held socket — exactly the
 * padi-held kaval reads "in use by kolu", even when that is the legacy-port address
 * after an upgrade adoption. `atLegacyAddress` marks that adopted-at-the-old-address
 * case (the caller passes `activeAtLegacy` — the held socket is NOT padi's digest
 * address, so it is an adopted `kaval-<port>/` padi wrote a manifest into on a W2.2
 * upgrade): a KNOWN converging state, not a leak. Only ever true together with `active`.
 * A `port`-kind kaval that is NOT the held one stays the genuine stray/leak (flagged via
 * its `kind` in the dialog). A probe absent for a socket folds to all-`null` fields
 * (honesty #1034).
 */
export function assembleKavalInventory(
  daemons: readonly KavalDaemon[],
  probes: ReadonlyMap<string, KavalProbe>,
  activeSocket: string | null,
  activeAtLegacy: boolean,
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
      // Only the HELD kaval sitting at the pre-padi legacy `kaval-<port>/` address — an
      // adoption (padi holds a non-digest socket) that converges onto the digest address
      // on the next restart/reboot. A NON-held daemon is never kolu's converging one.
      atLegacyAddress: active && activeAtLegacy,
    };
  });
}

/**
 * PURE: assemble `RunningPadi[]` from discovered padi daemons, the socket of the padi
 * the scanning host's kolu owns (or `null`), and that padi's honest `surfaceVersion` +
 * `buildCommit`.
 *
 * `active` is decided by SOCKET IDENTITY. Only the ACTIVE padi gets a `surfaceVersion`
 * and `buildCommit` — the serving padi knows its OWN identity directly (its baked
 * `PADI_SURFACE_VERSION` / `PADI_COMMIT_HASH`); a discovered-but-not-owned padi reads
 * `null` (not probed), the honest "unknown".
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

/** The seams the scanner reads through — injected so a test can drive it without a
 *  real host. `discover*` are the read-only enumerators; `probe` is the best-effort
 *  kaval status probe; the `active*` values mark which daemons the scanning host's
 *  kolu owns (all `null`/absent for a local-machine scan under a remote binding, where
 *  no local daemon is kolu's). */
export interface HostDaemonScanDeps {
  discoverKavals: () => KavalDaemon[];
  discoverPadis: () => PadiDaemon[];
  probe: (socket: string) => Promise<KavalProbe>;
  /** The kaval socket the scanning host's padi HOLDS (marked `active`), or `null` when
   *  no kaval here is kolu's. */
  activeKavalSocket: string | null;
  /** Whether the held kaval sits at the pre-padi LEGACY address (padi adopted a
   *  `kaval-<port>/` on upgrade) rather than its digest address — drives the active
   *  row's `atLegacyAddress` "converging" hint. `false` when no kaval here is kolu's. */
  activeKavalAtLegacy: boolean;
  /** The padi socket the scanning host's kolu owns (marked `active`), or `null`. */
  activePadiSocket: string | null;
  /** The active padi's own `padiSurface` version — annotates the active padi row. */
  activePadiSurfaceVersion: string | null;
  /** The active padi's own navigable git commit — annotates the active padi row. */
  activePadiBuildCommit: string | null;
}

/** Take one read-only reading of the host-daemon inventory: discover every kaval +
 *  padi, probe each kaval socket in parallel (best-effort), and assemble the marked
 *  rows. Never throws — each probe folds its own failure to the empty probe. Pure of
 *  side effects (it does not publish) — the caller decides where the reading goes. */
export async function enumerateHostDaemons(
  deps: HostDaemonScanDeps,
): Promise<PadiHostInventory> {
  const kavalDaemons = deps.discoverKavals();
  const padiDaemons = deps.discoverPadis();
  const probeEntries = await Promise.all(
    kavalDaemons.map(
      // A probe that throws folds to the empty probe — an honest per-row "unknown"
      // (#1034), never a dropped row and never a rejected scan. `probeKavalStatus`
      // already never throws; this keeps the guarantee total for ANY probe seam.
      async (d) =>
        [
          d.socket,
          await deps.probe(d.socket).catch(() => EMPTY_PROBE),
        ] as const,
    ),
  );
  const probes = new Map(probeEntries);
  return {
    kavals: assembleKavalInventory(
      kavalDaemons,
      probes,
      deps.activeKavalSocket,
      deps.activeKavalAtLegacy,
    ),
    padis: assemblePadiInventory(
      padiDaemons,
      deps.activePadiSocket,
      deps.activePadiSurfaceVersion,
      deps.activePadiBuildCommit,
    ),
  };
}

/** Cadence of padi's host-inventory readout. Coarser than the 5s memory tick — the
 *  daemon set changes rarely (only on a spawn/adopt/leak), and each tick dials every
 *  kaval, so a 10s poll is plenty live without chattering. */
export const HOST_INVENTORY_SAMPLE_INTERVAL_MS = 10_000;

/** Resolve the kaval THIS padi holds — its live endpoint's `socketPath` (the
 *  authoritative address padi actually adopted/spawned) and whether that address is the
 *  pre-padi LEGACY one (an adopted `kaval-<port>/`) rather than padi's digest address.
 *  Falls back to the digest address when no daemon status is known yet (pre-connect) —
 *  which is by definition NOT a legacy adoption. Either way, `assembleKavalInventory`
 *  only marks the socket `active` if it appears in the discovered set, so a socket with
 *  no live daemon marks nothing. */
function heldKaval(stateRoot: string): { socket: string; atLegacy: boolean } {
  const digest = padiKavalSocketPath(stateRoot);
  const held = readDaemonStatus(LOCAL_HOST_ID)?.socketPath ?? null;
  return {
    socket: held ?? digest,
    // padi holds a non-digest socket ⟹ it adopted a legacy `kaval-<port>/` (padi wrote a
    // state-root manifest into it, so discovery labels it `kolu @ …`, kind `stateRoot` —
    // the socket address, not the kind, is what marks it the converging legacy one).
    atLegacy: held !== null && held !== digest,
  };
}

/** Start padi's periodic host-inventory sampler — the sole writer of the
 *  `hostInventory` surface cell. Scans THIS padi's host and marks the kaval it holds +
 *  itself `active`, so the re-served member hands the dialog the bound host's daemons
 *  (identically local and remote). Fires once immediately (a T+0 anchor so the cell has
 *  a value before the first dialog open), then every {@link
 *  HOST_INVENTORY_SAMPLE_INTERVAL_MS}. Non-overlapping (a slow tick never doubles up)
 *  and `unref`'d so the interval never holds padi's process open on its own. */
export function startPadiHostInventorySampler(opts: {
  /** THIS padi's own rendezvous socket — the padi row it marks `active`. */
  padiSocket: string;
  /** THIS padi's resolved state-root — resolves the held-kaval fallback address. */
  stateRoot: string;
}): void {
  // padi's own build is a boot constant (`||` not `??`: off-nix the commit is "",
  // which reads as the honest "—", not null-that-means-something-else).
  const buildCommit = currentPadiCommitHash() || null;
  const sampleOnce = async (): Promise<void> => {
    const held = heldKaval(opts.stateRoot);
    const inv = await enumerateHostDaemons({
      discoverKavals: discoverKavalDaemons,
      discoverPadis: discoverPadiDaemons,
      probe: probeKavalStatus,
      activeKavalSocket: held.socket,
      activeKavalAtLegacy: held.atLegacy,
      activePadiSocket: opts.padiSocket,
      activePadiSurfaceVersion: PADI_SURFACE_VERSION,
      activePadiBuildCommit: buildCommit,
    });
    padiSurfaceCtx.cells.hostInventory.set(inv);
  };

  let inFlight = false;
  const tick = (): void => {
    if (inFlight) return;
    inFlight = true;
    void sampleOnce()
      .catch((err) => {
        // enumerateHostDaemons never throws (each probe folds its own failure), but a
        // surprise (a discovery read blowing up) must be legible, not swallowed into a
        // silently missing cell. The cell keeps its last value; the next tick retries.
        log.error({ err }, "host-inventory sample failed");
      })
      .finally(() => {
        inFlight = false;
      });
  };
  tick();
  setInterval(tick, HOST_INVENTORY_SAMPLE_INTERVAL_MS).unref();
}
