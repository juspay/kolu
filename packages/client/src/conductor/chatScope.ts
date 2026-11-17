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

import type { Work, WorkId } from "kolu-work";
import { batch, createSignal } from "solid-js";
import { conductorWide } from "./conductorLayout";
import { closeReader } from "./reader/useReader";
import { useWorkMap } from "./useWorks";
import { setListingOut } from "./workListing";

const [scope, setScope] = createSignal<WorkId | null>(null);

/** The work the chat is about, with its record, or `null` for the whole
 *  conversation — and `null` too once that work is no longer in the list
 *  (the oldest finished works are let go): a scope with no work behind it
 *  would filter the chat down to nothing and name nothing. */
export const chatScope = (): {
  readonly id: WorkId;
  readonly record: Work;
} | null => {
  const id = scope();
  if (id === null) return null;
  const record = useWorkMap()().get(id);
  return record === undefined ? null : { id, record };
};

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
