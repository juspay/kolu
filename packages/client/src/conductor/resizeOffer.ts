/**
 * WHEN A LIVE PANE OFFERS ITS ONE PRESS — **Resize to fit**, the head's size
 * readout turned into a button.
 *
 * The question is the foreign-grid watcher's (`terminal/foreignGrid.ts`): is
 * the terminal at a size this pane did not ask for, or is the pane's own
 * resize still landing? On a desktop the two look the same for a while every
 * time the pane speaks — the 250 ms settle and the round trip after a first
 * look, and the whole of a window drag, where the asked-for size changes on
 * every frame. Offering the press then would only offer what is already
 * happening, as a link that blinks in and out of the head.
 *
 * So the press is offered once the mismatch has OUTLASTED the pane's own
 * publish: the same pair of sizes — the terminal's real one, from its record,
 * and the one the pane would ask for — unchanged for the watcher's own window
 * ({@link FOREIGN_GRID_SETTLE_MS}). Our own resize converges inside it; a
 * size someone else holds, or one a phone's pane never asks for, does not.
 * A change of either size starts the wait again, and sizes that agree, or a
 * record that states no size, offer nothing.
 */

import { sameGrid, type TerminalGrid } from "@kolu/xterm-kit/solid";

export interface ResizeOfferDeps {
  /** How long a mismatch must hold before the press is offered. */
  readonly settleMs: number;
  /** Show or hide the press. */
  readonly show: (offered: boolean) => void;
}

/** THE TWO SIZES A TICK IS ABOUT, handed in rather than read: the caller is
 *  the pane's effect, whose imperative half reads no reactive state — its
 *  compute has already read both. */
export interface ResizeOfferNow {
  /** The terminal's real size, as its record states it. */
  readonly real: TerminalGrid | null | undefined;
  /** The size the pane would ask for, `null` until it has measured. */
  readonly asked: TerminalGrid | null | undefined;
}

export interface ResizeOffer {
  /** Re-read both sizes. Safe on every tick: an unchanged pair, compared by
   *  value, keeps whatever wait or answer stands. */
  observe(now: ResizeOfferNow): void;
  /** Cancel a pending wait — the pane's teardown. */
  dispose(): void;
}

/** Two sizes the same — by value, with "no size" (null or absent) one answer. */
const same = (
  a: TerminalGrid | null | undefined,
  b: TerminalGrid | null | undefined,
): boolean => (a && b ? sameGrid(a, b) : !a && !b);

export function createResizeOffer(deps: ResizeOfferDeps): ResizeOffer {
  /** The pair last acted on — `seen` false until the first observe. */
  let seen = false;
  let real: TerminalGrid | null | undefined;
  let asked: TerminalGrid | null | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => clearTimeout(timer);
  return {
    observe(now) {
      const nextReal = now.real;
      const nextAsked = now.asked;
      if (seen && same(nextReal, real) && same(nextAsked, asked)) return;
      seen = true;
      real = nextReal;
      asked = nextAsked;
      cancel();
      deps.show(false);
      if (!real || !asked || sameGrid(real, asked)) return;
      timer = setTimeout(() => deps.show(true), deps.settleMs);
    },
    dispose: cancel,
  };
}
