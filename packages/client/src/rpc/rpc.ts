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
import { createMemo } from "solid-js";
import { match } from "ts-pattern";
import { surfaceApp, ws } from "../wire";

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
  // A persistently-broken probe would otherwise silently leave the UI stuck in
  // its prior connection state. Log it (the next open retries) — same as the
  // pre-extraction rpc.ts.
  onProbeError: (err) => console.error("surfaceApp.info probe failed:", err),
});

// `status` is the surface-app `ConnectionStatus` projection of the same
// lifecycle — handed to `<SurfaceAppProvider status=...>` so the provider reads
// THIS source instead of attaching a second listener/probe pair (one lifecycle,
// no double `surfaceApp.info` probe per reconnect, no observer disagreement).
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
