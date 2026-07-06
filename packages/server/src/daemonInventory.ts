/**
 * The web shell's host-daemon inventory publisher — the sole writer of koluSurface's
 * `daemonInventory` cell that the Kaval + Padi info dialogs read.
 *
 * The BOUND host's daemons no longer live here: padi serves its OWN host's running
 * kaval + padi daemons on `padiSurface.hostInventory` (the one scanner, homed in
 * @kolu/padi), and that member rides the re-served surface straight to the client — so
 * the dialog's bound-host list works identically whether kolu-server is bound locally
 * or over ssh. This cell carries what only kolu-server knows:
 *
 *   - `boundHost` — the ssh host kolu is bound to (`KOLU_PADI_HOST`), or null for a
 *     local binding. It drives the dialog's machine labels.
 *   - `localScan` — kolu-server's scan of the machine it ITSELF runs on, populated ONLY
 *     under a REMOTE binding (where that machine is not the bound host, so a leaked
 *     daemon on the machine you're actually using would otherwise be invisible). Under a
 *     LOCAL binding this is null: the bound padi's `hostInventory` member already
 *     describes this same machine, and a second copy would show two lists for one truth.
 *     The scan reuses @kolu/padi's `enumerateHostDaemons` (the SAME implementation the
 *     member is served with) and marks NONE active — kolu is bound elsewhere.
 *   - `boundPadi` — the bound padi's honest `surfaceVersion` / `buildCommit` off its
 *     control-core `hello` (works over ssh, where no local padi is kolu's active one),
 *     plus a STANDING convergence anomaly (adopted-stale / skew / drain-fail / link-fail)
 *     so a degraded bind is a visible dialog state, not a swallowed log.
 *
 * STRICTLY READ-ONLY: `enumerateHostDaemons` scans the runtime dir, reads gate pids, and
 * best-effort probes each kaval; it NEVER spawns, writes, kills, or reaps.
 */

import type { KavalProbe, PadiDaemon } from "@kolu/padi/assembly";
import { enumerateHostDaemons } from "@kolu/padi/assembly";
import type { HostDaemonInventory } from "@kolu/padi/surface";
import type { KavalDaemon } from "kaval";
import type {
  DaemonBinding,
  DaemonInventory,
  PadiConvergence,
} from "kolu-common/surface";
import { log } from "./log.ts";

/** The reads the publisher assembles through — injected so the wiring is one call and a
 *  test can drive it without a real host. `getLocalScan` reads the SHARED local-machine
 *  scan (only under a remote binding); the `activePadi*` readouts are the bound session's
 *  honest identity; `publish` sets the cell. All reads are cached/sync — no scan here. */
export interface DaemonInventoryDeps {
  /** The SHARED local-machine daemon scan (kolu-server's OWN box) — READ, not run, here:
   *  the box is the same for every remote entry, so one {@link startSharedLocalDaemonScan}
   *  owns the scan and every per-host cell reads its cached result. `null` before the
   *  first shared scan lands (then the shared scan's subscribers re-publish). Consulted
   *  ONLY under a remote binding. */
  getLocalScan: () => HostDaemonInventory | null;
  /** The ssh host the bound padi lives on (`KOLU_PADI_HOST`), or `null` for a LOCAL
   *  binding — the SINGLE source for both "is this a remote bind?" and the dialog label.
   *  When non-null the bound padi lives on ANOTHER host, so the cell carries the shared
   *  local-machine scan as `localScan`; when null the bound padi's `hostInventory` member
   *  already covers this machine, so `localScan` stays null (no duplicate list). */
  boundHost: string | null;
  /** The bound padi's honest `surfaceVersion` off its control-core `hello`, or `null`
   *  while unbound — read fresh each tick so a (re)bind updates it. */
  activePadiSurfaceVersion: () => string | null;
  /** The bound padi's honest navigable git `commit` off its control-core `hello`, or
   *  `null` while unbound / a survivor padi predating the field — read fresh each tick. */
  activePadiBuildCommit: () => string | null;
  /** The bound padi's STANDING convergence anomaly (adopted-stale build / contract skew /
   *  drain-failure / link-failure), or `null` when converged/healthy — read fresh each tick
   *  off the bound session's `convergence()` (the `DaemonSession` member). Published onto
   *  `boundPadi.convergence` so
   *  the Padi dialog surfaces a degraded bind as a visible state, not a swallowed log. */
  activePadiConvergence: () => PadiConvergence | null;
  /** Publish the assembled inventory — `koluSurfaceCtx.cells.daemonInventory.set`. */
  publish: (inv: DaemonInventory) => void;
}

/** The EMPTY local scan a remote entry carries before the shared scan's first tick lands
 *  (then a subscriber re-publish fills it in). Never active — a remote binding owns no
 *  local daemon. */
const EMPTY_LOCAL_SCAN: HostDaemonInventory = { kavals: [], padis: [] };

/** Assemble + publish one reading: under a REMOTE binding, carry the SHARED local-machine
 *  scan (read from cache, never run here) as `localScan`; always read the bound padi's
 *  honest identity + convergence into `boundPadi`; set the cell. SYNC — the only work is
 *  reading cached values; the `publish` schema-validate can still throw, which the caller
 *  handles. */
