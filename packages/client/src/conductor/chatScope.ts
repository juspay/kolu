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
import { createSignal } from "solid-js";
import { setPhoneView } from "./phoneView";
import { closeReader } from "./reader/useReader";
import { useWorkMap } from "./useWorks";
import { WHOLE_TRANSCRIPT } from "./transcriptScroll";

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

/** WHICH TRANSCRIPT DOCUMENT THE SCOPE NAMES. The whole conversation and a
 *  chat about one work are two documents in the same scroller, and where the
 *  reader is in each is kept per document (`./transcriptScroll.ts`). Derived
 *  here, beside the scope it is a function of, so the transcript, the
 *  composer and the pill all name the same document with no copy of it
 *  anywhere. */
export const shownDocument = (): string => chatScope()?.id ?? WHOLE_TRANSCRIPT;

/** POINT THE CHAT AT A WORK: the reader gives way, and the chat shows the
 *  turns about it. What picking a work does (`workListing.ts`). */
export function pointChatAt(id: WorkId): void {
  closeReader();
  setScope(id);
}

/** "About this work": point the chat at it, and on a phone show the chat,
 *  so the chat it filtered is the thing on screen. */
export function aboutWork(id: WorkId): void {
  pointChatAt(id);
  setPhoneView("chat");
}

/** "Show all", and the scope chip's × in the box. */
export function showAllChat(): void {
  setScope(null);
}
