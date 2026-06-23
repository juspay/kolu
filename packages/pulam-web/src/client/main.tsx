/**
 * Browser entry — mount the app into `#root`.
 *
 * `#root` is baked into `index.html`; a missing root is a build/HTML defect, so
 * we throw loudly rather than no-op into a blank page.
 */

import { render } from "solid-js/web";
import { App } from "./App.tsx";
import "./index.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("pulam-web: #root element missing from index.html");
}

render(() => <App />, root);
