/** WHAT THE CHAT IS ABOUT — one piece of work, or everything.
 *
 *  ONE SIGNAL, two readers that must never disagree: the transcript shows
 *  only the turns that name this work (the same `turnWorks` reading the chips
 *  are drawn from), and the composer carries it as a mention, so a message
 *  sent while the chat is about a work is about that work. Filtering and
 *  addressing are one mechanism, not two features.
 *
 *  Module-level, like the composer's draft (`./drafts.ts`): it survives
 *  leaving the Conductor and coming back, and it does not survive a reload —
 *  the honest boundary for a view nobody told the server about. */

import type { WorkId } from "kolu-work";
import { batch, createSignal } from "solid-js";
import { conductorWide } from "./conductorLayout";
import { closeReader } from "./reader/useReader";
import { setListingOut } from "./workListing";

const [scope, setScope] = createSignal<WorkId | null>(null);

/** The work the chat is about, or `null` for the whole conversation. */
export const chatScope = scope;

/** "About this work": point the chat at it. The reader gives way and, on a
 *  narrow window, the listing goes back in, so the chat it filtered is the
 *  thing on screen. */
export function aboutWork(id: WorkId): void {
  batch(() => {
    closeReader();
    if (!conductorWide()) setListingOut(false);
    setScope(id);
  });
}

/** "Show all", and the scope chip's × in the box. */
export function showAllChat(): void {
  setScope(null);
}
