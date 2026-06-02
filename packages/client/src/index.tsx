/// <reference types="vite/client" />

import { MetaProvider } from "@solidjs/meta";
import { render } from "solid-js/web";
import App from "./App";
import "./index.css";
import { initPwa, unregisterStaleServiceWorkers } from "./pwa";

// Service worker: in dev, unregister any stale production worker; in production,
// register it and wire update detection. All navigator.serviceWorker access
// lives behind pwa.ts (see its header).
if (import.meta.env.DEV) unregisterStaleServiceWorkers();
else initPwa();

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
