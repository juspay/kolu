/// <reference types="vite/client" />
import { render } from "solid-js/web";
import { MetaProvider } from "@solidjs/meta";
import { QueryClientProvider } from "@tanstack/solid-query";
import { queryClient } from "./queryClient";
import App from "./App";
import "./index.css";

// Unregister any stale service worker in dev mode — production SW from a previous
// build can intercept dev server requests and serve cached assets indefinitely.
if (import.meta.env.DEV && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const r of registrations) r.unregister();
  });
}

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <MetaProvider>
        <App />
      </MetaProvider>
    </QueryClientProvider>
  ),
  document.body,
);
