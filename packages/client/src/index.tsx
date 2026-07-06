/// <reference types="vite/client" />

import {
  registerOrRetireServiceWorker,
  shellCommit,
} from "@kolu/surface-app/lifecycle";
import { SurfaceAppProvider } from "@kolu/surface-app/solid";
import { MetaProvider } from "@solidjs/meta";
import { koluBuildInfo } from "kolu-common/surface";
import { render } from "solid-js/web";
import { toast } from "solid-sonner";
import App from "./App";
import { activeBinding } from "./binding/bindings";
import { status } from "./rpc/rpc";
import "./index.css";

// Register the fetch-less notification worker (served at `/sw.js` by surface-app's
// `installFreshStatic({ serviceWorker: "notify" })`). kolu needs an active
// registration so background agent-finished alerts can fire via
// `ServiceWorkerRegistration.showNotification()` — the only notification path
// that works in an installed PWA (the page-level `new Notification()` constructor
// is illegal in `standalone` display mode). The worker has NO fetch handler, so
// it never caches and the freshness contract still holds; registering it at `/`
// also replaces (and so retires) any legacy caching worker, which it purges on
// activate. If registration fails (e.g. dev, where `/sw.js` isn't served) we
// fall back to `retireServiceWorker()` so the origin is still left with NO
// caching worker — never just "no OS banner" while a legacy stale-serving worker
// lingers. Either way the in-app dock + sound still fire. The register-or-retire
// policy itself lives in `registerOrRetireServiceWorker` (`/lifecycle`), shared
// with pulam-web. Run before any component — the framework-free `/lifecycle` subpath.
void registerOrRetireServiceWorker();

// Install `window.__kolu` debug hook (dev only) — one-line console access to
// the same diagnostic probes DiagnosticInfo renders. See debug/consoleHooks.ts.
if (import.meta.env.DEV) {
  void import("./debug/consoleHooks").then((m) => m.installDebugHooks());
}

render(
  () => (
    // surface-app's headless app-shell model: the connection status (the SINGLE
    // module-level lifecycle from rpc.ts — the provider reads it rather than
    // re-deriving its own, so there's one `surfaceApp.info` probe per reconnect and
    // every UI path agrees), build-skew staleness (driven by `koluBuildInfo`'s
    // extended cell), and the reload affordance. kolu reads it via
    // `useSurfaceApp()` and renders its own tailwind chrome (IdentityRail,
    // StaleBadge, TransportOverlay, the mobile sheet).
    <SurfaceAppProvider
      // The ACTIVE binding's surface-app client, as an accessor — a live host
      // switch yields a NEW client, so the provider tears down the old host's
      // build-identity stream and re-subscribes (the framework guarantee). The
      // build identity itself is kolu-server's, unchanged across hosts; the swap
      // just keeps the subscription honest and leak-free. (The proxy `surfaceApp`
      // in wire.ts is stable-identity, so it would never trip the swap — the
      // provider needs the real per-binding client here.)
      controlPlane={() => activeBinding().clients.surfaceApp}
      clientCommit={shellCommit()}
      buildInfo={koluBuildInfo}
      status={status}
      onError={(err) => toast.error(`Build identity error: ${err.message}`)}
    >
      <MetaProvider>
        <App />
      </MetaProvider>
    </SurfaceAppProvider>
  ),
  document.body,
);
