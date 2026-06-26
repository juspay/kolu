/**
 * `createLiveSignal` — derive a transport-liveness `LiveSignal` for a reconnecting
 * websocket AND wire the half-open watchdog that makes it honest, in ONE call.
 *
 * This is the single minter of a {@link LiveSignal} (`@kolu/surface`'s
 * brand). `surfaceClient`/`surfaceClients` refuse a bare `{ live }` over a
 * half-openable websocket link — only a `LiveSignal` is accepted — and the ONLY
 * way to mint one is here, AFTER this function has wired the heartbeat. So a
 * consumer cannot obtain a brand without a watchdog: the half-open-blind signal
 * (`() => true`, or an open/close-only `() => socketStatus() === "live"`) is no
 * longer SPELLABLE over a websocket, not merely discouraged (#1564, one seam up
 * from the dot).
 *
 * `connectSurface` / `connectSurfaces` wrap this (turnkey socket + client +
 * watchdog). A consumer that hand-builds `surfaceClient + websocketLink` (a
 * minimal example, or kolu's own combined-link `wire.ts`) calls it directly to
 * mint the `{ live }` its client needs — getting the same watchdog the turnkey
 * seams do, instead of a hand-rolled open/close signal with no heartbeat.
 */

import type { LiveSignal } from "@kolu/surface/solid";
import { brandLiveSignal } from "@kolu/surface/solid";
import type { Accessor } from "solid-js";
import {
  createHeartbeat,
  type HeartbeatConfig,
  type HeartbeatSocket,
  normalizeHeartbeat,
} from "../connect";
import {
  createSocketStatus,
  type SurfaceConnectionStatus,
} from "./socketStatus";

/** The reconnecting socket a `LiveSignal` watches — the open/close events
 *  `createSocketStatus` reads PLUS the `readyState`/`OPEN`/`reconnect` verbs the
 *  half-open watchdog drives. Every real partysocket satisfies it. */
export type WatchableSocket = HeartbeatSocket & {
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(
    type: "close",
    listener: (event?: { code?: number }) => void,
  ): void;
};

export interface CreateLiveSignalOptions {
  /** The liveness round-trip the watchdog probes on an interval — the
   *  framework-reserved `system.live` (`() => probeSurfaceLive(link)`), exactly as
   *  the turnkey seams pass. A TIMEOUT (no answer) means the socket is half-open
   *  and is force-reconnected; a rejection still counts as alive (the round-trip
   *  completed). */
  probe: () => Promise<unknown>;
  /** Disable or tune the default-on watchdog. `false` ONLY when another layer
   *  already owns this socket's liveness (e.g. a `<SurfaceAppProvider>`'s
   *  `createServerLifecycle` over the SAME ws) — the brand is still minted (that
   *  external watchdog backs it), the seam just doesn't add a second probe. */
  heartbeat?: HeartbeatConfig;
  /** Forwarded to `createSocketStatus`: a stale-close on a self-retiring socket
   *  reads `down` (terminally, reload to recover) instead of `reconnecting`. */
  retireOnStaleClose?: boolean;
  /** The stale-close code `retireOnStaleClose` matches. */
  restartCloseCode?: number;
}

/** The branded live signal plus the handles a connect seam threads on. */
export interface LiveSignalHandle {
  /** The watchdog-backed, BRANDED transport-liveness accessor — pass straight to
   *  `surfaceClient`/`surfaceClients`'s `{ live }`. `true` only while the socket is
   *  `live`; a `down`/`reconnecting` transport (including after the watchdog forces
   *  a reconnect on a half-open socket) flips it `false`. */
  live: LiveSignal;
  /** The richer transport status (`connecting`/`live`/`reconnecting`/`down`) the
   *  brand is derived from — render it for a per-connection indicator so the
   *  watchdog's recovery is VISIBLE, not silent. */
  status: Accessor<SurfaceConnectionStatus>;
  /** Stop the watchdog (and any in-flight probe timeout). Wire to the consumer's
   *  teardown; a page-lifetime socket needn't call it. */
  dispose: () => void;
}

export function createLiveSignal(
  ws: WatchableSocket,
  opts: CreateLiveSignalOptions,
): LiveSignalHandle {
  // Derive the reactive transport `status` from the socket's own open/close. This
  // alone is half-open-BLIND (a silently dead socket fires neither event), which
  // is exactly why a bare `() => status() === "live"` must NOT be a `LiveSignal` —
  // it only becomes honest paired with the watchdog wired below.
  const status = createSocketStatus(ws, {
    retireOnStaleClose: opts.retireOnStaleClose,
    restartCloseCode: opts.restartCloseCode,
  });
  // The half-open watchdog: probe `system.live` on an interval, force
  // `ws.reconnect()` on a TIMEOUT (which flips `status` off `"live"`). Default-on;
  // `heartbeat: false` opts out only when an external layer owns the probe.
  const heartbeatOptions = normalizeHeartbeat(opts.heartbeat, {
    ws,
    probe: opts.probe,
  });
  const heartbeat = heartbeatOptions && createHeartbeat(heartbeatOptions);
  // Mint the brand ONLY now — after the watchdog above is wired. The brand is the
  // promise "a watchdog backs this signal"; minting it here, in the one place that
  // also wires the watchdog, is what makes the half-open-blind lie unspellable.
  const live = brandLiveSignal(() => status() === "live");
  return { live, status, dispose: () => heartbeat?.dispose() };
}
