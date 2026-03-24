/** Per-terminal web view state — keyed store persisted to localStorage. */

import { type Accessor, createMemo } from "solid-js";
import { createStore } from "solid-js/store";
import { makePersisted } from "@solid-primitives/storage";
import type { TerminalId } from "kolu-common";

interface WebViewState {
  url: string;
  open: boolean;
}

const [store, setStore] = makePersisted(
  createStore<Record<TerminalId, WebViewState>>({}),
  { name: "kolu-webview" },
);

/**
 * Per-terminal web view state hook.
 * Takes `activeId` accessor from useTerminals to derive active terminal's web view state.
 */
export function useWebView(activeId: Accessor<TerminalId | null>) {
  /** Get web view state for a specific terminal. */
  function getState(id: TerminalId): WebViewState | undefined {
    return store[id];
  }

  /** Set URL and open the panel for a specific terminal. */
  function openUrl(id: TerminalId, url: string) {
    setStore(id, { url, open: true });
  }

  /** Toggle the web view panel for a specific terminal. */
  function toggleWebView(id: TerminalId) {
    const current = store[id];
    if (current) {
      setStore(id, "open", !current.open);
    } else {
      setStore(id, { url: "", open: true });
    }
  }

  /** Set the URL for a specific terminal (without changing open state). */
  function setUrl(id: TerminalId, url: string) {
    const current = store[id];
    if (current) {
      setStore(id, "url", url);
    } else {
      setStore(id, { url, open: true });
    }
  }

  /** Close the web view panel for a specific terminal. */
  function closeWebView(id: TerminalId) {
    const current = store[id];
    if (current) setStore(id, "open", false);
  }

  // Derived memos for the active terminal
  const activeWebViewOpen = createMemo(() => {
    const id = activeId();
    return id !== null && (store[id]?.open ?? false);
  });

  const activeWebViewUrl = createMemo(() => {
    const id = activeId();
    return id !== null ? (store[id]?.url ?? "") : "";
  });

  return {
    getState,
    openUrl,
    toggleWebView,
    setUrl,
    closeWebView,
    activeWebViewOpen,
    activeWebViewUrl,
  } as const;
}
