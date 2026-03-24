/** Web view panel — URL bar + iframe for previewing web apps inline. */

import { type Component, createSignal, createEffect, on } from "solid-js";
import { formatKeybind, SHORTCUTS } from "./keyboard";

const WebView: Component<{
  url: string;
  onUrlChange: (url: string) => void;
  onClose: () => void;
}> = (props) => {
  const [draft, setDraft] = createSignal(props.url);
  // Track a reload key to force iframe refresh
  const [reloadKey, setReloadKey] = createSignal(0);

  // Sync draft when URL changes externally (e.g. Ctrl+Click from terminal)
  createEffect(
    on(
      () => props.url,
      (url) => setDraft(url),
      { defer: true },
    ),
  );

  function navigate() {
    const url = draft().trim();
    if (url) props.onUrlChange(url);
  }

  return (
    <div class="flex flex-col h-full min-w-0">
      {/* URL bar */}
      <div class="flex items-center gap-1.5 px-2 py-1 border-b border-edge bg-surface-1 shrink-0">
        <input
          type="url"
          class="flex-1 min-w-0 px-2 py-0.5 text-xs bg-surface-0 text-fg border border-edge rounded focus:outline-none focus:ring-1 focus:ring-accent/50"
          placeholder="Enter URL..."
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigate();
          }}
        />
        <button
          class="p-1 text-fg-2 hover:text-fg hover:bg-surface-2 rounded transition-colors cursor-pointer"
          onClick={() => setReloadKey((k) => k + 1)}
          title="Refresh"
        >
          <svg
            class="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
        <button
          class="p-1 text-fg-2 hover:text-fg hover:bg-surface-2 rounded transition-colors cursor-pointer"
          onClick={() => props.onClose()}
          title={`Close web view (${formatKeybind(SHORTCUTS.toggleWebView.keybind)})`}
        >
          <svg
            class="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
      {/* iframe */}
      {props.url ? (
        <iframe
          src={`${props.url}${props.url.includes("?") ? "&" : "?"}_kolu_reload=${reloadKey()}`}
          class="flex-1 border-0 bg-white min-h-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      ) : (
        <div class="flex-1 flex items-center justify-center text-fg-3 text-sm">
          Enter a URL above or Ctrl+Click a link in the terminal
        </div>
      )}
    </div>
  );
};

export default WebView;
