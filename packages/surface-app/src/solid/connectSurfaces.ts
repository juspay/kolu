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
import { websocketLink } from "@kolu/surface/links/websocket";
import { probeSurfaceLive } from "@kolu/surface/liveness";
import {
  createLiveSignal,
  type HeartbeatTuning,
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
 *  client bundle, the reactive transport `status`, the COMBINED health fact across
 *  every sibling, and a `dispose` that stops the heartbeat and tears down every
 *  client's standing subscriptions. */
export interface SurfacesConnection<
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces.
  E extends Record<string, Surface<any>>,
> {
  ws: PartySocket;
  echo: ProcessIdEcho;
  /** One scoped `surfaceClient` per sibling surface (the `surfaceClients` shape).
   *  Reach a sibling's primitives through `clients.<key>` and its procedures
   *  through `clients.<key>.rpc` (the scoped slice). */
  clients: SurfaceClients<E>;
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
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces.
  const E extends Record<string, Surface<any>>,
>(opts: ConnectSurfacesOptions<E>): SurfacesConnection<E> {
  const { surfaces, heartbeat: hb, ...socketOptions } = opts;
  const { ws, echo } = createSurfaceSocket(socketOptions);
  // biome-ignore lint/suspicious/noExplicitAny: the combined link's `.rpc` is too complex to represent generically (TS2590); the scoped per-sibling specs carry call-site safety.
  const link = websocketLink(ws as unknown as WebSocket) as any;
  // `createLiveSignal` wires the half-open watchdog AND mints the BRANDED `live`
  // the one socket feeds to every sibling's `health().live` — the leg
  // `surfaceClientsHealth` AND-reduces, so a dead combined socket flips the merged
  // fact not-live. `surfaceClients` refuses a bare `{ live }` over this websocket;
  // only the brand minted here (through the watchdog) is accepted. The watchdog's
  // base probe is the framework-reserved `system.live` round-trip on the FIRST
  // sibling's scoped rpc — every surface answers it, so no per-app probe. The probe
  // thunk is lazy (it fires on the heartbeat interval), so it reads `clients` built
  // just below: `clients` is assigned synchronously before any interval fires.
  let clients: SurfaceClients<E>;
  const transport = createLiveSignal(ws, {
    probe: () =>
      probeSurfaceLive(
        (Object.values(clients)[0] as { rpc: unknown } | undefined)?.rpc,
      ),
    ...hb,
    retireOnStaleClose: socketOptions.retireOnStaleClose,
    restartCloseCode:
      socketOptions.restartCloseCode ?? STALE_PROCESS_CLOSE_CODE,
  });
  clients = surfaceClients(link, surfaces, { live: transport.live });
  return {
    ws,
    echo,
    clients,
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
