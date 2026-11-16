/** THE WORK LISTING'S OWN STATE — which cards are open, whether the finished
 *  list is open, whether the listing is out on a narrow window, and the one
 *  act every face uses to bring a work into view ({@link showWork}).
 *
 *  Module state, for the reason each piece of it always was: the listing is
 *  drawn in two placements (the side column on a wide window, the band the
 *  status line opens below it) and a resize moves it between them, so what a
 *  person opened must outlive either copy. It is here rather than in the
 *  components because a work chip — in the chat, in a "which work?" menu, in
 *  the reader's header — opens a card it is not inside. */

import { batch, createSignal } from "solid-js";
import { closeReader } from "./reader/useReader";

const [openCards, setOpenCards] = createSignal<ReadonlySet<string>>(new Set());
const [finishedOpen, setFinishedOpen] = createSignal(false);
const [listingOut, setListingOut] = createSignal(false);
/** A card asked to come into view — keyed by a counter so asking twice for
 *  the same work scrolls twice. Cleared by the card that answered it. */
const [wanted, setWanted] = createSignal<{
  readonly id: string;
  readonly seq: number;
} | null>(null);
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

/** Is the Finished list open? Shut by default: it is history. */
export const isFinishedOpen = finishedOpen;
export const toggleFinished = (): void => {
  setFinishedOpen((was) => !was);
};

/** Is the listing out on a narrow window — the band the status line's count
 *  opens? A wide window always shows it beside the conversation. */
export const isListingOut = listingOut;
export const toggleListing = (): void => {
  setListingOut((was) => !was);
};

/** The card a chip asked to bring into view, if one is waiting. */
export const wantedCard = wanted;

/** The card answered: it is in view. */
export function cardShown(seq: number): void {
  if (wanted()?.seq === seq) setWanted(null);
}

/** BRING A WORK INTO VIEW — what pressing a work chip does. The reader gives
 *  way (the listing is behind it), the listing comes out on a narrow window,
 *  a finished work's list opens, and the card opens and is scrolled to. */
export function showWork(id: string, finished: boolean): void {
  asks += 1;
  const seq = asks;
  batch(() => {
    closeReader();
    setListingOut(true);
    if (finished) setFinishedOpen(true);
    setOpenCards((was) => (was.has(id) ? was : new Set([...was, id])));
    setWanted({ id, seq });
  });
}
