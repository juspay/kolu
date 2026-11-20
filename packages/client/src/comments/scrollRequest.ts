import { createSignal } from "solid-js";
import type { BrowseSurface } from "./types";

export type ScrollRequest = {
  commentId: string;
  path: string;
  surface?: BrowseSurface;
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
