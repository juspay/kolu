/**
 * `connectSurfaces` — the turnkey client seam for MULTIPLE sibling surfaces over
 * ONE reconnecting socket, with the liveness watchdog wired in by default.
 *
 * The multi-surface counterpart to `connectSurface`: where that builds one
 * `surfaceClient` over one socket, this builds a `surfaceClients` BUNDLE (drishti's
 * control plane multiplexes `admin` + `surfaceApp` over a single transport) and
 * wires the SAME default-on watchdog — one socket, one `createLiveSignal` (which
 * derives the transport status, wires the half-open heartbeat probing the
 * framework-reserved `system.live` round-trip on the first sibling, AND mints the
 * branded `live`). So a multi-surface app gets half-open detection BY CONSTRUCTION,
 * exactly like a single-surface one — instead of hand-rolling `createSurfaceSocket`
 * → `websocketLink` → `surfaceClients` and (the step the hand-built path forgot) a
 * `createHeartbeat`. The combined fact folds via {@link surfaceClientsHealth}, and
 * the per-sibling `{ live }` is threaded from the one socket's status so the
 * AND-reduce flips on a dead transport.
 *
 * There is NO `heartbeat: false` opt-out here: this seam mints the watchdog-backed
 * brand, so disabling its watchdog would mint a branded-but-blind signal. When the
 * same socket carries a SECOND consumer (drishti's admin socket also drives a
 * `<SurfaceAppProvider>` lifecycle), the watchdog lives HERE (one socket, one
 * watchdog, one honest brand) and the lifecycle — which mints no brand — opts ITS
 * own watchdog out (`heartbeat: false` on `createServerLifecycle` / the provider).
 */

import type { Surface } from "@kolu/surface/define";
import {
  type AnyContractRouter,
  createLiveSignal,
  type HeartbeatTuning,
  type LiveSignalHandle,
  type SurfaceClients,
  type SurfaceConnectionStatus,
  type SurfaceHealth,
  surfaceClients,
  surfaceClientsHealth,
} from "@kolu/surface/solid";
import type { WebSocket as PartySocket } from "partysocket";
import type { Accessor } from "solid-js";
import { STALE_PROCESS_CLOSE_CODE } from "../index";
import {
  createSurfaceSocket,
  type ProcessIdEcho,
  type SurfaceSocketOptions,
} from "../connect";

export interface ConnectSurfacesOptions<
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces, each pinning its own spec.
  E extends Record<string, Surface<any>>,
> extends SurfaceSocketOptions {
  /** The sibling surfaces to build a client bundle for — the same map
   *  `surfaceClients` takes (`{ admin: adminSurface, surfaceApp: appSurface }`).
   *  Each becomes a scoped client at `/surface/<key>/<prim>/<verb>`. */
  surfaces: E;
  /** TUNE the always-on liveness heartbeat (`intervalMs`/`timeoutMs`/`onStale`) —
   *  the same knob `connectSurface` accepts. There is deliberately NO disable
   *  option: this seam mints the watchdog-backed brand, and a disabled watchdog
   *  would mint a branded-but-blind signal (the forbidden override knob). When
   *  another layer owns the socket's lifecycle (drishti's admin socket, watched by
   *  `<SurfaceAppProvider>`'s `createServerLifecycle`), THAT layer opts its
   *  watchdog out (`heartbeat: false` on the lifecycle, which mints no brand) — so
   *  this seam stays the single watchdog and the single, honest brand. */
  heartbeat?: HeartbeatTuning;
}

/** A live multi-surface connection: the shared socket, its `pid` echo, the per-key
 *  client bundle, the COMBINED combined link (for root-level raw procedures), the
 *  reactive transport `status`, the COMBINED health fact across every sibling, and a
 *  `dispose` that stops the heartbeat and tears down every client's standing
 *  subscriptions. */
export interface SurfacesConnection<
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces.
  E extends Record<string, Surface<any>>,
  C extends AnyContractRouter = AnyContractRouter,
