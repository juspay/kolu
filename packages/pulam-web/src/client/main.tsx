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

// Register the fetch-less `/sw.js` the backend serves, or retire on failure —
// the shared boot policy (`registerOrRetireServiceWorker`, the kolu twin in
// `packages/client/src/index.tsx`); the policy + freshness rationale live in that
// function's docstring. This buys only the *infrastructure* an OS notification
// needs (an installed PWA can raise one only through an active registration's
// `ServiceWorkerRegistration.showNotification()`). pulam-web does NOT yet wire the
// alert path — no permission request or needs-you → `showNotification()` trigger,
// unlike kolu's `useActivityAlerts.ts` — so today this is installability + freshness
// only; the alert path is a follow-up.
void registerOrRetireServiceWorker();
