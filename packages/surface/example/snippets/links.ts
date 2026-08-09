/**
 * Swapping a link without touching call sites — the two blocks the
 * "How to choose a link" page embeds. The client type is identical across
 * links, so moving from the in-process `directDispatch` to a watchdog-backed
 * WebSocket connection is a one-line change at the wiring seam.
 */

import { directDispatch } from "@kolu/surface/links/direct";
import { surfaceClient } from "@kolu/surface/solid";
import { connectSurface } from "@kolu/surface-app/solid";
import { reloadForUpdate } from "@kolu/surface-app/lifecycle";
import { runtime } from "./serve";
import { surface } from "./surface";

const url = "wss://example.test/rpc/ws";

function inProcess() {
  // #region direct
  // Was: in-process. `directDispatch` takes the served surface itself and calls
  // its handlers directly — zero serialization, and the only dispatch
  // `surfaceClient` accepts bare (no transport ⇒ it cannot half-open).
  const app = surfaceClient(surface, directDispatch(runtime));
  // #endregion direct
  return app;
}

async function overSocket() {
  // #region swap
  // Now: over a WebSocket, via the app layer's watchdog-backed connect. ASYNC —
  // the dial is an effect — and the bound hooks below it are unchanged.
  const { client } = await connectSurface({
    surface,
    url,
    retired: reloadForUpdate,
  });
  const app = client; // same bound hooks, same call sites
  // #endregion swap
  return app;
}

export { inProcess, overSocket };
