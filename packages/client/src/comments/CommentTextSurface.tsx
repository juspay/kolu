/** Wrap a text viewer with the comments capture + overlay wiring: one host
 *  div, one selection adapter, one highlight overlay, one pill. The inner
 *  view is supplied via `children` — Pierre's `CodeView` (source / diff,
 *  shadow DOM) or the rendered Markdown preview (light DOM). The selection
 *  adapter anchors the quote against whichever root actually contains the
 *  selection (shadow root or this host element), so both work unchanged.
 *
 *  Iframe-rendered HTML artifacts use the artifact-sdk bridge instead;
 *  selection capture happens inside the opaque-origin iframe and arrives
 *  via postMessage, not native selectionchange on this side. */

import {
  type Component,
  createMemo,
  createSignal,
  type JSX,
  Show,
} from "solid-js";
import { useHighlightOverlay } from "./highlightOverlay";
import { SelectionPill } from "./SelectionPill";
import { useComments } from "./useComments";
import { useTextSelection } from "./useTextSelection";

export type CommentTextSurfaceProps = {
  terminalId: string;
  /** Repo-relative path the captured comments anchor to. */
  path: string;
  /** Ticker — caller bumps when the host's text content changes so the
   *  highlight overlay re-runs `findQuote` against fresh node text.
   *  Pass the file content string for text browse; pass the diff hunk
   *  string for branch-diff. */
  contentTick?: unknown;
  /** Forwarded to the host `<div>` — usually `"h-full w-full"`. */
  class?: string;
  /** When false, captured comments carry no source `lineRange` — set by
   *  rendered surfaces (the Markdown preview) where a rendered-DOM line
   *  isn't a source line. Defaults to true (source / diff). */
  lineAnchored?: boolean;
  /** Which browse surface this is, when the file offers a Source ⇄ Rendered
   *  toggle (Markdown). Recorded on captured comments so the tray jump can
   *  flip the toggle back. Omit for single-surface views (plain source, diff). */
  surface?: "source" | "prose";
  children: JSX.Element;
};

export const CommentTextSurface: Component<CommentTextSurfaceProps> = (
  props,
) => {
  const [host, setHost] = createSignal<HTMLDivElement | undefined>();
  const selection = useTextSelection({
    host,
    path: () => props.path,
    lineAnchored: () => props.lineAnchored ?? true,
    surface: () => props.surface,
  });
  // `createMemo` re-derives the store when `props.terminalId` changes,
  // so switching terminals re-reads the per-terminal queue.
  const comments = createMemo(() => useComments(props.terminalId));
  const commentsForFile = createMemo(() =>
    comments().commentsForPath(props.path),
  );
  useHighlightOverlay({
    host,
    comments: commentsForFile,
    contentTick: () => props.contentTick,
    // Prose surfaces (the Markdown preview) replace their light-DOM subtree
    // after mount (lazy Shiki re-render), so the overlay must re-anchor on
    // subtree mutation. Source / diff (line-anchored) ride contentTick alone —
    // their virtualized subtree churns on scroll and must not drive re-applies.
    observeMutations: !(props.lineAnchored ?? true),
  });

  return (
    <>
      <div ref={setHost} class={props.class}>
        {props.children}
      </div>
      <Show when={selection.captured()}>
        {(cap) => (
          <SelectionPill rect={cap().rect} onActivate={selection.activate} />
        )}
      </Show>
    </>
  );
};

export default CommentTextSurface;
