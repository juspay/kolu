/** Kolu's iframe rendered-appliance: the generic sandboxed `IframeRenderer`
 *  from `@kolu/solid-fileview` wired to the artifact-sdk comment bridge
 *  (`CommentIframeSurface`). Comments are a kolu feature, so the bridge lives
 *  here in the consumer's renderer construction, not in the library — the
 *  library frame just exposes its element via `ref` for a host to bind.
 *
 *  HTML only carries the spliced `<script src="/api/artifact-sdk.js">`; SVG
 *  and PDF are served verbatim, so the bridge simply finds no SDK and stays
 *  inert there. */

import { observeIframeNavigation } from "@kolu/artifact-sdk/client";
import { pathFromPreviewPathname } from "@kolu/solid-browser";
import { IframeRenderer } from "@kolu/solid-fileview/renderers/iframe";
import { decodePreviewPath, encodePreviewPath } from "kolu-common/preview";
import {
  type Component,
  createEffect,
  createSignal,
  onCleanup,
} from "solid-js";
import { CommentIframeSurface } from "../comments/CommentIframeSurface";

// kolu's preview-URL codec — the same `encodePreviewPath` the server's
// `buildIframePreviewUrl` uses. Bound here (the inversion's only caller) and
// passed to the agnostic `pathFromPreviewPathname`, so the inversion can't
// drift from the encoding without a second source of truth.
const previewCodec = { encode: encodePreviewPath, decode: decodePreviewPath };

export type BrowseIframeRendererProps = {
  terminalId: string;
  path: string;
  url: string;
  /** Follow a same-frame link click to another repo file: the in-iframe SDK
   *  reports the loaded document's pathname, which we map back to a repo path
   *  and hand to the host so the file tree selection follows the navigation. */
  onNavigate?: (path: string) => void;
};

const BrowseIframeRenderer: Component<BrowseIframeRendererProps> = (props) => {
  const [iframeEl, setIframeEl] = createSignal<HTMLIFrameElement | undefined>();

  // The in-iframe SDK posts its `location.pathname` on every document boot,
  // including the boot after an in-iframe `<a>` click — the opaque-origin
  // sandbox blocks the parent from reading `contentWindow.location` directly.
  // When the reported path differs from the one we're showing, the user
  // followed a link to another file: tell the host so the tree selection (and
  // this preview, on remount) follow. The initial boot reports the path we
  // already show, so it's a no-op.
  createEffect(() => {
    const el = iframeEl();
    if (!el) return;
    // All three props are read live inside the callback (which fires on a
    // postMessage, outside this tracking scope) rather than captured here —
    // so a changed `onNavigate`/`url`/`path` is reflected without re-binding
    // the listener, and the effect depends only on the iframe element.
    const dispose = observeIframeNavigation(el, (pathname) => {
      const next = pathFromPreviewPathname(
        pathname,
        props.url,
        props.path,
        previewCodec,
      );
      if (next !== null && next !== props.path) props.onNavigate?.(next);
    });
    onCleanup(dispose);
  });

  return (
    <>
      <IframeRenderer path={props.path} url={props.url} ref={setIframeEl} />
      <CommentIframeSurface
        terminalId={props.terminalId}
        path={props.path}
        iframe={iframeEl()}
      />
    </>
  );
};

export default BrowseIframeRenderer;
