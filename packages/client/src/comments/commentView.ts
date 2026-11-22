/** ONE COMMENT-CAPTURING VIEW'S OWN COMMENT STATE — its draft and its scroll
 *  request, provided by the view to everything drawn inside it.
 *
 *  Two views that capture comments can be mounted at once (the Right panel's
 *  Code view under the Conductor, a work's reader, a work's Code view). A
 *  draft belongs to the view it was opened in, and so does a request to
 *  scroll to a comment: held in one value for the whole page, a draft opened
 *  in one was drawn by every mounted composer and closed by any view's
 *  navigation, and a jump in one flipped another's Source ⇄ Rendered toggle
 *  and could be cleared by another's overlay. So each view creates one with
 *  {@link createCommentView} and provides it through {@link CommentView};
 *  the surfaces, the overlay, the viewer and the composer inside it read it.
 *
 *  Read outside a provider, the hooks THROW: a surface that captured a
 *  comment with no view to hold the draft would offer to comment and then
 *  swallow it (`ui/shown.ts` makes the same call for `useShown`). */

import { createContext, useContext } from "solid-js";
import { type Composer, createComposer } from "./composerState";
import { createScrollRequests, type ScrollRequests } from "./scrollRequest";

export interface CommentViewState {
  readonly composer: Composer;
  readonly scroll: ScrollRequests;
}

export const CommentView = createContext<CommentViewState>();

/** A fresh draft and scroll request for one view. */
export function createCommentView(): CommentViewState {
  return { composer: createComposer(), scroll: createScrollRequests() };
}

function useCommentView(): CommentViewState {
  const view = useContext(CommentView);
  if (!view)
    throw new Error(
      "A comment surface must be drawn inside the view that holds its draft (CommentView)",
    );
  return view;
}

/** The draft of the view this is drawn in. */
export function useComposer(): Composer {
  return useCommentView().composer;
}

/** The scroll request of the view this is drawn in. */
export function useCommentScrollRequest(): ScrollRequests {
  return useCommentView().scroll;
}
