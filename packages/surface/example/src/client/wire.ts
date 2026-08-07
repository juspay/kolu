/**
 * One-time setup: build the surface client bundle. `surfaceClient` walks
 * the surface once and exposes:
 *
 *   - `app.cells / .collections / .streams / .events` — bound `.use()`
 *     hooks with `source` / `mutate` / `valueSource` / `keyToInput`
 *     pre-filled.
 *   - `app.procedures` — declared imperative procedures, bound and typed
 *     from the spec (`app.procedures.notes.create({...})`), no cast.
 *   - `app.rpc` — the structural member face, for the framework-reserved
 *     `system.*` members and any verb the bound hooks / `procedures` can't
 *     cover.
 *
 * Two steps, in this order and no other:
 *
 *   1. `websocketLink` DIALS. It owns the socket, the reconnect schedule, and
 *      the URL thunk (re-evaluated on every re-dial). It is async because
 *      building the protocol and its fibers is an effect.
 *   2. `createLiveSignal` takes the WHOLE `{ dispatch, wire }` the link minted
 *      together and adds the half-open watchdog — a websocket CAN sit `open`
 *      with no bytes flowing, so `surfaceClient` REFUSES a bare wire dispatch
 *      and demands this watchdog-backed handle. Passing the whole handle is
 *      what makes "the watchdog probes the transport it reconnects" true by
 *      construction.
 *
 * Both live in `@kolu/surface`, so this minimal example needs no
 * `@kolu/surface-app` dependency on the client side.
 */

import { websocketLink } from "@kolu/surface/links/websocket";
import { createLiveSignal, surfaceClient } from "@kolu/surface/solid";
import { surface } from "../common/surface";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;

export const link = await websocketLink({
  group: surface.group,
  // Re-evaluated on EVERY (re)dial. This example's URL is fixed; an app that
  // echoes a server pid (so a stale tab is recognised) varies it here.
  url: () => wsUrl,
  // Which close codes RETIRE the wire (stop retrying, fail every call with
  // `SurfaceTransportRetired`)? This example's server never retires a tab, so
  // every close is an ordinary drop the link re-dials through. An app that
  // retires stale tabs passes `isStaleProcessClose` from `@kolu/surface-app`.
  isTerminalClose: () => false,
});

const transport = createLiveSignal(link, {});

export const app = surfaceClient(surface, transport);
