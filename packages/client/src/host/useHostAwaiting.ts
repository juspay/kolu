/** `useHostAwaiting` — the ONE owner of a host's "awaiting terminals" derivation,
 *  plus `useFocusAwaiting`, the click that jumps to them.
 *
 *  A chip's amber "needs you" pill reads the host's `urgency` cell and projects
 *  its `awaitingIds`. That standing subscription + its onError toast + the `?? []`
 *  projection are one concept ("which terminals the awaiting pill counts"), so
 *  they live here once rather than being hand-rolled at each render site
 *  (`HostChip`, `HostSwitcherRow`, `MobileHostChip`) — which read `.length` for
 *  the count and hand the ids to `useFocusAwaiting` for the jump.
 *
 *  `urgency` is (per the desktop strip's note) the FIRST client consumer of the
 *  keyed map's per-host `urgency` cell — an explicitly early, growing fact set.
 *
 *  Owned-by-caller: this must be called SYNCHRONOUSLY in a component body so the
 *  `.use()` acquires under that component's reactive owner (each `<For>` chip has
 *  its own, disposed when the host leaves the pool) — never at module scope,
 *  where the ref-counted cache would net the listener to zero a microtask later. */

import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { useTileStore } from "../tile/useTileStore";
import { activeHost, padiMap, setActiveHost } from "../wire";
import { sameHost } from "./hostChipTone";

/** The host's awaiting terminal ids as a reactive accessor — the pill's count is
 *  `.length`, and `useFocusAwaiting` cycles the ids. The urgency cell's declared
 *  `hostToast` policy (host-prefixed: `Host <host> urgency error: …`) routes
 *  through the ONE interpreter, so this use-site is bare. */
export function useHostAwaiting(host: HostKey): () => readonly TerminalId[] {
  const urgency = padiMap.entry(host).cells.urgency.use();
  return () => urgency.value()?.awaitingIds ?? [];
}

/** A click handler that jumps to a host's awaiting terminals, cycling through
 *  them on repeated clicks. It reuses the EXACT switch-then-activate seam the
 *  cross-host attention click runs (`useHostAttention`'s notification router):
 *  `setActiveHost` (guarded so a no-op on the already-active host doesn't
 *  re-notify every `useEntry(activeHost)` consumer with a fresh-but-equal key)
 *  then the tile store's `activate`, which targets the now-active host — so a
 *  badge click and a notification click focus the terminal the same way, with no
 *  second focus path to keep in sync.
 *
 *  The cursor lives across clicks so a host with several waiting agents steps
 *  through them one per click; `% length` keeps it in bounds as the set shrinks.
 *  A click with nothing awaiting is a no-op (the pill is hidden at zero anyway). */
export function useFocusAwaiting(
  host: HostKey,
  ids: () => readonly TerminalId[],
): () => void {
  const tileStore = useTileStore();
  let cursor = 0;
  return () => {
    const awaiting = ids();
    if (awaiting.length === 0) return;
    if (!sameHost(activeHost(), host)) setActiveHost(host);
    const target = awaiting[cursor % awaiting.length];
    cursor += 1;
    if (target) tileStore.activate(target);
  };
}
