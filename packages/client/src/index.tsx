/// <reference types="vite/client" />
import { render } from "solid-js/web";
import { MetaProvider } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import App from "./App";
import AppRoutes from "./AppRoutes";
import "./index.css";

// Unregister any stale service worker in dev mode — production SW from a previous
// build can intercept dev server requests and serve cached assets indefinitely.
if (import.meta.env.DEV && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const r of registrations) r.unregister();
  });
}

// Install `window.__kolu` debug hook (dev only) — one-line console access to
// the same diagnostic probes DiagnosticInfo renders. See debug/consoleHooks.ts.
if (import.meta.env.DEV) {
  void import("./debug/consoleHooks").then((m) => m.installDebugHooks());
}

render(
  () => (
    <MetaProvider>
      <Router>
        <AppRoutes workspacePage={App} />
      </Router>
    </MetaProvider>
  ),
  document.body,
);
