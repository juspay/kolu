/**
 * Surface client bundle. One websocket link carries BOTH sibling surfaces;
 * `surfaceClients` splits it into a per-key client bundle. `clients.surfaceApp`
 * is the control-plane client (buildInfo + the `identity.info` probe);
 * `clients.demo` carries the live `serverStats` cell. `link.wire` is the
 * watchable transport — surface-app derives the connection lifecycle from it
 * plus the `identity.info` probe (passed to <SurfaceAppProvider> in App.tsx).
 *
 * Two steps, in this order. `websocketLink` DIALS over the COMBINED group (both
 * siblings' members live in one flat tag namespace, `surface/<key>/<member>/<verb>`),
 * and is handed surface-app's own close-code vocabulary as `isTerminalClose` —
 * the one place a close CODE is known. Then `createLiveSignal` takes the WHOLE
 * `{ dispatch, wire }` the link minted together and adds the half-open watchdog,
 * probing the reserved `system/live` member on the `surfaceApp` sibling's slice
 * of that very dispatch. Pass the WHOLE handle to `surfaceClients`: one link,
 * one watchdog, per-key clients. This seam OWNS the watchdog, so `App.tsx`
 * passes `heartbeat={false}` to `<SurfaceAppProvider>` (its lifecycle observes
 * the same wire but doesn't double-watch it).
 */

import { websocketLink } from "@kolu/surface/links/websocket";
import { createLiveSignal, surfaceClients } from "@kolu/surface/solid";
import { isStaleProcessClose } from "@kolu/surface-app/connect";
import { composed, surfaces } from "../common/surface";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;

export const link = await websocketLink({
  group: composed.group,
  url: () => wsUrl,
  // The server retires a tab bound to a previous process with
  // `STALE_PROCESS_CLOSE_CODE`; on that verdict the link STOPS retrying and
  // fails every in-flight and future call with `SurfaceTransportRetired`, so a
  // dead tab settles instead of re-presenting a stale pid forever.
  isTerminalClose: isStaleProcessClose,
});

const transport = createLiveSignal(link, { siblingKey: "surfaceApp" });

export const clients = surfaceClients(transport, surfaces);
