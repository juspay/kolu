/**
 * A pane nobody is looking at does not attach, and states no size.
 *
 * Both halves of that are one rule, which is why they share a module and a
 * fact. ATTACHING IS A WRITE: the attach request carries `resizeTo`, and the
 * host resizes the shared PTY to it before serializing the screen — so a pane
 * that attaches is a pane that has just resized somebody's terminal. And
 * PUBLISHING IS THE SAME WRITE by the other door (`publishGrid.ts`), stating
 * each new measurement as the pane re-fits.
 *
 * Measured is not shown, and the difference is what made this a bug. Mobile
 * mounts a body for EVERY terminal of the host and hides the inactive ones with
 * `content-visibility: hidden` (`MobileTileView.tsx`) — deliberately, so a tile
 * switch preserves its layout and its scrollback instead of discarding both.
 * A hidden box still has a box, so it still measures, so the old gate ("attach
 * once the pane has MEASURED") fired for all of them: opening kolu on a phone
 * attached N streams and resized N PTYs — 14 of them in under a second, each
 * one a SIGWINCH and a full repaint from the agent underneath (kolu#2362 §4),
 * to paint screens nobody could see.
 *
 * So the gate is measured AND visible, and it is an EDGE, not a filter: the
 * pane attaches when it becomes shown and ENDS the attach when it stops being
 * shown — a dropped subscription, not a muted one, because a subscription held
 * open for a hidden pane still costs the host a serialize and the wire every
 * byte the terminal prints. Hiding is cheap to undo: the reveal re-attaches,
 * and the attach's own `resizeTo` restates the grid the pane measured while it
 * was hidden, which is why nothing has to be published in the meantime. The
 * fresh snapshot that attach returns is also the repair for whatever the pane
 * missed — and it arrives carrying its own reset, so the old screen stays up
 * until the new one paints instead of the pane going blank for the whole
 * round-trip.
 *
 * What a hidden pane is NOT is unobserved: the activity dot is mirrored off
 * padi's `activity` set, which rides the awareness feed rather than this
 * stream, so "this terminal changed while you weren't looking" still lights
 * without anyone attached. No new signal belongs here.
 *
 * The LATCH is the point of the module. Both facts are live signals — the grid
 * ticks on every re-fit, visibility on every tile switch — so the pane's
 * effects re-run far more often than the answer changes. Holding the last
 * answer here makes `observe()` safe to call on every tick of either fact, and
 * keeps "am I attached" one bit in one place rather than a condition each call
 * site re-derives.
 */

import type { TerminalGrid } from "@kolu/xterm-kit/solid";

export interface ShownPaneDeps {
  /** Is this pane shown — MEASURED (it has a real grid, not xterm's invented
   *  80×24) and VISIBLE (a user could be reading it)? Both are live signals;
   *  this reads them, it does not remember them. */
  readonly shown: () => boolean;
  /** Open the attach stream at the pane's current grid. The screen is NOT
   *  cleared first: the fresh snapshot carries the reset that replaces the
   *  stale bytes, so the two land as one write. */
  readonly attach: () => void;
  /** End the live attach: supersede the attempt, interrupt its fiber, cancel
   *  whatever reopen it had pending. Nothing may paint afterwards. */
  readonly detach: () => void;
  /** State a measured grid to the PTY (`publishGrid.ts` owns when it lands). */
  readonly publish: (grid: TerminalGrid) => void;
  /** Drop a publish that has not landed yet — a hidden pane states no grid.
   *  `publishGrid.ts` owns the window and what dropping it costs; this owns
   *  when it is no longer owed. */
  readonly cancelPublish: () => void;
}

export interface ShownPane {
  /** Re-read `shown()` and act on a CHANGE. Idempotent: safe on every tick of
   *  either fact the predicate reads. */
  observe(): void;
  /** The pane measured a new grid. Published only while the pane is shown. */
  measured(grid: TerminalGrid): void;
}

export function createShownPane(deps: ShownPaneDeps): ShownPane {
  /** The last answer acted on — and therefore whether an attach is live. */
  let attached = false;
  return {
    observe() {
      const shown = deps.shown();
      if (shown === attached) return;
      attached = shown;
      if (shown) deps.attach();
      else {
        deps.cancelPublish();
        deps.detach();
      }
    },
    measured(grid: TerminalGrid) {
      if (!deps.shown()) return;
      deps.publish(grid);
    },
  };
}
