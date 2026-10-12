/** WHICH host's details popover is open, and what it hangs off — one at a
 *  time, hoisted to a module singleton so every opener drives the one signal:
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
 *  Singleton pattern (per `.claude/rules/solidjs.md` — state per domain): the
 *  signal is created once at module scope; every consumer imports the same
 *  accessors rather than threading props through the shell. The selector it
 *  derives rides `createSharedRoot`, the repo's spelling for a shared
 *  reactive value with an owner (`host/isActiveHost.ts`). */

import { createSelector, createSignal } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";

/** The open host's CANONICAL encoded key and the element its panel hangs off
 *  — `null` when nothing is open. */
const [open, setOpen] = createSignal<{
  readonly key: string;
  readonly anchor: HTMLElement;
} | null>(null);

export { open as openHostDiagnosticsState };

/** The open host's key, or `null`. */
export function openHostKey(): string | null {
  return open()?.key ?? null;
}

/** Is `encKey`'s panel the open one? A selector, so a chip re-renders only
 *  when its own answer changes. */
export const useHostDiagnosticsSelector = createSharedRoot(() =>
  createSelector(openHostKey),
);

/** Open `encKey`'s details, hung off `anchor` — the element the user acted on
 *  (a host tab, a machine's name in Settings). */
export function openHostDiagnostics(encKey: string, anchor: HTMLElement): void {
  setOpen({ key: encKey, anchor });
}

export function closeHostDiagnostics(): void {
  setOpen(null);
}

/** The pip's own action: open this host's details, or close them if they are
 *  the ones showing. */
export function toggleHostDiagnostics(
  encKey: string,
  anchor: HTMLElement,
): void {
  setOpen((current) =>
    current?.key === encKey ? null : { key: encKey, anchor },
  );
}
