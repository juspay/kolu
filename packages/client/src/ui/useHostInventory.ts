/**
 * The BOUND host's running kaval + padi daemons — the "Running daemons" list the
 * Kaval + Padi info dialogs show for the machine kolu-server is bound to — AND (W4
 * "the switch") the ACTIVE host's own padi identity (build commit / surfaceVersion /
 * boot time).
 *
 * `hostInventory` rides padiSurface's `hostInventory` cell (padi scans its OWN host
 * and serves the result), re-served straight to this client — so the list describes
 * the bound host identically whether kolu-server reaches padi locally or over ssh.
 * That is the whole point of the member: before it, the dialog could only show the
 * machine kolu-server runs on, never the machine you're actually using when bound
 * remotely.
 *
 * `identity` rides padiSurface's `identity` cell (padi is the SOLE authority on its
 * own build commit/surfaceVersion/boot time — the per-host twin of its control-core
 * `hello`). Before this cell existed, the dialog's commit/version/uptime rode the
 * single legacy bind (`daemonInventory.boundPadi` / koluSurface's `processStartedAt`),
 * which only ever described whichever ONE padi kolu-server happened to be bound to —
 * a wrong-host lie the instant a REMOTE host was active. Both readouts re-key when
 * the active host switches (`useEntry(activeHost)`).
 *
 * kolu-server's OWN machine (a leak diagnostic under a remote binding) is a SEPARATE
 * list — koluSurface's `daemonInventory.localScan`, in `./useDaemonInventory`.
 */

import type { PadiIdentity } from "@kolu/padi/surface";
import type { RunningKaval, RunningPadi } from "kolu-common/surface";
import { createRoot } from "solid-js";
import { toast } from "solid-sonner";
import { daemonChannelLive } from "../kaval/useDaemonStatus";
import { activeHost, padiMap } from "../wire";
import { hostInventoryLive } from "./hostInventoryLive";

// A host-scoped standing readout — rides `useEntry(activeHost)` under an app-scope
// `createRoot` (module-lifetime), so it re-keys when the active host switches.
const sub = createRoot(() =>
  padiMap.useEntry(activeHost).cells.hostInventory.use({
    onError: (err: Error) =>
      toast.error(`Host inventory error: ${err.message}`),
  }),
);

// padi's OWN identity — same host-scoped `useEntry(activeHost)` idiom, its own
// standing subscription (a distinct cell from `hostInventory` above).
const identitySub = createRoot(() =>
  padiMap.useEntry(activeHost).cells.identity.use({
    onError: (err: Error) => toast.error(`Padi identity error: ${err.message}`),
  }),
);

/** The ACTIVE host's own padi identity — its DECLARED build commit (`null` is a
 *  genuine fact padi itself declared: a dev/off-nix build with no commit — never a
 *  placeholder for "not arrived yet"), padiSurface version, and RAW (foreign-clock)
 *  boot epoch. `undefined` until the cell's first frame lands: THIS is the pending
 *  state a render site must fold into "warming" — never synthesize a dash for it by
 *  reading `?.commit` off an absent identity (see `padiPresentation.ts`'s
 *  `toPadiPresence`, which takes this whole value so "pending" (undefined) and
 *  "declared no commit" (`{ commit: null, ... }`) can never be conflated into one
 *  `??`). Use {@link activePadiStartedAt} for the CLOCK-REPROJECTED boot time — never
 *  read `.startedAt` off this directly for an uptime computation. */
export function activePadiIdentity(): PadiIdentity | undefined {
  return identitySub.value();
}

/** The ACTIVE host's padi boot time, reprojected onto the BROWSER's clock via the
 *  entry's `clock.toLocal` — padi's `identity.startedAt` is stamped on padi's OWN
 *  clock (a RAW foreign epoch for any host but the local one), so computing
 *  `browserNow − rawStartedAt` directly would mix two clocks and report a bogus
 *  uptime under skew (the exact metadata-boundary bug `useDaemonStatus.ts`'s
 *  `localDaemonStatus` already fixes for `daemonStatus.startedAt` — this mirrors it
 *  for padi's own identity cell). `null` before the identity cell's first frame, or
 *  while the entry has no clock-offset sample yet (host still warming) — the
 *  PadiInfoDialog's uptime row gates on this exactly like the retired
 *  `useProcessUptime.padiStartedAt` did. */
export function activePadiStartedAt(): number | null {
  const raw = identitySub.value()?.startedAt;
  if (raw === undefined) return null;
  return padiMap.entry(activeHost()).clock.toLocal(raw) ?? null;
}

/** Every running kaval daemon on the BOUND host, each marked `active` when that host's
 *  padi owns it (empty before the first scan). */
export function boundHostKavals(): RunningKaval[] {
  return sub.value()?.kavals ?? [];
}

/** Every running padi daemon on the BOUND host, each marked `active` when it is the one
 *  kolu is bound to (empty before the first scan). */
export function boundHostPadis(): RunningPadi[] {
  return sub.value()?.padis ?? [];
}

/** Whether the bound host's inventory is a TRUSTWORTHY live reading the dialog may render
 *  as a definite answer — the conjunction of (a) the bound padi being LIVE and (b) it
 *  having reported a real frame (its own active padi row). Not (a): a dropped ssh link /
 *  drain window leaves the re-served cell STALE (held populated) — reading it as live
 *  would show a dead padi's list as current (#1034); the bind-liveness fact excludes it.
 *  Not (b): a just-connected bind before its first frame is the seeded empty default. So
 *  the dialogs read "unavailable" for BOTH, never "No running daemons" (a masquerade).
 *  See {@link hostInventoryLive}. */
export function boundHostInventoryLive(): boolean {
  return hostInventoryLive({
    // kolu's honest bind-liveness fact for the ACTIVE host's inventory (this cell rides
    // `useEntry(activeHost)`): the browser transport ∧ the active entry's own connection
    // (`daemonChannelLive` — so a dead entry's frozen re-served inventory is not read as
    // live, whether that entry is a REMOTE ssh flap or a LOCAL `daemon.restart` drain — the
    // #1568 leg the dot floors on, W4 daemon-rail unification: one fact, every host).
    bindLive: daemonChannelLive(),
    padis: boundHostPadis(),
  });
}

/** The BOUND padi kolu is using (`active`), or `undefined` before the first scan. The
 *  Padi dialog reads its `socket` for the socket detail row under a LOCAL binding (under
 *  a remote binding the socket is a path on the ssh host, so the dialog names the host
 *  instead). */
export function activePadi(): RunningPadi | undefined {
  return boundHostPadis().find((p) => p.active);
}
