/**
 * A work's live pane, on a desktop, sets its terminal's size.
 *
 * The person is looking at the terminal through this pane, so the pane is the
 * one thing that knows how big the terminal should be: the most columns and
 * rows its body holds, never below the size a terminal is born at
 * (`peekSize.ts`, `paneGrid`). Everything else follows — Look, a phone's or a
 * tablet's pane, a tile behind the Conductor (`terminal/shownPane.ts`) — and
 * draws the terminal at whatever size the stream states.
 *
 * It speaks on TWO occasions only, and that is the whole policy:
 *
 *  - when the pane comes on screen measured (connected, on the desktop layout,
 *    with a grid to ask for);
 *  - when the grid it would ask for changes — the window resized, the rail
 *    dragged, a second terminal halving the stack.
 *
 * Never for any other reason: not a re-attach of its screen, not someone
 * else's resize, not the scroll lock. It does not re-assert, so two viewers
 * cannot trade the size back and forth: the last pane to come on screen or to
 * change shape wins, and a terminal someone else resized stays so until this
 * pane has a reason of its own to speak. Its screen still attaches asking for
 * nothing (`peek/peekAttach.ts`) and draws whatever size the stream states.
 *
 * What it says goes through the tile's own publisher (`terminal/publishGrid.ts`):
 * the 250 ms settle, so a drag costs one resize, and the host-not-connected
 * latch. A pane that leaves the screen drops what is still settling.
 */

import { sameGrid, type TerminalGrid } from "@kolu/xterm-kit/solid";

export interface PaneSizeDeps {
  /** The pane holds a read of its terminal's screen — it is on screen. */
  readonly connected: () => boolean;
  /** The desktop layout. A phone's or a tablet's pane follows. */
  readonly desktop: () => boolean;
  /** The grid the pane would ask for, `null` until it has measured. */
  readonly asked: () => TerminalGrid | null;
  /** State a grid to the terminal (`publishGrid.ts` owns when it lands). */
  readonly publish: (grid: TerminalGrid) => void;
  /** Drop a publish that has not landed yet. */
  readonly cancelPublish: () => void;
}

export interface PaneSize {
  /** Re-read the three facts and speak on a CHANGE. Idempotent: safe on
   *  every tick of any of them. */
  observe(): void;
}

export function createPaneSize(deps: PaneSizeDeps): PaneSize {
  /** The grid last stated while on screen, or `null` while off it — so
   *  coming back on screen speaks once, and an unchanged grid never does. */
  let stated: TerminalGrid | null = null;
  return {
    observe() {
      const grid = deps.connected() && deps.desktop() ? deps.asked() : null;
      if (!grid) {
        if (stated) deps.cancelPublish();
        stated = null;
        return;
      }
      if (stated && sameGrid(stated, grid)) return;
      stated = grid;
      deps.publish(grid);
    },
  };
}
