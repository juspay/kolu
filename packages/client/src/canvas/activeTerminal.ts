import { tileElements } from "../tile/tileElements";
/** Typed accessor for the active canvas terminal's DOM node — single
 *  grep-able home for the "find the inner xterm of the active tile"
 *  contract (issue #845).
 *
 *  Scoped via the production-only `data-canvas-tile` marker, NOT via
 *  `data-active` alone: several unrelated producers use the same presence
 *  marker, and a bare global query can land on a non-tile element first in
 *  DOM order. The marker
 *  lives outside `data-testid` so a future test-attribute rename
 *  can't silently break refocus. */

const TERMINAL_INNER_SELECTOR = "[data-visible][data-terminal-id]";
const FOCUSED_TERMINAL_INNER_SELECTOR =
  "[data-focused][data-visible][data-terminal-id]";

/** The focus-owning Terminal child of the active CanvasTile, or its first
 *  visible terminal before pane focus is established. Returns null when no
 *  tile is active. This keeps dialog-close refocus on a selected split instead
 *  of blindly clicking the main pane that happens to come first in the DOM. */
export function getActiveTerminalNode(): HTMLElement | null {
  const tile = [...tileElements()].find((el) => el.hasAttribute("data-active"));
  return (
    tile?.querySelector<HTMLElement>(FOCUSED_TERMINAL_INNER_SELECTOR) ??
    tile?.querySelector<HTMLElement>(TERMINAL_INNER_SELECTOR) ??
    null
  );
}

/** First Terminal-element in DOM order, regardless of active state.
 *  Falls back when no tile is active (initial mount, just after closing
 *  the last tile, etc.) so refocus paths still have a target. */
export function getFirstTerminalNode(): HTMLElement | null {
  for (const tile of tileElements()) {
    const terminal = tile.querySelector<HTMLElement>(TERMINAL_INNER_SELECTOR);
    if (terminal) return terminal;
  }
  return null;
}
