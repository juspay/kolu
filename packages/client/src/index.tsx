/// <reference types="vite/client" />

import { MetaProvider } from "@solidjs/meta";
import { render } from "solid-js/web";
import App from "./App";
import "./index.css";
import { retireServiceWorker } from "./pwa";

// kolu does not use a service worker. Retire any one a previous build left
// registered (and delete its caches); the self-destructing `public/sw.js`
// covers a worker still controlling the page. All navigator.serviceWorker
// access lives behind pwa.ts (see its header).
retireServiceWorker();

// Install `window.__kolu` debug hook (dev only) — one-line console access to
// the same diagnostic probes DiagnosticInfo renders. See debug/consoleHooks.ts.
if (import.meta.env.DEV) {
  void import("./debug/consoleHooks").then((m) => m.installDebugHooks());
}

render(
  () => (
    <MetaProvider>
      <App />
    </MetaProvider>
  ),
  document.body,
);
