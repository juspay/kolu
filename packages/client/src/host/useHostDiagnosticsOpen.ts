/** WHICH host's details popover is open, and what it hangs off — one at a
 *  time, hoisted to a module singleton so every opener drives the one state:
 *
 *   - the host tab's connection pip (`HostSelectorStrip`), which toggles it;
 *   - the tab's agent-distro mark (`AgentDistroHostMark`), which opens it on
 *     the machine it is about;
 *   - a machine's name on Settings' Agents line (`AgentsFleetLine`), which
 *     opens that machine's details — the host-scoped facts live there now.
 *
 *  The panel itself mounts ONCE, at the shell (`HostDiagnosticsHost` in
 *  `App.tsx`), not inside the chip: Settings is reachable at every width, but
 *  the chip row is mounted only at `md` and up and never for an overflowed
 *  host — a panel that lived in the chip would leave those clicks painting
 *  nothing. So the opener hands over the element to hang the panel off
 *  (its own button), and the shell positions against it.
 *
 *  IDENTITY and PLACEMENT are two signals, not one record. The open HOST is
 *  what the panel is (it keys the mount, and a pip toggles on it); the
 *  ELEMENT is only where it floats, and it comes and goes on faster clocks —
 *  the chip row's overflow fit, the `md` breakpoint, Settings opening and
 *  closing, the fleet line regrouping. Keeping them apart means re-opening
 *  the same host from a DIFFERENT opener moves the panel instead of
 *  remounting it (`useAnchoredPopover` repositions when `triggerRef()`
 *  changes), and an element that unmounts while the panel is open closes it
 *  rather than leaving it anchored to a detached node — its opener says so
 *  through {@link releaseHostDiagnosticsAnchor}.
 *
 *  Singleton pattern (per `.claude/rules/solidjs.md` — state per domain): the
 *  signals are created once at module scope; every consumer imports the same
 *  accessors rather than threading props through the shell. The selector
 *  rides `createSharedRoot`, the repo's spelling for a shared reactive value
 *  with an owner (`host/isActiveHost.ts`). */

import { createSelector, createSignal } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";

/** The open host's CANONICAL encoded key — `null` when nothing is open. */
const [openKey, setOpenKey] = createSignal<string | null>(null);
/** The element the open panel hangs off. */
const [anchor, setAnchor] = createSignal<HTMLElement | undefined>();

export { openKey as openHostDiagnosticsKey, anchor as hostDiagnosticsAnchor };

/** Is `encKey`'s panel the open one? A selector, so a chip re-renders only
 *  when its own answer changes. */
export const useHostDiagnosticsSelector = createSharedRoot(() =>
  createSelector(openKey),
);

/** Open `encKey`'s details, hung off `anchor` — the element the user acted on
 *  (a host tab, a machine's name in Settings). */
export function openHostDiagnostics(encKey: string, el: HTMLElement): void {
  setOpenKey(encKey);
  setAnchor(el);
}

export function closeHostDiagnostics(): void {
  setOpenKey(null);
  setAnchor(undefined);
}

/** The pip's own action: open this host's details, or close them if they are
 *  the ones showing. */
export function toggleHostDiagnostics(encKey: string, el: HTMLElement): void {
  if (openKey() === encKey) closeHostDiagnostics();
  else openHostDiagnostics(encKey, el);
}

/** An opener's element is going away (its chip overflowed, its row regrouped,
 *  Settings closed). If the open panel hangs off it there is nowhere left to
 *  float, so close — an opener owns the element it handed over. */
export function releaseHostDiagnosticsAnchor(el: HTMLElement): void {
  if (anchor() === el) closeHostDiagnostics();
}
