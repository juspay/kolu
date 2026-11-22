/** Request slot for "scroll the file viewer to a specific comment's
 *  anchor after navigation lands" — ONE per comment-capturing view, held
 *  through `createCommentView`. The view's tray sets it when the user clicks
 *  a tray item; that view's highlight overlay consumes it after applying CSS
 *  Highlights, then scrolls the matching range into view and clears the
 *  slot, and that view's file viewer flips its Source ⇄ Rendered toggle to
 *  it. Another view mounted at the same time — even on the same terminal and
 *  the same file — never sees it. One-shot — repeat clicks set fresh values.
 *
 *  Lives apart from the composer state machine: that is about the in-flight
 *  draft and shares nothing with scroll-target hand-off. */

import { type Accessor, createSignal } from "solid-js";

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

/** One view's scroll-request slot. */
export interface ScrollRequests {
  readonly request: Accessor<ScrollRequest | null>;
  readonly set: (r: ScrollRequest) => void;
  readonly clear: () => void;
}

export function createScrollRequests(): ScrollRequests {
  const [request, setRequest] = createSignal<ScrollRequest | null>(null);
  return {
    request,
    set: (r) => setRequest(r),
    clear: () => setRequest(null),
  };
}
