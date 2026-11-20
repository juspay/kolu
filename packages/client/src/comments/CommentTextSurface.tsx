import {
  type Component,
  createMemo,
  createSignal,
  type JSX,
  Show,
} from "solid-js";
import { useHighlightOverlay } from "./highlightOverlay";
import { SelectionPill } from "./SelectionPill";
import type { BrowseSurface } from "./types";
import { commentsForTerminal } from "./useComments";
import { useTextSelection } from "./useTextSelection";

export type CommentTextSurfaceProps = {
  terminalId: string;
  /** Repo-relative path the captured comments anchor to. */
  path: string;
  contentTick?: string;
  /** Forwarded to the host `<div>` — usually `"h-full w-full"`. */
  class?: string;
  /** When false, captured comments carry no source `lineRange` — set by
   *  rendered surfaces (the Markdown preview) where a rendered-DOM line
   *  isn't a source line. Required — callers must make a deliberate choice. */
  lineAnchored: boolean;
  /** Which browse surface this is, when the file offers a Source ⇄ Rendered
   *  toggle (Markdown). Recorded on captured comments so the tray jump can
   *  flip the toggle back. Omit for single-surface views (plain source, diff). */
  surface?: BrowseSurface;
  children: JSX.Element;
};

export const CommentTextSurface: Component<CommentTextSurfaceProps> = (
  props,
) => {
  const [host, setHost] = createSignal<HTMLDivElement | undefined>();
  const selection = useTextSelection({
    host,
    path: () => props.path,
    lineAnchored: () => props.lineAnchored,
    surface: () => props.surface,
  });
  const comments = commentsForTerminal(() => props.terminalId);
  const commentsForFile = createMemo(() =>
    comments()
      .commentsForPath(props.path)
      .filter((c) => c.surface === props.surface),
  );
  useHighlightOverlay({
    host,
    comments: commentsForFile,
    contentTick: () => props.contentTick,
    observeMutations: !props.lineAnchored,
    surface: () => props.surface,
  });

  return (
    <>
      <div ref={setHost} class={props.class}>
        {props.children}
      </div>
      <Show when={selection.captured()}>
        {(cap) => (
          <SelectionPill
            rect={cap().rect}
            unavailable={cap().unavailable}
            onActivate={selection.activate}
          />
        )}
      </Show>
    </>
  );
};

export default CommentTextSurface;
