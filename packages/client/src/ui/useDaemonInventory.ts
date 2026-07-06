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
 *   - `boundPadi` — the bound padi's honest surfaceVersion / buildCommit / convergence
 *     off its control-core hello (works over ssh, where no local padi is active).
 *
 * Honesty (#1034): a field the server couldn't read is `null` here, rendered "—" by the
 * dialogs — never a fabricated value.
 */

import type {
  PadiConvergence,
  RunningKaval,
  RunningPadi,
} from "kolu-common/surface";
import { subErrorToast, useBindingScopedSub } from "../binding/bindings";

// W4 "the switch": the `daemonInventory` cell is now built PER HOST (A1) — each host's
// router serves its OWN binding + bound-padi identity/convergence, sampled from THAT
// entry's `session.identity()`/`convergence()`. `useBindingScopedSub` re-keys the sub
// onto the active binding on a switch, so the dialogs read the ACTIVE host's inventory,
// not the boot default's. (`binding`/`localScan` describe kolu-server's OWN machine — the
// same box for every host — but are now scoped per entry, so the label is the host's own.)
const inventory = useBindingScopedSub((b) =>
  b.clients.kolu.cells.daemonInventory.use({
    onError: subErrorToast("Daemon inventory error"),
  }),
);
const sub = () => inventory();

// The bound padi's own self-declared surface version rides padi's OWN per-host `version`
// cell (A1) — read it directly rather than through kolu-server's derived daemonInventory
// readout, so the rail chip's "contract v<x.y>" is the padi's authoritative declaration.
const padiVersion = useBindingScopedSub((b) =>
  b.clients.padi.cells.version.use({
    onError: subErrorToast("Padi version error"),
  }),
);

/** The ssh host kolu-server's padi is bound to (`KOLU_PADI_HOST`), or `null` for a
 *  LOCAL binding / before the first enumeration. When non-null, the machine kolu-server
 *  runs on is NOT the bound host — so the dialogs show its `localScan` as a separate
 *  "this machine, not the bound host" group beside the bound host's own list. */
export function daemonScanBoundHost(): string | null {
  const binding = sub().value()?.binding;
  return binding?.kind === "remote" ? binding.host : null;
}

/** kolu-server's scan of the machine it ITSELF runs on — every running kaval on that
 *  machine, marked NONE active (kolu is bound elsewhere). Non-empty only under a remote
 *  binding; `[]` under a local binding (the bound host's member already covers it — the
 *  `remote`-only discriminant makes a local scan structurally impossible to carry). */
export function localScanKavals(): RunningKaval[] {
  const binding = sub().value()?.binding;
  return binding?.kind === "remote" ? binding.localScan.kavals : [];
}

/** kolu-server's scan of the machine it ITSELF runs on — every running padi on that
 *  machine, marked NONE active. Non-empty only under a remote binding. */
export function localScanPadis(): RunningPadi[] {
  const binding = sub().value()?.binding;
  return binding?.kind === "remote" ? binding.localScan.padis : [];
}

/** The `padiSurface` version the ACTIVE host's bound padi serves — its own per-host
 *  `version` cell (`contractVersion`), or `null` before the first yield (an honest "—").
 *  Per-host by construction (padi's own re-served cell), so it's correct over ssh too.
 *  Read by the Padi dialog + the rail chip's "contract v<x.y>" readout. */
export function activePadiSurfaceVersion(): string | null {
  return padiVersion().value()?.contractVersion ?? null;
}

/** The BOUND padi's honest navigable git build commit off its `hello`, or `null` while
 *  unbound / a survivor predating the field. Like {@link activePadiSurfaceVersion}, reads
 *  the bound-session readout so the Padi dialog's build-commit row works over ssh. */
export function boundPadiBuildCommit(): string | null {
  return sub().value()?.boundPadi?.buildCommit ?? null;
}

/** The BOUND padi's STANDING convergence anomaly (adopted-stale build / contract skew /
 *  drain-failure / link-failure), or `null` when converged/healthy. The Padi dialog reads
 *  it to show a degraded bind as a visible banner (running vs expected build, the reason) —
 *  the whole point of the dialog: nothing swallowed behind the scenes. Remote arm only; the
 *  local arm's `convergence()` reports `null` today (see `ensurePadiBinding` in
 *  `padiBinding.ts`). */
export function boundPadiConvergence(): PadiConvergence | null {
  return sub().value()?.boundPadi?.convergence ?? null;
}
