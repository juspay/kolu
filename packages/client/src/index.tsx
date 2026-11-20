/// <reference types="vite/client" />

import {
  registerOrRetireServiceWorker,
  shellCommit,
} from "@kolu/surface-app/lifecycle";
import { SurfaceAppProvider } from "@kolu/surface-app/solid";
import { MetaProvider } from "@solidjs/meta";
import { koluBuildInfo } from "kolu-common/surface";
import { Show } from "solid-js";
import { render } from "solid-js/web";
import { toast } from "solid-sonner";
import App from "./App";
import ReaderWindow from "./conductor/reader/ReaderWindow";
import { parseReaderHash } from "./conductor/reader/useReader";
import { status } from "./rpc/rpc";
import { Fault } from "./ui/Fault";
import { surfaceApp } from "./wire";
import "./index.css";

void registerOrRetireServiceWorker();

if (import.meta.env.DEV) {
  void import("./debug/consoleHooks").then((m) => m.installDebugHooks());
}

render(
  () => (
    <SurfaceAppProvider
      controlPlane={surfaceApp}
      clientCommit={shellCommit()}
      buildInfo={koluBuildInfo}
      status={status}
      onError={(err) => toast.error(`Build identity error: ${err.message}`)}
      fault={(text) => <Fault text={text} />}
    >
      <MetaProvider>
        <Show when={parseReaderHash(location.hash) !== null} fallback={<App />}>
          <ReaderWindow />
        </Show>
      </MetaProvider>
    </SurfaceAppProvider>
  ),
  document.body,
);
