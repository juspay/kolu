/**
 * Server lifecycle: connecting / connected / disconnected / reconnected /
 * restarted, plus the facets (transport status, server process identity) kolu's
 * UI reads. The derivation itself is NOT hand-rolled here — it's
 * `@kolu/surface-app/solid`'s `createServerLifecycle`, the encapsulated form of
 * what this file used to re-derive (the `server.info` probe on every WebSocket
 * open, comparing the returned process UUID against the last-known one to tell a
 * transient drop from a restart). This module is just the kolu-shaped, module-
 * level signal layer above it: it wires the library to kolu's transport
 * (`ws`) and probe (`surface.server.info`, the `serverIdentity` fragment) and
 * re-exports the facets under the names kolu's call sites already use.
 *
 * Transport setup (PartySocket, typed oRPC client) lives in `../wire.ts`.
 */

import {
  createServerLifecycle,
  type ServerLifecycleEvent,
} from "@kolu/surface-app/solid";
import { createMemo } from "solid-js";
import { match } from "ts-pattern";
import { app, ws } from "../wire";

export type WsStatus = "connecting" | "open" | "closed";
export type { ServerLifecycleEvent };

// The library derives the lifecycle from kolu's transport + identity probe.
// The probe is surface-app's `serverIdentity` fragment, surfaced at
// `surface.server.info` (returns `{ processId }`) — composed, not hand-written.
const { lifecycle, serverProcessId, status } = createServerLifecycle({
  ws,
  probe: () => app.rpc.surface.server.info({}),
  // A persistently-broken probe would otherwise silently leave the UI stuck in
  // its prior connection state. Log it (the next open retries) — same as the
  // pre-extraction rpc.ts.
  onProbeError: (err) => console.warn("server.info probe failed:", err),
});

// `status` is the surface-app `ConnectionStatus` projection of the same
// lifecycle — handed to `<SurfaceAppProvider status=...>` so the provider reads
// THIS source instead of attaching a second listener/probe pair (one lifecycle,
// no double `server.info` probe per reconnect, no observer disagreement).
export { lifecycle, serverProcessId, status };

/** Transport status for the header dot. */
const wsStatus = createMemo<WsStatus>(() =>
  match(lifecycle().kind)
    .with("connecting", () => "connecting" as const)
    .with("disconnected", () => "closed" as const)
    .with("connected", "reconnected", "restarted", () => "open" as const)
    .exhaustive(),
);

export { wsStatus };
