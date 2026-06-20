/** CodeTab — the lazy/Suspense boundary for the heavy Code-tab chunk.
 *
 * The Code tab pulls a heavy main-thread chunk — the Pierre `FileTree`, the
 * `@kolu/solid-markdown` renderer (marked + DOMPurify), the diff/source view
 * wrappers, and the comment system — ~171 kB gzip that a static import would
 * weld onto the eager initial bundle for every session. This wrapper owns that
 * chunk-splitting + fallback as CodeTab's own loading strategy, so the
 * RightPanel router stays a pure dispatcher: it gates first-load via
 * `codeEverShown` and renders `<CodeTab/>`, knowing nothing about lazy/Suspense.
 * The chunk is fetched only on first render of this wrapper, then kept mounted
 * (so #818 state preservation across tab switches is unchanged). */

import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { type Component, lazy, Suspense } from "solid-js";

const CodeTabImpl = lazy(() => import("./CodeTabImpl"));

const CodeTab: Component<{
  terminalId: TerminalId | null;
  meta: TerminalMetadata | null;
}> = (props) => (
  <Suspense
    fallback={
      <div class="flex h-full items-center justify-center text-xs text-fg-3/50">
        Loading…
      </div>
    }
  >
    <CodeTabImpl terminalId={props.terminalId} meta={props.meta} />
  </Suspense>
);

export default CodeTab;
