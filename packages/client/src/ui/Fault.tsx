import { useSurfaceApp } from "@kolu/surface-app/solid";
import type { Component } from "solid-js";

export const Fault: Component<{ text: string }> = (props) => {
  const pwa = useSurfaceApp();
  return (
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
          onClick={() => pwa.reload()}
        >
          Reload
        </button>
      </div>
    </main>
  );
};
