/** Server identity — singleton. One cosmetic `client.server.info()` fetch
 *  feeding the document title, the canvas watermark, the About dialog, and the
 *  PWA `<Meta theme-color>`. Migrated out of App.tsx (the one stray fetch the
 *  shell still owned) so the layout shell stops carrying a non-layout fetch and
 *  drilling `appTitle` through every consumer. */

import type { ServerIdentity } from "kolu-common/contract";
import { createSignal } from "solid-js";
import { createSharedRoot } from "./createSharedRoot";
import { client } from "./wire";

export const useServerIdentity = createSharedRoot(() => {
  const [identity, setIdentity] = createSignal<ServerIdentity>();
  void client.server
    .info()
    .then((info) => setIdentity(info.identity))
    .catch((err) => {
      // Server info is cosmetic — safe to ignore on failure.
      console.warn("Server info fetch failed:", err);
    });

  // Expose only the named projections, not the raw `identity()` signal: a
  // consumer reaching past these to read `identity()?.name` would re-scatter the
  // "kolu" default `appTitle` centralizes and couple itself to the
  // `ServerIdentity` shape. A future field gets its own projection here.
  return {
    /** Document/window title — the server's name, or the "kolu" default. */
    appTitle: () => identity()?.name ?? "kolu",
    /** PWA chrome theme-color, or undefined before the fetch resolves. */
    themeColor: () => identity()?.themeColor,
  } as const;
});
