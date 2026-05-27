/** Wrap a sandboxed iframe (HTML artifact preview) with the artifact-sdk
 *  postMessage bridge: capture user selections inside the iframe, route
 *  them to the shared composer, and push the current file's comments
 *  back to the SDK for in-iframe highlighting.
 *
 *  Sibling to `CommentTextSurface` — text browse and branch diff use
 *  selectionchange-based capture there; iframe HTML uses postMessage
 *  capture here. The composer and the comments store are the same
 *  singletons for both. */

import { bindArtifactSdk, pushHighlightsTo } from "@kolu/artifact-sdk/client";
import { type Component, createEffect, createMemo, onCleanup } from "solid-js";
import { useComposer } from "./composerState";
import { useComments } from "./useComments";

export type CommentIframeSurfaceProps = {
  terminalId: string;
  path: string;
  iframe: HTMLIFrameElement | undefined;
};

export const CommentIframeSurface: Component<CommentIframeSurfaceProps> = (
  props,
) => {
  const composer = useComposer();
  // `createMemo` re-derives the store when `props.terminalId` changes,
  // so switching terminals re-reads the per-terminal queue.
  const comments = createMemo(() => useComments(props.terminalId));
  const commentsForFile = createMemo(() =>
    comments()
      .commentsForPath(props.path)
      .map((c) => ({ id: c.id, locator: c.locator })),
  );

  // Bind the bridge whenever the iframe element ticks. `onDocumentReady`
  // covers the lifecycle trigger (initial `ready` + in-iframe `load`);
  // the reactive `createEffect` below covers data-change pushes. Two
  // orthogonal triggers, one push path — no double-broadcast, no
  // "highlights vanish after in-iframe navigation" bug.
  createEffect(() => {
    const el = props.iframe;
    if (!el) return;
    const dispose = bindArtifactSdk(el, {
      currentPath: () => props.path,
      onDocumentReady: () => pushHighlightsTo(el, commentsForFile()),
      onSelect: (msg) => {
        const rect = el.getBoundingClientRect();
        composer.open({
          path: msg.path,
          locator: msg.locator,
          // Translate iframe-local coordinates to parent viewport so
          // the composer Portal lands over the visible selection
          // rather than the iframe's top-left corner.
          rect: {
            x: rect.left + msg.rect.x,
            y: rect.top + msg.rect.y,
            width: msg.rect.width,
            height: msg.rect.height,
          },
        });
      },
    });
    onCleanup(dispose);
  });

  // Re-push the comment set whenever it changes — the SDK re-applies
  // CSS Custom Highlights inside the iframe with the new range list.
  createEffect(() => {
    const el = props.iframe;
    const list = commentsForFile();
    if (!el) return;
    pushHighlightsTo(el, list);
  });

  return null;
};

export default CommentIframeSurface;
