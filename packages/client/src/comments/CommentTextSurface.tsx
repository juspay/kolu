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

import { type Component, createMemo, createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useHighlightOverlay } from "./highlightOverlay";
import { SelectionPill } from "./SelectionPill";
import type { CommentQueue } from "./types";
import { commentsFor } from "./useComments";
import { useTextSelection } from "./useTextSelection";

export type CommentTextSurfaceProps = {
  /** The queue a comment is filed in, or `null` while there is none — a kept
   *  file nobody can be pointed back at, or a Code tab with no terminal yet.
   *  With none, the view is drawn exactly the same and only commenting is
   *  off; a queue arriving or leaving turns it on or off around the SAME
   *  drawn view, never moving it. */
  queue: CommentQueue | null;
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
   *  isn't a source line. Required — callers must make a deliberate choice. */
  lineAnchored: boolean;
  /** Which browse surface this is, when the file offers a Source ⇄ Rendered
   *  toggle (Markdown). Recorded on captured comments so the tray jump can
   *  flip the toggle back. Omit for single-surface views (plain source, diff). */
  surface?: "source" | "prose";
  children: JSX.Element;
};

/** COMMENTING ON ONE HOST ELEMENT, for one queue: the selection adapter,
 *  the highlight overlay and the pill. Mounted beside the host it reads, so
 *  it comes and goes with the queue while the view inside the host stays
 *  where it is; going, it takes its highlights and listeners with it. */
const Commenting: Component<
  Omit<CommentTextSurfaceProps, "queue" | "class" | "children"> & {
    queue: CommentQueue;
    host: () => HTMLDivElement | undefined;
  }
> = (props) => {
  const selection = useTextSelection({
    host: props.host,
    path: () => props.path,
    lineAnchored: () => props.lineAnchored,
    surface: () => props.surface,
  });
  // `commentsFor` re-derives the store when `props.queue` changes, so
  // switching terminals or works re-reads that queue.
  const comments = commentsFor(() => props.queue);
  // Filter to THIS surface's comments. Markdown's Source ⇄ Rendered toggle now
  // keeps both surfaces mounted at once, so a path-only filter would feed each
  // overlay the other surface's comments too — a prose quote ("Hello Doc")
  // highlighted on the source view ("# Hello Doc") if it happened to match, and
  // both surfaces racing to handle the same comment. A comment's `surface` is
  // recorded only for multi-surface files (Markdown); single-surface views
  // (plain source, diff) leave it and `props.surface` undefined, so the exact
  // match still admits every comment there.
  const commentsForFile = createMemo(() =>
    comments()
      .commentsForPath(props.path)
      .filter((c) => c.surface === props.surface),
  );
  useHighlightOverlay({
    host: props.host,
    comments: commentsForFile,
    contentTick: () => props.contentTick,
    // Prose surfaces (the Markdown preview) replace their light-DOM subtree
    // after mount (lazy Shiki re-render), so the overlay must re-anchor on
    // subtree mutation. Source / diff (line-anchored) ride contentTick alone —
    // their virtualized subtree churns on scroll and must not drive re-applies.
    observeMutations: !props.lineAnchored,
    surface: () => props.surface,
  });

  return (
    <Show when={selection.captured()}>
      {(cap) => (
        <SelectionPill
          rect={cap().rect}
          unavailable={cap().unavailable}
          onActivate={selection.activate}
        />
      )}
    </Show>
  );
};

export const CommentTextSurface: Component<CommentTextSurfaceProps> = (
  props,
) => {
  const [host, setHost] = createSignal<HTMLDivElement | undefined>();
  return (
    <>
      {/* THE HOST, always: the view inside it is mounted once, whatever
          becomes of the queue. */}
      <div ref={setHost} class={props.class}>
        {props.children}
      </div>
      <Show when={props.queue}>
        {(queue) => (
          <Commenting
            queue={queue()}
            host={host}
            path={props.path}
            contentTick={props.contentTick}
            lineAnchored={props.lineAnchored}
            surface={props.surface}
          />
        )}
      </Show>
    </>
  );
};

export default CommentTextSurface;
