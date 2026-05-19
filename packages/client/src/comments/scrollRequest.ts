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

export type ScrollRequest = { commentId: string };

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
