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
import { createSharedRoot } from "./createSharedRoot";
import { hostTitle } from "./host/hostTitle";
import { activeHost, client } from "./wire";

export const useServerIdentity = createSharedRoot(() => {
  const [identity, setIdentity] = createSignal<PwaIdentity>();
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
  // `PwaIdentity` shape. A future field gets its own projection here.
  return {
    /** Document/window title — tab IDENTIFICATION: which host this tab views
     *  (`hostTitle` over the reactive `activeHost` signal), so the tab re-titles the
     *  instant you switch hosts on the ChromeBar strip. The server identity no longer
     *  drives the title (it names kolu-server's OWN host, not the viewed one, and under
     *  always-map would fold the KOLU_PADI_HOST seed-list); this module keeps the
     *  `server.info` fetch for branding fields below. */
    appTitle: () => hostTitle(activeHost()),
    /** Machine hostname kolu-server runs on (`os.hostname()`), same seed as
     *  PWA name / theme. Used as the local host tab's label (Home + hostname).
     *  Undefined until `server.info` resolves. */
    hostname: () => identity()?.hostname,
    /** PWA chrome theme-color, or undefined before the fetch resolves. */
    themeColor: () => identity()?.themeColor,
  } as const;
});
