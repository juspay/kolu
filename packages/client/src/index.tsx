/// <reference types="vite/client" />

import { MetaProvider } from "@solidjs/meta";
import { render } from "solid-js/web";
import App from "./App";
import "./index.css";
import { initPwa } from "./pwa";

// Service worker: in dev, unregister any stale production worker — it would
// intercept dev-server requests and serve cached assets indefinitely. In
// production, register it and wire update detection (see pwa.ts).
if (import.meta.env.DEV) {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const r of registrations) r.unregister();
    });
  }
} else {
  initPwa();
}

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
