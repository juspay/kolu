/** THE WORK LISTING'S OWN STATE — which cards are open, whether the finished
 *  list is open, and THE ONE WAY TO GO TO A WORK ({@link showWork}).
 *
 *  Module state, because what a person opened must outlive any one drawing
 *  of the list: a work chip — in the chat, in a "which work?" menu, in the
 *  reader's header — opens a card it is not inside, and so do the things
 *  outside the Conductor: a `#/work/…` link, the bell's notification, the
 *  command palette, and the mark on a terminal's dock row. */

import type { WorkId } from "kolu-work";
import { batch, createSignal } from "solid-js";
import { setPhoneView } from "./phoneView";
import { closeReader } from "./reader/useReader";
import { enterConductorMode } from "./useConductorMode";

const [openCards, setOpenCards] = createSignal<ReadonlySet<string>>(new Set());
const [finishedOpen, setFinishedOpen] = createSignal(false);
/** A card asked to come into view — keyed by a counter so asking twice for
 *  the same work scrolls twice, and with the question to bring into view
 *  when the asker named one. Cleared by the card that answered it. */
export interface WantedCard {
  readonly id: WorkId;
  readonly ask: string | null;
  readonly seq: number;
}
const [wanted, setWanted] = createSignal<WantedCard | null>(null);
let asks = 0;

/** Is this card open? */
export const isCardOpen = (id: string): boolean => openCards().has(id);

/** Open a shut card, or shut an open one. */
export function toggleCard(id: string): void {
  setOpenCards((was) => {
    const next = new Set(was);
    if (!next.delete(id)) next.add(id);
    return next;
  });
}

/** Open a card, if it is shut — what a press on its stage strip does. */
export function openCard(id: string): void {
  setOpenCards((was) => (was.has(id) ? was : new Set([...was, id])));
}

/** Is the Finished list open? Shut by default: it is history. */
export const isFinishedOpen = finishedOpen;
export const toggleFinished = (): void => {
  setFinishedOpen((was) => !was);
};
/** Open the Finished list — what the column does when the card a route
 *  asked for is a finished work's. */
export const openFinished = (): void => {
  setFinishedOpen(true);
};

/** The card a route asked to bring into view, if one is waiting. */
export const wantedCard = wanted;

/** The card answered: it is in view. */
export function cardShown(seq: number): void {
  if (wanted()?.seq === seq) setWanted(null);
}

/** GO TO A WORK — the one route every face takes: a work chip, a `#/work/…`
 *  link, the bell's notification, a command-palette row, the mark on a dock
 *  row. The Conductor comes on screen, the reader gives way (the works are
 *  behind it), a phone shows its works (a desktop always does), and the card
 *  opens and is scrolled to — onto the question `ask` names, when one is
 *  given. The list opens its Finished group when the card is a finished
 *  work's. */
export function showWork(id: WorkId, ask: string | null = null): void {
  asks += 1;
  const seq = asks;
  batch(() => {
    enterConductorMode();
    closeReader();
    setPhoneView("work");
    openCard(id);
    setWanted({ id, ask, seq });
  });
}
