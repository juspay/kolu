/**
 * Swapping a link without touching call sites — the two blocks the
 * "How to choose a link" page embeds. The client type is identical across
 * links, so moving from the in-process `directLink` to a watchdog-backed
 * WebSocket connection is a one-line change at the wiring seam.
 */

import { directLink } from "@kolu/surface/links/direct";
import { surfaceClient } from "@kolu/surface/solid";
import { connectSurface } from "@kolu/surface-app/solid";
import { fragment } from "./serve";
import { surface } from "./surface";

const url = "wss://example.test/rpc/ws";

function inProcess() {
  // #region direct
  // Was: in-process
  const app = surfaceClient(
    surface,
    directLink<typeof surface.contract>(fragment.router),
  );
  // #endregion direct
  return app;
}

function overSocket() {
  // #region swap
  // Now: over a WebSocket, via the app layer's watchdog-backed connect
  const { client } = connectSurface({ surface, url });
  const app = client; // same bound hooks, same call sites
  // #endregion swap
  return app;
}

export { inProcess, overSocket };