> {
  ws: PartySocket;
  echo: ProcessIdEcho;
  /** One scoped `surfaceClient` per sibling surface (the `surfaceClients` shape).
   *  Reach a sibling's primitives through `clients.<key>` and its procedures
   *  through `clients.<key>.rpc` (the scoped slice). */
  clients: SurfaceClients<E>;
  /** The combined oRPC link `createLiveSignal` built over the shared socket — the
   *  one the per-sibling clients are scoped FROM, with the sibling surfaces under
   *  `link.surface.<key>`. A consumer with ROOT-level raw procedures multiplexed at
   *  the same socket (kolu's `terminal`/`git`/`server` at the combined link's root)
   *  reaches them here, so it no longer has to re-assemble `createSurfaceSocket` →
   *  `createLiveSignal` → `surfaceClients` by hand just to get the link. Typed
   *  `ContractRouterClient<C, …>` (via the handle's own `link`) when
   *  `connectSurfaces<C>` was called with the combined contract (kolu), else the
   *  loose default. */
  link: LiveSignalHandle<C>["link"];
  /** Reactive transport status (`connecting`/`live`/`reconnecting`/`down`) from
   *  the one shared socket's open/close. */
  status: Accessor<SurfaceConnectionStatus>;
  /** The COMBINED health fact — `surfaceClientsHealth(clients)` — folding every
   *  sibling's subs + the shared transport `live` (AND-reduced). Pass it straight
   *  to `<SurfaceGate health={conn.health}>` / `<HostStatusPip health={conn.health}>`. */
  health: () => SurfaceHealth;
  /** Stop the heartbeat (if any) and dispose every sibling client's standing
   *  subscriptions. A page-lifetime cached bundle needn't call it. */
  dispose: () => void;
}

export function connectSurfaces<
  C extends AnyContractRouter = AnyContractRouter,
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces.
  const E extends Record<string, Surface<any>> = Record<string, Surface<any>>,
>(opts: ConnectSurfacesOptions<E>): SurfacesConnection<E, C> {
  const { surfaces, heartbeat: hb, ...socketOptions } = opts;
  // Fail fast on an empty surface map: the watchdog probes `system.live` on the
  // FIRST sibling's slice, so with no sibling there is no probe target and the
  // heartbeat would degrade noisily (a wrong/absent `siblingKey` reached
  // `createLiveSignal`, which — over a lazy oRPC proxy — cannot itself tell a real
  // key from a typo). The key is only knowable here, where the surface map lives, so
  // the existence assertion belongs here (the call site), not on the proxy. This also
  // removes the old `Object.keys(surfaces)[0] as string`, which CAST away `undefined`.
  const siblingKey = Object.keys(surfaces)[0];
  if (siblingKey === undefined) {
    throw new Error(
      "connectSurfaces: `surfaces` is empty — there is no sibling whose reserved " +
        "`system.live` the half-open watchdog can probe. Pass at least one surface.",
    );
  }
  const { ws, echo } = createSurfaceSocket(socketOptions);
  // `createLiveSignal` builds the combined oRPC link over THIS socket, wires the
  // half-open watchdog (probing `system.live` over that link, sliced to the FIRST
  // sibling — every sibling answers it), AND mints the BRANDED handle whose one
  // `live` the socket feeds to every sibling's `health().live` (the leg
  // `surfaceClientsHealth` AND-reduces, so a dead combined socket flips the merged
  // fact not-live). We hand the WHOLE handle to `surfaceClients` so clients and probe
  // share ONE link — there is no separate, fabricatable probe target.
  const transport = createLiveSignal<C>(ws, {
    siblingKey,
    ...hb,
    retireOnStaleClose: socketOptions.retireOnStaleClose,
    restartCloseCode:
      socketOptions.restartCloseCode ?? STALE_PROCESS_CLOSE_CODE,
  });
  // Hand the WHOLE handle to `surfaceClients` — it reads the combined `.link` and the
  // shared watchdog-backed `.live` off it, scopes the link per sibling, and threads
  // the one `live` into every sibling's `health().live` (paired by construction).
  const clients = surfaceClients(transport, surfaces);
  return {
    ws,
    echo,
    clients,
    // The combined link createLiveSignal built — exposed so a consumer with
    // root-level raw procedures multiplexed at the same socket (kolu) reaches them
    // without re-assembling the socket+watchdog+clients wiring this seam owns.
    link: transport.link,
    status: transport.status,
    health: () => surfaceClientsHealth(clients),
    dispose: () => {
      transport.dispose();
      for (const client of Object.values(clients)) {
        (client as { dispose: () => void }).dispose();
      }
    },
  };
}
