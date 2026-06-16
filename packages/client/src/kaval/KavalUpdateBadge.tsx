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
 *  `expected` (the server's `buildInfo.expectedKaval`) and `reported` (the
 *  connected daemon's `daemonStatus.identity`) — never stored, never folded into
 *  the client-vs-server `≠ srv` signal (which stays the commit comparison). */

import { useSurfaceApp } from "@kolu/surface-app/solid";
import type { Component } from "solid-js";
import type { KoluBuildInfo } from "kolu-common/surface";
import { kavalStale } from "./kavalCurrency";
import { daemonStatusFor, LOCAL_HOST } from "./useDaemonStatus";

/** The server's *expected* kaval identity — the build it would spawn
 *  (`buildInfo.expectedKaval`: closure `staleKey` + git `navigableCommit`). Named
 *  once here so every read site (the `kavalUpdatePending` predicate and the
 *  dialog's running-vs-expected commit links + "what changed" history link) joins
 *  the surface path through one accessor. Must be called under `<SurfaceAppProvider>`. */
export const expectedKaval = (): KoluBuildInfo["expectedKaval"] =>
  useSurfaceApp<KoluBuildInfo>().server()?.expectedKaval;

/** True when the running kaval daemon is provably a build behind the server's
 *  expected build. Reads the surface-app model (`buildInfo.expectedKaval`) and
 *  the live `daemonStatus` — must be called under `<SurfaceAppProvider>`. Gate
 *  the nudge on this: `<Show when={kavalUpdatePending()}><KavalUpdateBadge /></Show>`.
 *
 *  `hostId` defaults to the LOCAL host so every existing call site is unchanged.
 *  Only the LOCAL kaval can ever be pending: `expectedKaval` is THIS server's
 *  baked closure id, which is comparable only to the daemon kolu-server itself
 *  would spawn — a REMOTE kaval is pinned to its watcher's own Nix build, with no
 *  server-expected counterpart to compare against, so it never nudges. */
export const kavalUpdatePending = (hostId: string = LOCAL_HOST): boolean => {
  if (hostId !== LOCAL_HOST) return false;
  const status = daemonStatusFor(hostId);
  return kavalStale(
    expectedKaval()?.staleKey,
    status?.identity?.staleKey,
    status?.state,
  );
};

/** The compact amber "⬆ update" nudge chip — kolu's own chrome. Passive: the
 *  kaval column it sits in opens the dialog where the restart lives. */
export const KavalUpdateBadge: Component = () => (
  <span class="self-center whitespace-nowrap rounded-full border border-warning/40 px-1.5 text-[9px] leading-4 text-warning">
    ⬆ update
  </span>
);
