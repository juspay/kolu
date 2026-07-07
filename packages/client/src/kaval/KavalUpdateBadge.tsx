/** The amber "⬆ update" nudge chip + kolu's accessor for "the running kaval
 *  daemon is a build behind the kaval the server would spawn" (B3.4 — currency).
 *
 *  Mirrors {@link StaleBadge}'s shape — a passive chip gated by an accessor. It
 *  lives INSIDE the rail's kaval-column button (a `<span>`, not a nested button),
 *  so a click opens `KavalInfoDialog` — where the session-preserving Restart-kaval
 *  action already lives (its inline confirm + the running-vs-expected detail).
 *  Routing the destructive recycle through the dialog (not a cramped rail
 *  inline-confirm) keeps the rail a glanceable strip and reuses `RestartKavalButton`
 *  unchanged.
 *
 *  The derivation ({@link kavalStale}) is a read-site join of two raw facts —
 *  `expected` (padi's `status.expectedKaval`) and `reported` (the connected
 *  daemon's `daemonStatus.identity`) — never stored, never folded into the
 *  client-vs-server `≠ srv` signal (which stays the commit comparison). */

import type { PadiStatus } from "@kolu/padi/surface";
import { type Component, createRoot } from "solid-js";
import { toast } from "solid-sonner";
import { activeHost, padiMap } from "../wire";
import { kavalStale } from "./kavalCurrency";
import { daemonChannelLive, localDaemonStatus } from "./useDaemonStatus";

// A module-level standing subscription to padi's `status` cell (the same pattern
// useDaemonStatus uses for the daemonStatus collection). The `expectedKaval` axis
// rides HERE now — it left the surface-app `buildInfo` cell in W1.R7 so a kaval
// read no longer crosses `packages/server`. Read-only; padi seeds it once at boot.
// A host-scoped standing readout — rides `useEntry(activeHost)` under an app-scope
// `createRoot` (module-lifetime), so it re-keys when the active host switches.
const padiStatus = createRoot(() =>
  padiMap.useEntry(activeHost).cells.status.use({
    onError: (err: Error) => toast.error(`Kaval status error: ${err.message}`),
  }),
);

/** The *expected* kaval identity — the build padi would spawn
 *  (`padi.cells.status.expectedKaval`: closure `staleKey` + git `navigableCommit`).
 *  Named once here so every read site (the `kavalUpdatePending` predicate and the
 *  dialog's running-vs-expected commit links + "what changed" history link) joins
 *  the surface path through one accessor. */
export const expectedKaval = (): PadiStatus["expectedKaval"] =>
  padiStatus.value()?.expectedKaval;

/** True when the running kaval daemon is provably a build behind the server's
 *  expected build. Reads padi's `status` cell (`status.expectedKaval`) and the
 *  live `daemonStatus`. Gate the nudge on this:
 *  `<Show when={kavalUpdatePending()}><KavalUpdateBadge /></Show>`. */
export const kavalUpdatePending = (): boolean => {
  // Floored on transport liveness like the kaval dot beside it: over a dead/half-open
  // link the retained daemon identity is stale, so the "a newer build is available;
  // click to restart" nudge can't honestly fire — the grey "unknown" dot must not sit
  // next to an amber "connected and behind" chip whose restart would fail loudly. The
  // floor rides INSIDE `kavalStale` (a required `live` leg), so the dialog's own banner
  // (KavalInfoDialog) can't re-derive the verdict without it.
  const status = localDaemonStatus();
  return kavalStale(
    expectedKaval()?.staleKey,
    status?.identity?.staleKey,
    status?.state,
    daemonChannelLive(),
  );
};

/** The compact amber "⬆ update" nudge chip — kolu's own chrome. Passive: the
 *  kaval column it sits in opens the dialog where the restart lives. */
export const KavalUpdateBadge: Component = () => (
  <span class="self-center whitespace-nowrap rounded-full border border-warning/40 px-1.5 text-[9px] leading-4 text-warning">
    ⬆ update
  </span>
);
