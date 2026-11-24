/** Wrap a sandboxed iframe (HTML artifact preview) with the artifact-sdk
 *  postMessage bridge: capture user selections inside the iframe, route
 *  them to the shared composer, and push the current file's comments
 *  back to the SDK for in-iframe highlighting.
 *
 *  Sibling to `CommentTextSurface` — text browse and branch diff use
 *  selectionchange-based capture there; iframe HTML uses postMessage
 *  capture here. Both open the composer of the view they are drawn in, and
 *  read the one comments store. */

import { bindArtifactSdk, pushHighlightsTo } from "@kolu/artifact-sdk/client";
import { type Component, createEffect, createMemo } from "solid-js";
import { useComposer } from "./commentView";
import { commentsForTerminal } from "./useComments";

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
  const comments = commentsForTerminal(() => props.terminalId);
  const commentsForFile = createMemo(() =>
    comments()
      .commentsForPath(props.path)
      .map((c) => ({ id: c.id, locator: c.locator })),
  );

  // Bind the bridge whenever the iframe element ticks. `onDocumentReady`
  // covers the lifecycle trigger (initial `ready` + in-iframe `load`);
  // the reactive push effect below covers data-change pushes. Two
  // orthogonal triggers, one push path — no double-broadcast, no
  // "highlights vanish after in-iframe navigation" bug.
  createEffect(
    () => props.iframe,
    (el) => {
      if (!el) return;
      // The bridge's disposer is the effect's cleanup: it runs before the
      // next iframe binds and on disposal.
      return bindArtifactSdk(el, {
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
    },
  );

  // Re-push the comment set whenever it changes — the SDK re-applies
  // CSS Custom Highlights inside the iframe with the new range list.
  createEffect(
    () => ({ el: props.iframe, list: commentsForFile() }),
    ({ el, list }) => {
      if (!el) return;
      pushHighlightsTo(el, list);
    },
  );

  return null;
};

export default CommentIframeSurface;
