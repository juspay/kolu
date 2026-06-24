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

// Register the fetch-less notification worker the backend serves at `/sw.js`
// (`installFreshStatic({ serviceWorker: "notify" })`) — the kolu twin
// (`packages/client/src/index.tsx`). An installed PWA can only raise OS
// notifications through an active registration
// (`ServiceWorkerRegistration.showNotification()`; the page-level
// `new Notification()` is illegal in `standalone` mode), so this is what makes a
// home-screen pulam able to alert when a fleet agent needs you. The worker has
// NO fetch handler, so it never caches and the freshness contract still holds;
// registering it at `/` also retires (and purges the caches of) any legacy
// caching worker. The register-or-retire policy itself (register, falling back
// to `retireServiceWorker()` so the origin is still left with NO caching worker)
// lives in `registerOrRetireServiceWorker` (`/lifecycle`), shared with the kolu twin.
registerOrRetireServiceWorker();
