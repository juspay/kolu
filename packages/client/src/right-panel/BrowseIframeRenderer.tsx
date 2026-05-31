/** Kolu's iframe rendered-appliance: the generic sandboxed `IframeRenderer`
 *  from `@kolu/solid-fileview` wired to the artifact-sdk comment bridge
 *  (`CommentIframeSurface`). Comments are a kolu feature, so the bridge lives
 *  here in the consumer's renderer construction, not in the library — the
 *  library frame just exposes its element via `ref` for a host to bind.
 *
 *  HTML only carries the spliced `<script src="/api/artifact-sdk.js">`; SVG
 *  and PDF are served verbatim, so the bridge simply finds no SDK and stays
 *  inert there. */

import { IframeRenderer } from "@kolu/solid-fileview/renderers/iframe";
import { type Component, createSignal } from "solid-js";
import { CommentIframeSurface } from "../comments/CommentIframeSurface";

export type BrowseIframeRendererProps = {
  terminalId: string;
  path: string;
  url: string;
};

const BrowseIframeRenderer: Component<BrowseIframeRendererProps> = (props) => {
  const [iframeEl, setIframeEl] = createSignal<HTMLIFrameElement | undefined>();
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
