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
import { toast } from "solid-sonner";
import { bindingScoped } from "../binding/bindings";
import { createSharedRoot } from "../createSharedRoot";

// W4 "the switch": `bindingScoped` re-keys the sub onto the ACTIVE host's socket, so
// the dialogs never read a boot-binding socket that a switch-away retired (closed).
// The `daemonInventory` cell is kolu-server's own host-independent surface (its
// data describes kolu-server's own machine + bound host — an acceptable-for-scope
// default-host diagnostic), served on every per-host socket; only the socket is
// per-binding. `createSharedRoot` gives `bindingScoped` its reactive owner.
const inventory = createSharedRoot(() =>
  bindingScoped((b) =>
    b.clients.kolu.cells.daemonInventory.use({
      onError: (err) => toast.error(`Daemon inventory error: ${err.message}`),
    }),
  ),
);
const sub = () => inventory()();

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

/** The `padiSurface` version the BOUND padi serves — its honest `hello.surfaceVersion`,
 *  or `null` while unbound / before the first sample (an honest "—", never the binder's
 *  build constant). Reads the bound-session readout (`boundPadi`), so it's correct over
 *  ssh too. Read by the Padi dialog + rail chip's "contract v<x.y>" readout. */
export function activePadiSurfaceVersion(): string | null {
  return sub().value()?.boundPadi?.surfaceVersion ?? null;
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
