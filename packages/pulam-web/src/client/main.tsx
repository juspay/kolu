/**
 * Browser entry — mount the app into `#root`.
 *
 * `#root` is baked into `index.html`; a missing root is a build/HTML defect, so
 * we throw loudly rather than no-op into a blank page.
 */

import { registerOrRetireServiceWorker } from "@kolu/surface-app/lifecycle";
import { render } from "solid-js/web";
import { App } from "./App.tsx";
import "./index.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("pulam-web: #root element missing from index.html");
}

render(() => <App />, root);

// Register the fetch-less worker the backend serves at `/sw.js`
// (`installFreshStatic({ serviceWorker: "notify" })`) — the kolu twin
// (`packages/client/src/index.tsx`). The worker has NO fetch handler, so it never
// caches and the freshness contract still holds; registering it at `/` also
// retires (and purges the caches of) any legacy caching worker. The
// register-or-retire policy itself (register, falling back to
// `retireServiceWorker()` so the origin is still left with NO caching worker)
// lives in `registerOrRetireServiceWorker` (`/lifecycle`), shared with the kolu twin.
//
// This is the *infrastructure* an OS notification needs (an installed PWA can
// only raise one through an active registration's
// `ServiceWorkerRegistration.showNotification()`; the page-level
// `new Notification()` is illegal in `standalone` mode). pulam-web does NOT yet
// wire the alert path itself — there is no permission request or needs-you →
// showNotification() trigger here, unlike kolu's `useActivityAlerts.ts`. Today
// this buys installability + freshness; the alert path is a follow-up.
void registerOrRetireServiceWorker();
