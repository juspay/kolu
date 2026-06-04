import { retireServiceWorker } from "@kolu/surface-app/lifecycle";
import { render } from "solid-js/web";
import App from "./App";
import "./styles.css";

// surface-app ships no service worker. Retire any one a previous build left
// registered (and delete its caches) — the root-setup half of the freshness
// contract, paired with the server's self-destructing `/sw.js`. Run before the
// app renders, from the framework-free `/lifecycle` subpath.
retireServiceWorker();

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");
render(() => <App />, root);
