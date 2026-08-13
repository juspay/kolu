/**
 * kolu's LOOK for an uncaught client throw — the markup half of the fault
 * surface whose catch/record/print half is `SurfaceFaultBoundary`
 * (`@kolu/surface-app/solid`, composed by `<SurfaceAppProvider fault={…}>` in
 * `../index.tsx`). Without it a client that threw mid-render was a white tab:
 * Solid unmounts the subtree that faulted, and every in-app error surface kolu
 * has (toasts, the transport overlay, per-member `onError` policies) rides the
 * tree that just came down.
 *
 * The text is VERBATIM and scrollable rather than wrapped away: it is what a
 * bug report is made of, and a fault surface that summarised the fault would
 * be the white tab with extra steps. The one way out is the framework's
 * reload — it lands on the `no-store` shell and the bundle that shell names
 * (kolu#1319), which matters more here than anywhere, since a stale bundle may
 * be the very thing that threw.
 */
import { reloadForUpdate } from "@kolu/surface-app/lifecycle";
import type { Component } from "solid-js";

export const Fault: Component<{ text: string }> = (props) => (
  <main
    class="fixed inset-0 z-50 flex items-center justify-center bg-surface-0 p-8"
    data-testid="client-fault"
  >
    <div class="max-w-3xl">
      <h1 class="mb-2 text-2xl font-bold text-danger">kolu broke</h1>
      <p class="mb-4 text-sm text-fg-3">
        Something in this page threw while it was being drawn, so what was on
        screen is gone and nothing here will update again. Your terminals keep
        running — nothing kolu draws touches them.
      </p>
      <pre
        class="mb-4 max-h-[50vh] max-w-full overflow-auto rounded border border-edge/60 bg-surface-1 p-3 font-mono text-xs text-fg"
        data-testid="client-fault-detail"
      >
        {props.text}
      </pre>
      <button
        type="button"
        class="bg-accent text-surface-1 font-semibold rounded px-3 py-1.5 hover:opacity-90"
        onClick={reloadForUpdate}
      >
        Reload
      </button>
    </div>
  </main>
);
