import type { WorkId } from "kolu-work";
import { batch, createSignal } from "solid-js";
import { conductorWide } from "./conductorLayout";
import { closeReader } from "./reader/useReader";
import { enterConductorMode } from "./useConductorMode";

const [openCards, setOpenCards] = createSignal<ReadonlySet<string>>(new Set());
const [finishedOpen, setFinishedOpen] = createSignal(false);
const [listingOut, setListingOut] = createSignal(false);
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

export const isCardOpen = (id: string): boolean => openCards().has(id);

export function toggleCard(id: string): void {
  setOpenCards((was) => {
    const next = new Set(was);
    if (!next.delete(id)) next.add(id);
    return next;
  });
}

export function openCard(id: string): void {
  setOpenCards((was) => (was.has(id) ? was : new Set([...was, id])));
}

export const isFinishedOpen = finishedOpen;
export const toggleFinished = (): void => {
  setFinishedOpen((was) => !was);
};
export const openFinished = (): void => {
  setFinishedOpen(true);
};

export const isListingOut = listingOut;
export const toggleListing = (): void => {
  setListingOut((was) => !was);
};

export const wantedCard = wanted;

export function cardShown(seq: number): void {
  if (wanted()?.seq === seq) setWanted(null);
}

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
