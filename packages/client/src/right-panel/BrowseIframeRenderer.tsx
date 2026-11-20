import {
  observeIframeDeepLink,
  observeIframeHistory,
  observeIframeNavigation,
  observeIframeOpenExternal,
} from "@kolu/artifact-sdk/client";
import { pathFromPreviewPathname } from "@kolu/solid-browser";
import { IframeRenderer } from "@kolu/solid-fileview/renderers/iframe";
import { previewPathCodec } from "kolu-common/preview";
import {
  type Component,
  createEffect,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import { CommentIframeSurface } from "../comments/CommentIframeSurface";

export type BrowseIframeRendererProps = {
  terminalId: string | null;
  path: string;
  url: string;
  onNavigate?: (path: string) => void;
  onHistory?: (direction: "back" | "forward") => void;
  onOpenExternal?: (url: string) => void;
  onDeepLink?: (hash: string) => void;
};

function bindSandboxMessageBridge(
  iframeEl: () => HTMLIFrameElement | undefined,
  observe: (el: HTMLIFrameElement) => () => void,
): void {
  createEffect(() => {
    const el = iframeEl();
    if (!el) return;
    onCleanup(observe(el));
  });
}

const BrowseIframeRenderer: Component<BrowseIframeRendererProps> = (props) => {
  const [iframeEl, setIframeEl] = createSignal<HTMLIFrameElement | undefined>();

  bindSandboxMessageBridge(iframeEl, (el) =>
    observeIframeNavigation(el, (pathname) => {
      const next = pathFromPreviewPathname(
        pathname,
        props.url,
        props.path,
        previewPathCodec,
      );
      if (next !== null && next !== props.path) props.onNavigate?.(next);
    }),
  );

  bindSandboxMessageBridge(iframeEl, (el) =>
    observeIframeHistory(el, (direction) => props.onHistory?.(direction)),
  );

  bindSandboxMessageBridge(iframeEl, (el) =>
    observeIframeOpenExternal(el, (url) => props.onOpenExternal?.(url)),
  );

  bindSandboxMessageBridge(iframeEl, (el) =>
    observeIframeDeepLink(el, (hash) => props.onDeepLink?.(hash)),
  );

  return (
    <>
      <IframeRenderer path={props.path} url={props.url} ref={setIframeEl} />
      <Show when={props.terminalId}>
        {(id) => (
          <CommentIframeSurface
            terminalId={id()}
            path={props.path}
            iframe={iframeEl()}
          />
        )}
      </Show>
    </>
  );
};

export default BrowseIframeRenderer;
