/**
 * kolu-server's own view of the host-daemon inventory — the parts only kolu-server
 * knows, off the server-authored `daemonInventory` koluSurface cell (same singleton
 * pattern as `useMemoryUsage.ts`).
 *
 * The BOUND host's daemons are NOT here — they ride padiSurface's `hostInventory`
 * member (see `./useHostInventory`), which works identically local and remote. This
 * cell carries:
 *   - `boundHost` — the ssh host kolu is bound to (or null for a local binding), which
 *     drives the dialogs' machine labels;
 *   - `localScan` — kolu-server's scan of the machine it ITSELF runs on, populated ONLY
 *     under a remote binding (where that machine is not the bound host, so a leak on the
 *     machine you're actually using stays visible); null under a local binding;
 *   - `boundPadi.convergence` — the bound padi's STANDING convergence anomaly off the
 *     binder's own probe (adopted-stale build / contract skew / drain- or link-failure);
 *     there is no per-host wire member for this yet, so it still describes whichever ONE
 *     padi kolu-server happens to be bound to (a padi/server-side gap, out of this fix's
 *     file scope).
 *
 * `boundPadi.surfaceVersion`/`.buildCommit` are NOT read here any more (W4 "the switch"):
 * padi's own build commit/surfaceVersion/boot time now ride its per-host `identity` cell
 * — see `useHostInventory.ts`'s `activePadiIdentity()`/`activePadiStartedAt()`, which
 * re-key on `activeHost` instead of describing the single legacy bind.
 *
 * Honesty (#1034): a field the server couldn't read is `null` here, rendered "—" by the
 * dialogs — never a fabricated value.
 */

import type {
  PadiConvergence,
  RunningKaval,
  RunningPadi,
} from "kolu-common/surface";
import { createRoot } from "solid-js";
import { app } from "../wire";

// HOST-SCOPING: every reader below rides koluSurface's `daemonInventory` cell, which
// `server/src/padi/daemonInventory.ts` populates off the LEGACY single-bind `padiSession` —
// under always-map that session is hardcoded to the unremovable LOCAL default
// (`boundHost: null`, `server/src/index.ts`), so `daemonScanBoundHost`/
// `localScanKavals`/`localScanPadis`/`boundPadiConvergence` all describe the LOCAL bind
// ALWAYS, never the ACTIVE (possibly remote) host selected via `padiMap`/`activeHost`.
// This is HOST-INDEPENDENT-TODAY, not by design: `padiMap`'s per-host entries carry no
// per-host "padi's STANDING convergence" wire member yet (a padi/server-side gap, out of
// this fix's file scope). See the classification table in `PadiInfoDialog.tsx`.
//
// `activePadiSurfaceVersion`/`boundPadiBuildCommit` USED to live here (reading
// `boundPadi.surfaceVersion`/`.buildCommit` off this same cell) — W4 "the switch" moved
// both onto padi's own per-host `identity` cell (`useHostInventory.ts`), which genuinely
// re-keys on `activeHost`. Only the convergence readout remains host-independent-today.
//
// THE LIVE-SUBSCRIPTION FIX: same class as `useMemoryUsage.ts`'s `sub` — a bare
// module-const `.use()` is the cache's "ownerless" path, torn down a microtask after
// load with no owner to hold its listener count above zero (the "build commit —"
// symptom: the cell's real first value never has a live subscriber to land on).
// Wrapped in an app-lifetime `createRoot` so it survives for the session.
const sub = createRoot(() => app.cells.daemonInventory.use());

/** The ssh host kolu-server's padi is bound to (`KOLU_PADI_HOST`), or `null` for a
 *  LOCAL binding / before the first enumeration. When non-null, the machine kolu-server
 *  runs on is NOT the bound host — so the dialogs show its `localScan` as a separate
 *  "this machine, not the bound host" group beside the bound host's own list. */
export function daemonScanBoundHost(): string | null {
  const binding = sub.value()?.binding;
  return binding?.kind === "remote" ? binding.host : null;
}

/** kolu-server's scan of the machine it ITSELF runs on — every running kaval on that
 *  machine, marked NONE active (kolu is bound elsewhere). Non-empty only under a remote
 *  binding; `[]` under a local binding (the bound host's member already covers it — the
 *  `remote`-only discriminant makes a local scan structurally impossible to carry). */
export function localScanKavals(): RunningKaval[] {
  const binding = sub.value()?.binding;
  return binding?.kind === "remote" ? binding.localScan.kavals : [];
}

/** kolu-server's scan of the machine it ITSELF runs on — every running padi on that
 *  machine, marked NONE active. Non-empty only under a remote binding. */
export function localScanPadis(): RunningPadi[] {
  const binding = sub.value()?.binding;
  return binding?.kind === "remote" ? binding.localScan.padis : [];
}

/** The BOUND padi's STANDING convergence anomaly (adopted-stale build / contract skew /
 *  drain-failure / link-failure), or `null` when converged/healthy. The Padi dialog reads
 *  it to show a degraded bind as a visible banner (running vs expected build, the reason) —
 *  the whole point of the dialog: nothing swallowed behind the scenes. Remote arm only; the
 *  local arm's `convergence()` reports `null` today (see `ensurePadiBinding` in
 *  `padiBinding.ts`). */
export function boundPadiConvergence(): PadiConvergence | null {
  return sub.value()?.boundPadi?.convergence ?? null;
}
