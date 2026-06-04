/** Request slot for "scroll the file viewer to a specific comment's
 *  anchor after navigation lands". The tray sets this when the user
 *  clicks a tray item; the highlight overlay consumes it after applying
 *  CSS Highlights, then scrolls the matching range into view and clears
 *  the slot. One-shot — repeat clicks set fresh values.
 *
 *  Lives in its own module because it's signal state with a tiny
 *  surface area; the composer state machine in `composerState.ts` is
 *  about the in-flight draft and shares nothing with scroll-target
 *  hand-off. */

import { createSignal } from "solid-js";

export type ScrollRequest = {
  commentId: string;
  /** Repo-relative path of the target comment — lets a surface decide whether
   *  a pending request is for the file it's showing before acting on it. */
  path: string;
  /** Which browse surface the target comment lives on, when the file is
   *  multi-surface (Markdown's Source ⇄ Rendered). The dispatcher flips the
   *  toggle to this surface before the overlay re-finds the quote, so a jump
   *  to a prose comment can't land on the source view (where the rendered
   *  quote may not exist). Absent for single-surface comments. */
  surface?: "source" | "prose";
};

const [scrollReq, setScrollReq] = createSignal<ScrollRequest | null>(null);

export function useCommentScrollRequest() {
  return {
    request: scrollReq,
    set: (r: ScrollRequest): void => {
      setScrollReq(r);
    },
    clear: (): void => {
      setScrollReq(null);
    },
  };
}
