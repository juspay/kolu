import { render } from "solid-js/web";
import { MetaProvider } from "@solidjs/meta";
import { QueryClientProvider } from "@tanstack/solid-query";
import { queryClient } from "./queryClient";
import App from "./App";
import "./index.css";

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
