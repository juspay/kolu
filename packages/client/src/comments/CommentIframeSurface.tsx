import { bindArtifactSdk, pushHighlightsTo } from "@kolu/artifact-sdk/client";
import { type Component, createEffect, createMemo, onCleanup } from "solid-js";
import { useComposer } from "./composerState";
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
  const comments = commentsForTerminal(() => props.terminalId);
  const commentsForFile = createMemo(() =>
    comments()
      .commentsForPath(props.path)
      .map((c) => ({ id: c.id, locator: c.locator })),
  );

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

  createEffect(() => {
    const el = props.iframe;
    const list = commentsForFile();
    if (!el) return;
    pushHighlightsTo(el, list);
  });

  return null;
};

export default CommentIframeSurface;
