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

/** The live facts the gate judges on, as they stand when it is called.
 *  PASSED IN rather than read: the caller is a Solid effect, whose compute is
 *  the one place a reactive read belongs — the effect phase this runs in is
 *  untracked, so a read here would see the facts without depending on them,
 *  and in dev it is a strict-read warning besides. */
export interface ShownPaneFacts {
  /** Is this pane shown — MEASURED (it has a real grid, not xterm's invented
   *  80×24) and VISIBLE (a user could be reading it)? */
  readonly shown: boolean;
  /** Is the VIEW this pane is drawn in the one in front? False while the
   *  Conductor covers the workspace. The pane stays attached and keeps drawing
   *  — `shown` is untouched — but it states no size: a measurement is not
   *  published, and one still settling is dropped. Something else in front is
   *  sizing the terminal, and a pane nobody is looking at must not take the
   *  size back. On the way back in front the pane's foreign-grid watcher
   *  (`foreignGrid.ts`) restates its size if the terminal no longer has it. */
  readonly viewShown: boolean;
  /** The host entry's state KIND as the pane's host map paints it right now —
   *  carried because the two things this gate drives on the way through need
   *  it and may not read it themselves: the publisher's restatement (judged
   *  against `"connected"`) and, through the attach, the grid the pane opens
   *  at. */
  readonly hostState: string;
  /** The grid this pane has MEASURED, as the kit states it — non-null exactly
   *  when `shown` is true, since that is what MEASURED means. The attach opens
   *  at it (`resizeTo`), which is why it travels with the rest: the open is an
   *  effect's act, and the measurement is a signal. */
  readonly wanted: TerminalGrid | null;
}

/** The two VISIBILITY facts on their own — what a measurement is judged by.
 *  A named slice of {@link ShownPaneFacts} so a caller that has no reason to
 *  read the host's state (the measurement effect) does not have to. */
export type ShownPaneVisibility = Pick<ShownPaneFacts, "shown" | "viewShown">;

export interface ShownPaneDeps {
  /** Open the attach stream at the pane's current grid. The screen is NOT
   *  cleared first: the fresh snapshot carries the reset that replaces the
   *  stale bytes, so the two land as one write. */
  readonly attach: (facts: ShownPaneFacts) => void;
  /** End the live attach: supersede the attempt, interrupt its fiber, cancel
   *  whatever reopen it had pending. Nothing may paint afterwards. */
  readonly detach: () => void;
  /** State a measured grid to the PTY (`publishGrid.ts` owns when it lands). */
  readonly publish: (grid: TerminalGrid) => void;
  /** Drop a publish that has not landed yet — a hidden pane states no grid.
   *  `publishGrid.ts` owns the window and what dropping it costs; this owns
   *  when it is no longer owed. */
  readonly cancelPublish: () => void;
  /** Restate the grid a not-connected window dropped, if one is still owed
   *  (`publishGrid.ts`'s latch, kolu#2101 K4). The latch is the publisher's,
   *  and so is the host check: with nothing owed or the host not connected it
   *  does nothing. What this gate adds is the VIEW: behind the Conductor the
   *  grid stays owed, and it is restated once the view is back in front. */
  readonly restateOwed: (hostState: string) => void;
}

export interface ShownPane {
  /** Act on a CHANGE in the facts handed in; restate an owed grid while in
   *  front. Idempotent: safe on every tick of any fact they come from, and of
   *  the host's state. */
  observe(facts: ShownPaneFacts): void;
  /** The pane measured a new grid. Published only while the pane is shown
   *  and its view is in front — the two VISIBILITY facts, which is all this
   *  one needs (its own grid is the argument). */
  measured(grid: TerminalGrid, facts: ShownPaneVisibility): void;
}

export function createShownPane(deps: ShownPaneDeps): ShownPane {
  /** The last answer acted on — and therefore whether an attach is live. */
  let attached = false;
  return {
    observe(facts: ShownPaneFacts) {
      const { shown, viewShown, hostState } = facts;
      if (viewShown) deps.restateOwed(hostState);
      else deps.cancelPublish();
      if (shown === attached) return;
      attached = shown;
      if (shown) deps.attach(facts);
      else {
        deps.cancelPublish();
        deps.detach();
      }
    },
    measured(grid: TerminalGrid, { shown, viewShown }: ShownPaneVisibility) {
      if (!shown || !viewShown) return;
      deps.publish(grid);
    },
  };
}
