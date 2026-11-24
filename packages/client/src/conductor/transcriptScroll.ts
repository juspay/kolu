/** WHERE THE READER IS IN THE CONVERSATION — one fact per DOCUMENT, outside
 *  any mount.
 *
 *  The pane is mounted only while the conductor entry is selected, so every
 *  activation hands the transcript a BRAND NEW scroll container sitting at 0.
 *  The follow rule alone cannot save that: a fresh container with a tall column
 *  in it is, by measurement, scrolled far from the end, so the rule correctly
 *  declines to move it and the reader lands at the top of a conversation they
 *  were at the bottom of. The conversation is one thing now; where you are in
 *  it belongs to your session, not to the element that happens to be drawing it
 *  (the same reason the composer's text lives in `drafts.ts`).
 *
 *  TWO DOCUMENTS, TWO PLACES. The same scroller shows the whole conversation
 *  and, when a work is picked, only the turns about that work. They are
 *  different documents: a place in one is not a place in the other. One shared
 *  place meant the browser clamping the shorter document to its end overwrote
 *  the reader's place in the whole conversation — read as "following", so
 *  coming back sent a reader who had scrolled up to the bottom. The place is
 *  therefore kept per document ({@link showTranscriptDocument}), and the
 *  clamp lands on the narrowed document, where "at the end" is true.
 *
 *  The rule itself is the terminal scrollback's, not a second one:
 *  `xterm-kit/src/solid/scrollLock.ts` follows new output only while the
 *  viewport is AT the end, and leaves it alone once somebody scrolled up.
 *
 *  AND "FOLLOWING" IS THE SAME FACT AS "WHERE THE READER IS", not a second one
 *  measured from the element. A follow rule that asks `atEnd(container)` after
 *  a chunk has already been drawn is asking about the CHUNK: the column just
 *  grew under a view that did not move, so the gap is the new content's height
 *  and the honest answer is "scrolled up" — about content that landed a
 *  millisecond ago. That is why the transcript stopped following. The question
 *  it means to ask is what the READER last did, which is exactly what this
 *  module already holds: `null` IS pinned. So the predicate is asked of a live
 *  element only when the reader themself moved it, and every frame after that
 *  reads the remembered answer. */

import { createSignal, createStore } from "solid-js";

/** How close to the bottom still counts as "following", in pixels. A couple of
 *  lines of slack, so a half-scrolled wheel notch does not unpin the view. */
export const FOLLOW_SLACK_PX = 48;

/** A scroll container, by the three numbers this module needs. Not
 *  `HTMLElement`: the measurements are the contract, and a test that cannot
 *  lay out a column can still state them. */
export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/** Is the view at the end? Asked ONLY of a movement the reader made — at
 *  `scroll` time, to decide what to remember — never after a frame drew new
 *  rows, where the gap it measures is the new content rather than an intent. */
export function atEnd(el: ScrollMetrics): boolean {
  return (
    el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK_PX + 1
  );
}

/** THE WHOLE CONVERSATION'S KEY. A chat narrowed to a work is keyed by that
 *  work's id (`chatScope`), so no work may ever be named this. */
export const WHOLE_TRANSCRIPT = "whole";

/** WHICH DOCUMENT THE SCROLLER SHOWS. The whole conversation and a chat about
 *  one work are two documents in the same element: one has every turn, the
 *  other only the turns about that work. Which one is shown is a fact about
 *  the pane, not about its layout, so it is set whether or not the pane is on
 *  screen. */
const [documentKey, setDocumentKey] = createSignal(WHOLE_TRANSCRIPT);

/** THE READER'S PLACE, PER DOCUMENT. `null` means at the end; no entry means
 *  the document has never been shown, which also opens at its newest line.
 *  The store makes `transcriptPinned` stay reactive as the shown document or
 *  its place changes. */
const [places, setPlaces] = createStore<Record<string, number | null>>({});

/** The scroller now shows `key`'s document. Called by the transcript from an
 *  effect on the chat's scope, above its follow effect. */
export function showTranscriptDocument(key: string): void {
  setDocumentKey(key);
}

