/**
 * `connectSurface` — the turnkey client seam for a SINGLE surface over one
 * reconnecting socket, with the liveness watchdog wired in BY DEFAULT.
 *
 * This is the no-lifecycle counterpart to `createServerLifecycle`: an app with
 * no shared connection-status UI driven off the socket — pulam-web's per-host
 * fleet sockets, drishti's per-host sockets — builds its reactive client AND its
 * half-open watchdog in one call, instead of hand-rolling `createSurfaceSocket`
 * → `websocketLink` → `surfaceClient` and (the step every such app FORGOT) a
 * `createHeartbeat`. The heartbeat is default-on and probes the framework-
 * reserved `system.live` round-trip (`@kolu/surface/liveness`), so it needs no
 * app-supplied probe — there is no probe left for an app to forget.
 *
 * An app that DOES drive shared connection-status UI off the socket (kolu's
 * header dot) derives a `createServerLifecycle` instead — which folds the SAME
 * watchdog in — and builds its own (possibly multi-sibling) clients over the
 * combined link. So an app that reaches for either of the two seams gets the
 * liveness watchdog BY DEFAULT — there is no probe to forget. (A consumer that
 * hand-builds `surfaceClient + websocketLink` directly, like a minimal example,
 * still mints its own `{ live }` — but through `createLiveSignal`, which wires the
 * SAME watchdog; the brand can't be obtained any other way. The seams exist so it
 * doesn't have to wire the socket + client + watchdog by hand.)
 */

import type {
  Surface,
  SurfaceContractFor,
  SurfaceSpec,
} from "@kolu/surface/define";
import {
  createLiveSignal,
  type HeartbeatTuning,
  type SurfaceConnectionStatus,
  type SurfaceClient,
  surfaceClient,
} from "@kolu/surface/solid";
import type { WebSocket as PartySocket } from "partysocket";
import type { Accessor } from "solid-js";
import { STALE_PROCESS_CLOSE_CODE } from "../index";
import {
  createSurfaceSocket,
  type ProcessIdEcho,
  type SurfaceSocketOptions,
} from "../connect";

export interface ConnectSurfaceOptions<S extends SurfaceSpec>
  extends SurfaceSocketOptions {
  /** The surface to build a reactive client for. */
  surface: Surface<S>;
  /** TUNE the always-on liveness heartbeat (`intervalMs`/`timeoutMs`/`onStale`).
   *  There is deliberately NO disable option: the seam mints the watchdog-backed
   *  brand `surfaceClient` requires, and a disabled watchdog would mint a
   *  branded-but-blind signal — the override knob the design philosophy forbids.
   *  A socket whose liveness another layer owns simply doesn't use this seam (it
   *  passes that layer's `LiveSignal` to `surfaceClient` directly). */
  heartbeat?: HeartbeatTuning;
}

/** A live single-surface connection: the socket, its `pid` echo, the reactive
 *  client, a reactive transport `status` (for a per-connection indicator), and a
 *  `dispose` that stops the liveness heartbeat. */
export interface SurfaceConnection<S extends SurfaceSpec> {
  ws: PartySocket;
  echo: ProcessIdEcho;
  /** The reactive surface client. `.cells` / `.collections` / `.streams` are
   *  fully typed off `S`; `.rpc` (the raw link, for imperative procedures) is
   *  `unknown` — the same deliberate choice kolu's own combined client makes,
   *  because the fully-expanded oRPC link type is too complex to represent
   *  generically (TS2590). A consumer that calls procedures on it casts `.rpc`
   *  to its CONCRETE contract once at the wire boundary:
   *  `client.rpc as ContractRouterClient<typeof mySurface.contract>` — sound,
   *  since the runtime `.rpc` IS that link. */
  client: SurfaceClient<S>;
  /** Reactive transport status — `connecting` / `live` / `reconnecting` / `down`
   *  — derived from the socket's own open/close (no identity probe). Render it so
   *  the watchdog's recovery is VISIBLE rather than silent. */
  status: Accessor<SurfaceConnectionStatus>;
  /** Stop the liveness heartbeat. A per-app-lifetime socket (cached for the
   *  page's life, like pulam-web's per-host clients) needn't call this. */
  dispose: () => void;
}

export function connectSurface<const S extends SurfaceSpec>(
  opts: ConnectSurfaceOptions<S>,
): SurfaceConnection<S> {
  const { surface, heartbeat: hb, ...socketOptions } = opts;
  const { ws, echo } = createSurfaceSocket(socketOptions);
  // `createLiveSignal` builds the oRPC link over THIS socket, derives the reactive
  // transport `status`, wires the half-open watchdog (probing `system.live` over the
  // link it just built — anchored to the socket it reconnects), AND mints the BRANDED
  // `live` the client requires — in one call. We build the client over `transport.link`
  // so client and watchdog share ONE link over the ONE socket. Without that brand
  // `surfaceClient` refuses a bare `{ live }` over this websocket: a surface whose
  // socket is silently half-open (or retired `down`) but whose subs already yielded a
  // first frame would otherwise read `ready` — the green-dot-over-a-dead-link lie.
  const transport = createLiveSignal<SurfaceContractFor<S>>(ws, {
    ...hb,
    retireOnStaleClose: socketOptions.retireOnStaleClose,
    // The stale-restart code is a surface-app protocol constant, defaulted HERE
    // (createLiveSignal lives in @kolu/surface and takes it explicitly).
    restartCloseCode:
      socketOptions.restartCloseCode ?? STALE_PROCESS_CLOSE_CODE,
  });
  const client = surfaceClient(surface, transport.link, {
    live: transport.live,
  });
  return {
    ws,
    echo,
    client,
    status: transport.status,
    // Stop the watchdog AND tear down the client's build-time standing
    // subscriptions (the eager `liveWhen`-cell readiness subs — present when the
    // surface is mirrored), so a torn-down socket leaks neither.
    dispose: () => {
      transport.dispose();
      client.dispose();
    },
  };
}
