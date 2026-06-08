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

import { STALE_PROCESS_CLOSE_CODE } from "@kolu/surface-app";
import {
  createServerLifecycle,
  retireSocket,
  type ServerLifecycleEvent,
  surfaceAppProbe,
} from "@kolu/surface-app/solid";
import { createEffect, createMemo, createRoot } from "solid-js";
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
  probe: () => surfaceAppProbe(surfaceApp),
  // Echo each observed identity back as the `pid` handshake param on the next
  // reconnect — that's how the server recognizes a stale tab after a restart and
  // rejects it with `STALE_PROCESS_CLOSE_CODE`. The lifecycle PUBLISHES the id via
  // this hook (the probe stays pure); `wire.ts` stashes it in the mutable its URL
  // thunk reads. Distinct from `serverProcessId()`, which is `undefined` on a
  // stale-close — the echo must keep re-presenting the last *observed* (now dead)
  // id so each reconnect is re-rejected.
  onProcessId: rememberServerProcessId,
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

// Once the server rejects this tab as stale, permanently retire the socket
// (`retireSocket` from `@kolu/surface-app/solid` — stop reconnect + fail sends
// loudly, so neither partysocket's offline buffer nor oRPC's pending peers grow
// unbounded behind the reload overlay; the partysocket/oRPC-internals knowledge
// lives in surface-app, beside the transport contract it manipulates). `wire.ts`
// only owns the `ws` instance being retired (and its process-id URL state).
//
// Fire it off the LIFECYCLE's own stale-restart interpretation, not a second
// decode of `event.code`: the library already turned the
// `STALE_PROCESS_CLOSE_CODE` close into a `restarted` event tagged
// `transport: "closed"` (the stale-restart shape — socket genuinely closed,
// unlike the `transport: "open"` reconnect-restart). We read that one signal and
// fire the retirement side-effect once.
//
// Owned by an explicit `createRoot` (the module-singleton pattern — see
// `createSharedRoot.ts`): a bare top-level `createEffect` is unowned, which Solid
// warns about AND leaves the effect's scheduling to chance. This side-effect is
// correctness-critical (it's what bounds the buffers), so it gets a real owner.
// The root is the page itself — never disposed, which is correct for a
// page-lifetime singleton.
createRoot(() => {
  createEffect(() => {
    const event = lifecycle();
    if (event.kind !== "restarted" || event.transport !== "closed") return;
    retireSocket(ws);
  });
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
