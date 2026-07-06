/** Server NAME + theme-color — singleton. One cosmetic `client.server.info()`
 *  fetch providing the server's name (the document title and the About dialog's
 *  title) and the PWA `<Meta theme-color>`. This is NOT
 *  the whole "server identity" — the About/Diagnostic "Server:" line reads
 *  `serverProcessId` from `rpc/rpc` (a live restart probe, different volatility
 *  than this one-shot cosmetic fetch). Migrated out of App.tsx (the one stray
 *  fetch the shell still owned) so the layout shell stops carrying a non-layout
 *  fetch and drilling `appTitle` through every consumer. */

import type { PwaIdentity } from "kolu-common/contract";
import { createSignal } from "solid-js";
import { seedDefaultHost } from "./binding/bindings";
import { createSharedRoot } from "./createSharedRoot";
import { client } from "./wire";

export const useServerIdentity = createSharedRoot(() => {
  const [identity, setIdentity] = createSignal<PwaIdentity>();
  void client.server
    .info()
    .then((info) => {
      setIdentity(info.identity);
      // W4: on a FRESH tab (no stored host), fall to the server's default host
      // (`KOLU_PADI_HOST` ?? local) so a CI run booted through it lands there while
      // the picker still switches freely. Never overrides a per-tab pick.
      seedDefaultHost(info.defaultHost);
    })
    .catch((err) => {
      // Server info is cosmetic — safe to ignore on failure.
      console.warn("Server info fetch failed:", err);
    });

  // Expose only the named projections, not the raw `identity()` signal: a
  // consumer reaching past these to read `identity()?.name` would re-scatter the
  // "kolu" default `appTitle` centralizes and couple itself to the
  // `PwaIdentity` shape. A future field gets its own projection here.
  return {
    /** Document/window title — the server's name, or the "kolu" default. */
    appTitle: () => identity()?.name ?? "kolu",
    /** PWA chrome theme-color, or undefined before the fetch resolves. */
    themeColor: () => identity()?.themeColor,
  } as const;
});
