/**
 * Server lifecycle: connecting / connected / disconnected / reconnected /
 * restarted, plus the facets (transport status, server process identity) kolu's
 * UI reads. The derivation itself is NOT hand-rolled here — it's
 * `@kolu/surface-app/solid`'s `createServerLifecycle`, the encapsulated form of
 * what this file used to re-derive (the `surfaceApp.info` probe on every WebSocket
 * open, comparing the returned process UUID against the last-known one to tell a
 * transient drop from a restart). This module is just the kolu-shaped, module-
 * level signal layer above it: it wires the library to kolu's transport
 * (`ws`) and probe (`surface.surfaceApp.identity.info`, surface-app's identity
 * surface served as a sibling) and re-exports the facets under the names kolu's
 * call sites already use.
 *
 * Transport setup (PartySocket, typed oRPC client) lives in `../wire.ts`.
 */

import {
  createServerLifecycle,
  type ServerLifecycleEvent,
  surfaceAppProbe,
} from "@kolu/surface-app/solid";
import { STALE_PROCESS_CLOSE_CODE } from "kolu-common/config";
import { createEffect, createMemo } from "solid-js";
import { match } from "ts-pattern";
import { rememberServerProcessId, surfaceApp, ws } from "../wire";

export type WsStatus = "connecting" | "open" | "closed";
export type { ServerLifecycleEvent };

// The library derives the lifecycle from kolu's transport + identity probe.
// The probe is surface-app's identity surface, served as a sibling under the
// `surfaceApp` key — wire path `surface.surfaceApp.identity.info` (returns
// `{ processId }`) — composed, not hand-written.
const { lifecycle, serverProcessId, status } = createServerLifecycle({
  ws,
  // surface-app is served as a sibling under the `surfaceApp` key; its client
  // (`surfaceApp.rpc`) is the SCOPED link `{ surface: link.surface.surfaceApp }`,
  // so the probe namespace `identity` resolves at the wire path
  // `/surface/surfaceApp/identity/info` — the key is consumed by the scope and
  // does NOT reappear in the path. `.rpc` is typed `unknown` (the dynamic
  // combined link can't be expanded per-key — see `SurfaceClient.rpc`), so the
  // probe call shape lives in surface-app's `surfaceAppProbe`, beside the surface
  // that defines the probe — not re-cast here.
  probe: async () => {
    const probed = await surfaceAppProbe(surfaceApp);
    // Remember the live identity so `wire.ts` echoes it as the `pid` handshake
    // param on the next reconnect — that's how the server recognizes a stale tab
    // after a restart and rejects it with `STALE_PROCESS_CLOSE_CODE`.
    rememberServerProcessId(probed.processId);
    return probed;
  },
  // A persistently-broken probe would otherwise silently leave the UI stuck in
  // its prior connection state. Log it (the next open retries) — same as the
  // pre-extraction rpc.ts.
  onProbeError: (err) => console.error("surfaceApp.info probe failed:", err),
  // The server closes a stale tab (one bound to a previous process) with this
  // code at the handshake. Treat it as a definitive restart so the reload
  // overlay takes over, instead of a "reconnecting" spinner that would loop as
  // the client keeps re-presenting the same stale id.
  restartCloseCode: STALE_PROCESS_CLOSE_CODE,
});

// Once the server rejects this tab as stale, STOP partysocket's auto-reconnect:
// every further attempt re-presents the same dead id and is rejected again. The
// reload overlay (driven by the `restarted` status above) is now the only path
// forward — reloading lands a fresh page that connects cleanly to the live
// process. Without this, partysocket spins a benign-but-noisy reconnect loop
// (and a failed identity probe each round) behind the overlay. `ws.close()`
// flips partysocket's `_shouldReconnect` to false, which a fresh page resets.
//
// We must ALSO fail further sends, not just stop reconnecting — and they have to
// fail LOUDLY, not silently. partysocket's `send()` queues into an unbounded
// offline buffer (`maxEnqueuedMessages` is `Infinity`) whenever the socket isn't
// OPEN, and oRPC's websocket link calls it directly. With reconnect disabled
// that buffer never flushes, so the overlay's `pointer-events-none` card — users
// can still type into the terminals underneath — plus any stream retry would
// grow the queue without bound.
//
// A no-op `send` stops the partysocket buffer, but oRPC's `ClientPeer` treats a
// `send()` that returns normally as "request dispatched" and then `await`s a
// response that can never arrive (reconnect is off, so no further `close` event
// fires to settle the peer either). Every post-stale RPC/stream retry would then
// hang forever, accumulating unresolved peer requests and promises — the same
// unbounded-growth failure mode one layer up. So instead `send` THROWS a stable
// stale-tab error: oRPC's `request()` awaits the send, the throw rejects the
// call (its `catch` closes that request id), and callers see a real rejection
// through their existing error paths instead of believing a dropped message was
// accepted. (Requests already in flight at the stale close are settled by
// oRPC's own `close` listener, which fired with this very event.) Normal
// transient-drop buffering is untouched — only the terminal stale state replaces
// `send`, and a fresh page restores a pristine socket.
//
// Retire the socket off the LIFECYCLE's own stale-restart interpretation, not a
// second decode of `event.code`: the library already turned the
// `STALE_PROCESS_CLOSE_CODE` close into a `restarted` event tagged
// `transport: "closed"` (the stale-restart shape — socket genuinely closed,
// unlike the `transport: "open"` reconnect-restart). We read that one signal and
// fire the retirement side-effect once.
createEffect(() => {
  const event = lifecycle();
  if (event.kind !== "restarted" || event.transport !== "closed") return;
  ws.close();
  ws.send = () => {
    throw new Error("kolu: server restarted — reload required (stale tab)");
  };
});

// `status` is the surface-app `ConnectionStatus` projection of the same
// lifecycle — handed to `<SurfaceAppProvider status=...>` so the provider reads
// THIS source instead of attaching a second listener/probe pair (one lifecycle,
// no double `surfaceApp.info` probe per reconnect, no observer disagreement).
export { lifecycle, serverProcessId, status };

/** Transport status for the header dot — read from the lifecycle ALONE. A
 *  `restarted` event carries its own `transport`: a reconnect-restart (socket
 *  open against a fresh process — `"open"`) reads green; a stale-restart (the
 *  server closed this tab at the handshake — `"closed"`) reads red. The split is
 *  the library's, so kolu never re-inspects the socket to recover it. */
const wsStatus = createMemo<WsStatus>(() =>
  match(lifecycle())
    .with({ kind: "connecting" }, () => "connecting" as const)
    .with({ kind: "disconnected" }, () => "closed" as const)
    .with({ kind: "restarted", transport: "closed" }, () => "closed" as const)
    .with({ kind: "restarted" }, () => "open" as const)
    .with({ kind: "connected" }, { kind: "reconnected" }, () => "open" as const)
    .exhaustive(),
);

export { wsStatus };