export function enumerateDaemonInventoryOnce(deps: DaemonInventoryDeps): void {
  // The binding + (remote-only) own-machine scan, as ONE discriminated value so the
  // coupling is a type, not a convention: a LOCAL binding carries no scan (the bound
  // padi's `hostInventory` member already describes this machine — a second copy would
  // duplicate it), and a REMOTE binding ALWAYS carries both its host and the scan. The
  // scan is the SHARED reading (marking NONE active — a remote binding owns no local
  // daemon, so a stray local kaval/padi is listed — leak visible — but never labelled
  // "in use by kolu"). `boundHost === null` is the sole local/remote signal.
  const binding: DaemonBinding =
    deps.boundHost === null
      ? { kind: "local" }
      : {
          kind: "remote",
          host: deps.boundHost,
          localScan: deps.getLocalScan() ?? EMPTY_LOCAL_SCAN,
        };
  // The BOUND padi's honest identity (both arms) — read ONCE off the session's hello
  // readouts (works over ssh: no local padi is `active` under a remote binding).
  const padiSurfaceVersion = deps.activePadiSurfaceVersion();
  const padiBuildCommit = deps.activePadiBuildCommit();
  const padiConvergence = deps.activePadiConvergence();
  deps.publish({
    binding,
    // The Padi dialog's version + build-commit rows read THIS, so they work over ssh even
    // though no LOCAL padi is `active` under a remote binding. Plus a STANDING convergence
    // anomaly (adopted-stale / skew / drain-fail / link-fail) so a degraded bind is a
    // visible dialog state, not a swallowed log. `null` only when there is NOTHING to say —
    // no identity AND no convergence reason (converged-unbound / pre-enumeration); a
    // refused/failed bind has a reason but no adopted identity, so it stays non-null.
    boundPadi:
      padiSurfaceVersion === null &&
      padiBuildCommit === null &&
      padiConvergence === null
        ? null
        : {
            surfaceVersion: padiSurfaceVersion,
            buildCommit: padiBuildCommit,
            convergence: padiConvergence,
          },
  });
}

/** Cadence of the inventory readout. Coarser than the 5s memory tick — the binding
 *  state + local daemon set change rarely, and a remote tick dials every local kaval,
 *  so a 10s poll is plenty live without chattering. */
export const DAEMON_INVENTORY_SAMPLE_INTERVAL_MS = 10_000;

/** The shared local-machine daemon scan (5a): kolu-server's OWN box is the same for every
 *  remote pool entry, so scanning it once and sharing the result is the single-writer
 *  shape — N per-host samplers each re-scanning it is N writers of one fact (a P3
 *  violation, not just waste). One owner runs the read-only scan (marking NONE active —
 *  kolu is bound elsewhere), caches the latest, and notifies subscribers so each per-host
 *  cell re-publishes with the fresh scan. */
export interface SharedLocalDaemonScan {
  /** The latest cached scan, or `null` before the first completes. */
  get(): HostDaemonInventory | null;
  /** Subscribe to scan updates; the returned fn unsubscribes. */
  subscribe(onScan: () => void): () => void;
  /** Stop the interval + drop subscribers (server shutdown / no remote entries). */
  dispose(): void;
}

/** Start the shared local-machine scan. Fires once immediately (a T+0 anchor), then every
 *  {@link DAEMON_INVENTORY_SAMPLE_INTERVAL_MS}. Non-overlapping (a slow scan never doubles
 *  up) and `unref`'d so it never holds the process open on its own. */
export function startSharedLocalDaemonScan(deps: {
  discoverKavals: () => KavalDaemon[];
  discoverPadis: () => PadiDaemon[];
  probe: (socket: string) => Promise<KavalProbe>;
}): SharedLocalDaemonScan {
  let latest: HostDaemonInventory | null = null;
  const subscribers = new Set<() => void>();
  let inFlight = false;
  const tick = async (): Promise<void> => {
    if (inFlight) return; // non-overlapping — a slow scan never doubles up
    inFlight = true;
    try {
      latest = await enumerateHostDaemons({
        discoverKavals: deps.discoverKavals,
        discoverPadis: deps.discoverPadis,
        probe: deps.probe,
        activeKavalSocket: null,
        activeKavalAtLegacy: false,
        activePadiSocket: null,
      });
      for (const cb of [...subscribers]) cb();
    } catch (err) {
      // A discovery fs-walk / probe can throw; keep the last scan, log, retry next tick.
      log.error({ err }, "shared local daemon scan failed");
    } finally {
      inFlight = false;
    }
  };
  void tick();
  const interval = setInterval(
    () => void tick(),
    DAEMON_INVENTORY_SAMPLE_INTERVAL_MS,
  );
  interval.unref();
  return {
    get: () => latest,
    subscribe: (onScan) => {
      subscribers.add(onScan);
      return () => {
        subscribers.delete(onScan);
      };
    },
    dispose: () => {
      clearInterval(interval);
      subscribers.clear();
    },
  };
}