/** THE READER'S PLACE IN `key`'s DOCUMENT, or `null` for its end — read by
 *  the transcript's follow effect in its COMPUTE (the effect phase may read
 *  nothing reactive) and by its mount restore. */
export function transcriptPlace(key: string): number | null {
  return places[key] ?? null;
}

/** The place in the document now shown, or `null` for its end. */
const offset = (): number | null => transcriptPlace(documentKey());

/** Write the place of the document now shown. Never another document's: a
 *  clamp inside a work's chat says where that chat is, not where the whole
 *  conversation was. */
const setOffset = (place: number | null): void => {
  const key = documentKey();
  setPlaces((all) => {
    all[key] = place;
  });
};

/** Is the view following the conversation? The one question the render path
 *  asks — never the element, which by then is describing the new content. */
export function transcriptPinned(): boolean {
  return offset() === null;
}

/** Where each scroller stood when this module last saw it: after its own
 *  writes, and at each `scroll`. What tells a reader who moved the view from
 *  a column that grew under a view nobody moved. */
const stood = new WeakMap<object, number>();

/** The view moved: record where the reader is now. Called from the container's
 *  own `scroll`, which fires for a wheel, a drag, a keypress and our own pin
 *  alike — so there is no path that moves the view without this seeing it.
 *
 *  A FOLLOWING VIEW IS LEFT ONLY BY MOVING UP. The browser dispatches `scroll`
 *  a frame after the view moved and measures the column as it is then: a pin
 *  to the end, then a work's question card drawn under it before that frame,
 *  and the event finds the view short of a new end it never left. Recorded as
 *  the reader's place, that short view is where the conversation would reopen.
 *  A view no higher than where it stood is still following. */
export function rememberTranscriptScroll(el: ScrollMetrics): void {
  const was = stood.get(el);
  stood.set(el, el.scrollTop);
  if (offset() === null && was !== undefined && el.scrollTop >= was) return;
  setOffset(atEnd(el) ? null : el.scrollTop);
}

/** The reader asked to go up, BEFORE the view has moved — a wheel notch, which
 *  the browser reports to us before it scrolls and dispatches `scroll`. The
 *  failure this prevents: a chunk landing in the same frame as that notch pins
 *  the view back to the end, and the `scroll` event that follows then measures
 *  the end and re-states `null` — the reader is dragged back and cannot get
 *  away. The `scroll` that follows corrects the pixel; this only decides that
 *  we are no longer following. */
export function unpinTranscript(el: ScrollMetrics): void {
  if (offset() === null) setOffset(el.scrollTop);
}

/** Follow the end again — the pill, a sent message, and a conversation that was
 *  replaced wholesale (whose remembered offset means nothing) all want exactly
 *  this, so it is one writer and not three. */
export function pinTranscript(): void {
  setOffset(null);
}

/** Put the container at `place` — the reader's pixel in the document being
 *  shown, or `null` for its end. A fresh mount, a document change and every
 *  step of following all land here.
 *
 *  THE PLACE IS HANDED IN rather than read from {@link transcriptPlace}: the
 *  caller is an effect's imperative half, which reads no reactive state, and
 *  the transcript writes the shown document and places the container in the
 *  same flush — where that write is not yet visible to a read anyway. */
export function applyTranscriptScroll(
  el: {
    scrollTop: number;
    readonly scrollHeight: number;
  },
  place: number | null,
): void {
  el.scrollTop = place ?? el.scrollHeight;
  stood.set(el, el.scrollTop);
}

/** Bring one row into view — the strip's "reveal this row". A row the
 *  transcript has folded into a "Details", or into a run of the same failure,
 *  is drawn inside a closed `<details>`, where it has no box to scroll to, so
 *  the disclosure holding it is opened first. That disclosure is the row's
 *  only `<details>` ANCESTOR (a card's own disclosures sit inside the row,
 *  never around it). Scoped to the transcript's own container: another
 *  mounted copy of the pane must not receive this one's reveal. */
export function revealTranscriptRow(container: Element, rowId: string): void {
  const row = container.querySelector(`[data-row-id="${CSS.escape(rowId)}"]`);
  if (row === null) return;
  const fold = row.closest("details");
  if (fold !== null) fold.open = true;
  row.scrollIntoView({ block: "center", behavior: "smooth" });
}
