import { render } from "solid-js/web";
import { MetaProvider } from "@solidjs/meta";
import App from "./App";
import "./index.css";

render(
  () => (
    <MetaProvider>
      <App />
    </MetaProvider>
  ),
  document.body,
);
