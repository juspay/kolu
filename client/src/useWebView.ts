/** Web view panel state — singleton module. Persists URL and open state to localStorage. */

import { createSignal } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";

const [webViewOpen, setWebViewOpen] = makePersisted(createSignal(false), {
  name: "kolu-webview-open",
  serialize: String,
  deserialize: (s) => s === "true",
});

const [webViewUrl, setWebViewUrl] = makePersisted(createSignal(""), {
  name: "kolu-webview-url",
});

/** Set URL and open the panel. */
function openUrl(url: string) {
  setWebViewUrl(url);
  setWebViewOpen(true);
}

export function useWebView() {
  return {
    webViewOpen,
    setWebViewOpen,
    toggleWebView: () => setWebViewOpen((prev) => !prev),
    webViewUrl,
    setWebViewUrl,
    openUrl,
  } as const;
}
