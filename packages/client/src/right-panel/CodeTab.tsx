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

import { useSurfaceApp } from "@kolu/surface-app/solid";
import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { type Component, ErrorBoundary, lazy, Suspense } from "solid-js";

const CodeTabImpl = lazy(() => import("./CodeTabImpl"));

const CodeTab: Component<{
  terminalId: TerminalId | null;
  meta: TerminalMetadata | null;
}> = (props) => {
  const pwa = useSurfaceApp();

  return (
    // The chunk fetch can REJECT — not just pend — and Suspense only covers the
    // pending promise. After a deploy the server swaps `KOLU_CLIENT_DIST` and
    // serves `no-store` on the shell but `/assets/*` 404s for a build that's no
    // longer current; a long-lived tab that opens Code for the first time AFTER
    // the swap (before reloading) requests a now-missing CodeTabImpl chunk and
    // the import rejects. Without this boundary that rejection throws an
    // uncaught UI error (violating "a caught error must not collapse to empty");
    // the update overlay is click-through, so the user can reach this state. The
    // ErrorBoundary routes the failure to the SAME reload affordance the update
    // overlay uses (`useSurfaceApp().reload()` → `location.reload()` onto the
    // fresh shell), so a stale-chunk miss self-heals via the existing path.
    <ErrorBoundary
      fallback={
        <div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-xs text-fg-3">
          <div>Couldn’t load the Code tab — the app was updated.</div>
          <button
            type="button"
            class="bg-accent text-surface-1 font-semibold rounded px-3 py-1.5 hover:opacity-90"
            onClick={() => pwa.reload()}
          >
            Reload
          </button>
        </div>
      }
    >
      <Suspense
        fallback={
          <div class="flex h-full items-center justify-center text-xs text-fg-3/50">
            Loading…
          </div>
        }
      >
        <CodeTabImpl terminalId={props.terminalId} meta={props.meta} />
      </Suspense>
    </ErrorBoundary>
  );
};

export default CodeTab;
