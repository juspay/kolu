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
 *  viewport is AT the end, and leaves it alone once somebody scrolled up. Here
 *  that single predicate — {@link atEnd} — decides both what to remember and
 *  whether a new frame may pin the view, so the two can never disagree. */

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

/** Is the view at the end? The one predicate — asked of a live element to
 *  decide whether a new frame may pin it, and asked again at scroll time to
 *  decide what to remember. */
export function atEnd(el: ScrollMetrics): boolean {
  return (
    el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK_PX + 1
  );
}

/** `null` means AT THE END, which is not the same as "offset 0 remembered" and
 *  not the same as a pixel value either: the column grows between mounts, so a
 *  reader who was at the end must land at the NEW end, not at the old end's
 *  coordinate. It is also the opening state — a conversation you have never
 *  scrolled opens at its newest line. */
let offset: number | null = null;

/** The view moved: record where the reader is now. Called from the container's
 *  own `scroll`, which fires for a wheel, a drag, a keypress and our own pin
 *  alike — so there is no path that moves the view without this seeing it. */
export function rememberTranscriptScroll(el: ScrollMetrics): void {
  offset = atEnd(el) ? null : el.scrollTop;
}

/** Put a freshly mounted container back where the reader left it — or at the
 *  end, if that is where they were. */
export function applyTranscriptScroll(el: {
  scrollTop: number;
  readonly scrollHeight: number;
}): void {
  el.scrollTop = offset ?? el.scrollHeight;
}

/** What is remembered, for tests and for nothing else. */
export function transcriptScrollOffset(): number | null {
  return offset;
}

/** Back to the opening state. Tests reset with it; a new session uses it, since
 *  the offset of a transcript that was replaced wholesale means nothing. */
export function forgetTranscriptScroll(): void {
  offset = null;
}
