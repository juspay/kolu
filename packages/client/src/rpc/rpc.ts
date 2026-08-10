/**
 * Server lifecycle: connecting / connected / disconnected / reconnected /
 * restarted, plus the facets (transport status, server process identity) kolu's
 * UI reads. The derivation itself is NOT hand-rolled here — it's
 * `@kolu/surface-app/solid`'s `createServerLifecycle`, the encapsulated form of
 * what this file used to re-derive (an identity probe on every wire open,
 * comparing the returned process UUID against the last-known one to tell a
 * transient drop from a restart). This module is just the kolu-shaped, module-
 * level signal layer above it: it wires the library to kolu's transport (`wire`)
 * and to the framework-reserved `surface/surfaceApp/system/identity` probe, and
 * re-exports the facets under the names kolu's call sites already use.
 *
 * Transport setup (the reconnecting websocket link + the surface clients) lives
 * in `../wire.ts`.
 */

import { probeSurfaceIdentity } from "@kolu/surface/identity";
import {
  createServerLifecycle,
  type ServerLifecycleEvent,
} from "@kolu/surface-app/solid";
import { createMemo } from "solid-js";
import { match } from "ts-pattern";
import { surfaceApp, wire } from "../wire";

export type WsStatus = "connecting" | "open" | "closed";
export type { ServerLifecycleEvent };

// The library derives the lifecycle from kolu's transport + identity probe.
// The probe is the FRAMEWORK-RESERVED `system/identity` member — no app-declared
// member at all. surface-app used to ship an `identity.info` beside its buildInfo
// cell; it duplicated this one, and kolu had to pin the two to a single id by
// injecting `serverProcessId` into the server deps. The reserved member carries
// `processId` now, so there is one member, one id, and nothing to keep in step.
const { lifecycle, serverProcessId, status } = createServerLifecycle({
  wire,
  // Any sibling answers the reserved member (they all report this process's
  // `surfaceProcessId()`); the `surfaceApp` client's FACE is tag-scoped, so this
  // resolves at the wire tag `surface/surfaceApp/system/identity` — the key is
  // consumed by the scope and does NOT reappear after it.
  probe: () => probeSurfaceIdentity(surfaceApp.rpc),
  // The half-open watchdog is NOT wired here — it lives in `wire.ts`'s
  // `createLiveSignal` over this same wire, beside the transport it guards (and
  // the branded `LiveSignal` it mints for the clients). So this lifecycle opts the
  // watchdog OUT (`heartbeat: false`) to avoid a SECOND `system/live` probe on the
  // one wire; the wire-side watchdog calls `forceReconnect()` on a half-open
  // socket, which this lifecycle observes as a close/open like any other.
  heartbeat: false,
  // The `pid` echo is NOT fed from here any more. It used to be — this lifecycle
  // published each observed id and `wire.ts` stashed it — which meant the server's
  // stale-tab gate only worked because kolu remembered to wire an optional hook.
  // `createSurfaceSocket` runs that probe itself now, over the wire it dialled, so
  // the handshake holds with no app step. This lifecycle only OBSERVES.
  //
  // A persistently-broken probe would otherwise silently leave the UI stuck in
  // its prior connection state. Log it (the next open retries) — same as the
  // pre-extraction rpc.ts.
  onProbeError: (err) => console.error("system/identity probe failed:", err),
});

// The stale-tab retirement is no longer wired from here. The server still closes
// a stale tab (one bound to a previous process) with `STALE_PROCESS_CLOSE_CODE`
// at the handshake, but that code is now the LINK's business: surface-app hands
// `websocketLink` its `isTerminalClose` classifier, the link stops its retry
// schedule and fails every in-flight and future call with
// `SurfaceTransportRetired`, and it reports the terminal `WireStatus` `"retired"`
// — which `createServerLifecycle` reads as a definitive `restarted` so the reload
// overlay takes over. So both `restartCloseCode` (a second decode of the same
// code) and `onStaleRestart` (an action with nothing left to do — there is no
// socket to poison) are gone rather than renamed.

// The half-open liveness watchdog (a SILENTLY half-open socket — TCP dead with no
// FIN/RST after a laptop sleep / Wi-Fi roam / NAT idle-eviction — would otherwise
// sit `OPEN` forever, every stream hung, the UI frozen until a manual reload)
// lives in `wire.ts`'s `createLiveSignal`, which owns this wire's
// transport-liveness leg: it probes `system/live` and calls `forceReconnect()` on
// a missed probe, then mints the BRANDED `LiveSignal` the clients require. So the
// lifecycle above takes `heartbeat: false` — one watchdog on the wire, beside the
// transport, not a second one in this UI layer.

// `status` is the surface-app `ConnectionStatus` projection of the same
// lifecycle — handed to `<SurfaceAppProvider status=...>` so the provider reads
// THIS source instead of attaching a second listener/probe pair (one lifecycle,
// no double `surfaceApp.info` probe per reconnect, no observer disagreement). The
// provider derives the grace-windowed overlay predicate (`presentingDown`) from
// THIS `status` itself, so a sub-second forced reconnect (the wire-side half-open
// watchdog recovering) doesn't flash the full-screen overlay — nothing to thread
// from here; `status` stays instantaneous for the header dot.
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
