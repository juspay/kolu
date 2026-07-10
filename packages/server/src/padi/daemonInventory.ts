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

import { enumerateHostDaemons } from "@kolu/padi/assembly";
import type { KavalProbe, PadiDaemon } from "@kolu/padi/assembly";
import type { KavalDaemon } from "kaval";
import type {
  DaemonBinding,
  DaemonInventory,
  PadiConvergence,
} from "kolu-common/surface";
import { log } from "../log.ts";

/** The seams the publisher reads/writes through — injected so the wiring is one call
 *  and a test can drive it without a real host. `discover*`/`probe` are the read-only
 *  scan seams (used only for the LOCAL scan under a remote binding); the `activePadi*`
 *  readouts are the bound session's honest identity; `publish` sets the cell. */
export interface DaemonInventoryDeps {
  /** Read-only discovery of every running kaval daemon (`discoverKavalDaemons`). */
  discoverKavals: () => KavalDaemon[];
  /** Read-only discovery of every running padi daemon (`discoverPadiDaemons`). */
  discoverPadis: () => PadiDaemon[];
  /** Best-effort read-only status probe of a kaval socket. */
  probe: (socket: string) => Promise<KavalProbe>;
  /** The ssh host the bound padi lives on (`KOLU_PADI_HOST`), or `null` for a LOCAL
   *  binding — the SINGLE source for both "is this a remote bind?" and the dialog label.
   *  When non-null the bound padi lives on ANOTHER host, so kolu-server scans its OWN
   *  machine into `localScan`; when null the bound padi's `hostInventory` member already
   *  covers this machine, so `localScan` stays null (no duplicate list). */
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

/** Take one read-only reading and publish it: under a REMOTE binding, scan the local
 *  machine (marking nothing active) into `localScan`; always read the bound padi's honest
 *  identity + convergence into `boundPadi`; set the cell. Each PROBE folds its own failure
 *  to the empty probe, but this is NOT total — a discovery fs-walk, a session readout, or
 *  the `publish` schema-validate can throw; the sampler's `.catch` makes that legible. */
export async function enumerateDaemonInventoryOnce(
  deps: DaemonInventoryDeps,
): Promise<void> {
  // The binding + (remote-only) own-machine scan, as ONE discriminated value so the
  // coupling is a type, not a convention: a LOCAL binding carries no scan (the bound
  // padi's `hostInventory` member already describes this machine — a second copy would
  // duplicate it), and a REMOTE binding ALWAYS carries both its host and the scan. The
  // scan runs ONLY in the remote branch, marking NONE active (a remote binding owns no
  // local daemon, so a stray local kaval/padi is listed — leak visible — but never
  // labelled "in use by kolu"). `boundHost === null` is the sole local/remote signal.
  const binding: DaemonBinding =
    deps.boundHost === null
      ? { kind: "local" }
      : {
          kind: "remote",
          host: deps.boundHost,
          localScan: await enumerateHostDaemons({
            discoverKavals: deps.discoverKavals,
            discoverPadis: deps.discoverPadis,
            probe: deps.probe,
            activeKavalSocket: null,
            activeKavalAtLegacy: false,
            activePadiSocket: null,
          }),
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

/** Start the periodic inventory publisher. Fires once immediately (a T+0 anchor so the
 *  cell has a value before the first dialog open), then every {@link
 *  DAEMON_INVENTORY_SAMPLE_INTERVAL_MS}. Non-overlapping (a slow tick never doubles up)
 *  and `unref`'d so the interval never holds the process open on its own. An optional
 *  `subscribeResample` force-samples on a signal (padi (re)bind), so the bound padi's
 *  `surfaceVersion` and convergence banner refresh at once. */
export function startDaemonInventorySampler(
  deps: DaemonInventoryDeps,
  subscribeResample?: (resample: () => void) => void,
): void {
  let inFlight = false;
  let pending = false;
  const tick = (): void => {
    // A resample that lands while a prior enumeration is in flight (a bind-state transition
    // firing `padiSession.onState` mid-tick — e.g. an adopt-stale / skew / link-failure) must
    // NOT be dropped, else the fresh `boundPadi.convergence` banner waits for the next COARSE
    // interval. Coalesce it: mark pending, and re-run ONCE when the in-flight tick settles.
    if (inFlight) {
      pending = true;
      return;
    }
    inFlight = true;
    void enumerateDaemonInventoryOnce(deps)
      .catch((err) => {
        // Each PROBE folds its own failure, but the surrounding readout is NOT total — a
        // remote-arm discovery fs-walk, a `publish` schema-validate, or a session readout
        // can throw. That surprise must be LEGIBLE, not an unlogged unhandled rejection
        // that silently reverts the cell to its local default (and drops the local-scan
        // leak diagnostic). The cell keeps its last value; the next tick retries. Mirrors
        // the padi sampler's own `.catch` (`@kolu/padi`'s `hostInventory.ts`).
        log.error({ err }, "daemon-inventory sample failed");
      })
      .finally(() => {
        inFlight = false;
        if (pending) {
          pending = false;
          tick();
        }
      });
  };
  tick();
  setInterval(tick, DAEMON_INVENTORY_SAMPLE_INTERVAL_MS).unref();
  subscribeResample?.(tick);
}
