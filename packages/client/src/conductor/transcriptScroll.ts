/** WHERE THE READER IS IN THE CONVERSATION — one fact, outside any mount.
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

import { createSignal } from "solid-js";

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

/** `null` means AT THE END, which is not the same as "offset 0 remembered" and
 *  not the same as a pixel value either: the column grows between mounts, so a
 *  reader who was at the end must land at the NEW end, not at the old end's
 *  coordinate. It is also the opening state — a conversation you have never
 *  scrolled opens at its newest line.
 *
 *  A SIGNAL, because the pill reads it: "not pinned" is precisely when the
 *  reader is owed a way back to the end, and a plain `let` would leave that
 *  button stale. */
const [offset, setOffset] = createSignal<number | null>(null);

/** Is the view following the conversation? The one question the render path
 *  asks — never the element, which by then is describing the new content. */
export function transcriptPinned(): boolean {
  return offset() === null;
}

/** The view moved: record where the reader is now. Called from the container's
 *  own `scroll`, which fires for a wheel, a drag, a keypress and our own pin
 *  alike — so there is no path that moves the view without this seeing it. Our
 *  own pin lands at the end and therefore re-states `null`, which is what it
 *  meant. */
export function rememberTranscriptScroll(el: ScrollMetrics): void {
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

/** Put a freshly mounted container back where the reader left it — or at the
 *  end, if that is where they were. */
export function applyTranscriptScroll(el: {
  scrollTop: number;
  readonly scrollHeight: number;
}): void {
  el.scrollTop = offset() ?? el.scrollHeight;
}

/** What is remembered, for tests and for nothing else. */
export function transcriptScrollOffset(): number | null {
  return offset();
}

