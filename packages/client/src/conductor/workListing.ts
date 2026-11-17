/** THE WORK LISTING'S OWN STATE — which cards are open, whether the finished
 *  list is open, whether the listing is out on a narrow window, and THE ONE
 *  WAY TO GO TO A WORK ({@link showWork}).
 *
 *  Module state, for the reason each piece of it always was: the listing is
 *  drawn in two placements (the side column on a wide window, the band the
 *  status line opens below it) and a resize moves it between them, so what a
 *  person opened must outlive either copy. It is here rather than in the
 *  components because a work chip — in the chat, in a "which work?" menu, in
 *  the reader's header — opens a card it is not inside, and so do the things
 *  outside the Conductor: a `#/work/…` link, the bell's notification, the
 *  command palette, and the mark on a terminal's dock row. */

import type { WorkId } from "kolu-work";
import { batch, createSignal } from "solid-js";
import { conductorWide } from "./conductorLayout";
import { closeReader } from "./reader/useReader";
import { enterConductorMode } from "./useConductorMode";

const [openCards, setOpenCards] = createSignal<ReadonlySet<string>>(new Set());
const [finishedOpen, setFinishedOpen] = createSignal(false);
const [listingOut, setListingOut] = createSignal(false);
/** Put the listing out, or back in, on a narrow window. */
export { setListingOut };
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

/** Is the listing out on a narrow window — the band the status line's count
 *  opens? A wide window always shows it beside the conversation. */
export const isListingOut = listingOut;
export const toggleListing = (): void => {
  setListingOut((was) => !was);
};

/** The card a route asked to bring into view, if one is waiting. */
export const wantedCard = wanted;

/** The card answered: it is in view. */
export function cardShown(seq: number): void {
  if (wanted()?.seq === seq) setWanted(null);
}

/** GO TO A WORK — the one route every face takes: a work chip, a `#/work/…`
 *  link, the bell's notification, a command-palette row, the mark on a dock
 *  row. The Conductor comes on screen, the reader gives way (the listing is
 *  behind it), the listing comes out on a NARROW window (a wide one already
 *  shows it beside the conversation, and setting it out there would leave the
 *  band out, unasked, the moment the window narrowed), and the card opens and
 *  is scrolled to — onto the question `ask` names, when one is given. The
 *  column opens its Finished list when the card is a finished work's. */
export function showWork(id: WorkId, ask: string | null = null): void {
  asks += 1;
  const seq = asks;
  batch(() => {
    enterConductorMode();
    closeReader();
    if (!conductorWide()) setListingOut(true);
    openCard(id);
    setWanted({ id, ask, seq });
  });
}
