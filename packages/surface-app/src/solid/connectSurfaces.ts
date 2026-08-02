/**
 * `connectSurfaces` — the turnkey client seam for MULTIPLE sibling surfaces over
 * ONE reconnecting wire, with the liveness watchdog wired in by default.
 *
 * The multi-surface counterpart to `connectSurface`: where that builds one
 * `surfaceClient` over one wire, this builds a `surfaceClients` BUNDLE (drishti's
 * control plane multiplexes `admin` + `surfaceApp` over a single transport) and
 * wires the SAME default-on watchdog — one wire, one `createLiveSignal` (which
 * derives the transport status, wires the half-open heartbeat probing the
 * framework-reserved `system/live` member on the first sibling's TAG, AND mints the
 * branded `live`). So a multi-surface app gets half-open detection BY CONSTRUCTION,
 * exactly like a single-surface one — instead of hand-rolling `createSurfaceSocket`
 * → `surfaceClients` and (the step the hand-built path forgot) a watchdog. The
 * combined fact folds via {@link surfaceClientsHealth}, and the per-sibling
 * `{ live }` is threaded from the one wire's status so the AND-reduce flips on a
 * dead transport.
 *
 * There is NO `heartbeat: false` opt-out here: this seam mints the watchdog-backed
 * brand, so disabling its watchdog would mint a branded-but-blind signal. When the
 * same wire carries a SECOND consumer (drishti's admin wire also drives a
 * `<SurfaceAppProvider>` lifecycle), the watchdog lives HERE (one wire, one
 * watchdog, one honest brand) and the lifecycle — which mints no brand — opts ITS
 * own watchdog out (`heartbeat: false` on `createServerLifecycle` / the provider).
 *
 * ASYNC (PLAN D5), like `connectSurface`: the dial is an effect.
 */

import { composeSurfaceContracts, type Surface } from "@kolu/surface/define";
import type { WebsocketLink } from "@kolu/surface/links/websocket";
import {
  createLiveSignal,
  type HeartbeatTuning,
  type LiveSignalHandle,
  type OnClientError,
  type SurfaceClients,
  type SurfaceConnectionStatus,
  type SurfaceHealth,
  surfaceClients,
  surfaceClientsHealth,
} from "@kolu/surface/solid";
import type { Accessor } from "solid-js";
import {
  createSurfaceSocket,
  type ProcessIdEcho,
  type SurfaceSocketOptions,
} from "../connect";

export interface ConnectSurfacesOptions<
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces, each pinning its own spec.
  E extends Record<string, Surface<any>>,
> extends Omit<SurfaceSocketOptions, "group"> {
  /** The sibling surfaces to build a client bundle for — the same map
   *  `surfaceClients` takes (`{ admin: adminSurface, surfaceApp: appSurface }`).
   *  Each becomes a scoped client at the tags `surface/<key>/<member>/<verb>`.
   *  The combined `RpcGroup` the wire is built over is derived from them here
   *  (`composeSurfaceContracts`), so the wire and the clients can never disagree
   *  about which members exist. */
  surfaces: E;
  /** TUNE the always-on liveness heartbeat (`intervalMs`/`timeoutMs`/`onStale`) —
   *  the same knob `connectSurface` accepts. There is deliberately NO disable
   *  option: this seam mints the watchdog-backed brand, and a disabled watchdog
   *  would mint a branded-but-blind signal (the forbidden override knob). When
   *  another layer owns the wire's lifecycle (drishti's admin wire, watched by
   *  `<SurfaceAppProvider>`'s `createServerLifecycle`), THAT layer opts its
   *  watchdog out (`heartbeat: false` on the lifecycle, which mints no brand) — so
   *  this seam stays the single watchdog and the single, honest brand. */
  heartbeat?: HeartbeatTuning;
  /** The app's ORIGIN-FREE client error interpreter — threaded to EVERY sibling
   *  client so a spec-declared `client.onError` policy (a surface built via
   *  `defineSurfaceWithPolicy`) reaches app code on a subscription failure. The app
   *  spells ONE interpreter HERE (design §A/m4); `surfaceClients` forwards it to each
   *  `buildSurfaceClient`.
   *
   *  OPTIONAL at the type: a policy-FREE surface bundle (`TPolicy = never`, the
   *  existing callers) declares no `client.onError`, so it needs none. When a sibling
   *  DOES carry a policy, `buildSurfaceClient` THROWS at construction if this was
   *  omitted (design §D / F5) — a declared policy can never route nowhere. */
  onClientError?: OnClientError;
}

/** A live multi-surface connection: the shared wire, its `pid` echo, the per-key
 *  client bundle, the branded transport handle (for framework composition), the
 *  reactive transport `status`, the COMBINED health fact across every sibling, and a
 *  `dispose` that stops the heartbeat, tears down every client's standing
 *  subscriptions, and closes the wire. */
export interface SurfacesConnection<
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces.
  E extends Record<string, Surface<any>>,
> {
  /** The wire this bundle rides — `{ dispatch, wire, dispose }`. (Was
   *  `ws: PartySocket`.) */
  link: WebsocketLink;
  echo: ProcessIdEcho;
  /** One scoped `surfaceClient` per sibling surface (the `surfaceClients` shape).
   *  Reach a sibling's primitives through `clients.<key>` and its reserved members
   *  through `clients.<key>.rpc` (the tag-scoped face). */
  clients: SurfaceClients<E>;
  /** The BRANDED transport handle `createLiveSignal` minted (dispatch + watchdog
   *  `live` + status, paired by construction). Exposed for FRAMEWORK COMPOSITION over
   *  a SIBLING of this combined wire: `connectSurfaceMap(map, conn.transport)` slices
   *  the sibling named by `map.name` from the handle and recovers THIS wire's watchdog
   *  `live` — so a keyed map dialled over the sibling floors its chips on the real
   *  transport, with NO raw-`{ live }` seam to forge. It is also the handle to reach
   *  the COMBINED dispatch (`conn.transport.dispatch`) for a consumer with root-level
   *  members multiplexed at the same wire. The handle is unforgeable (module-private
   *  brand), so exposing it invites no green-over-dead lie. */
  transport: LiveSignalHandle;
  /** Reactive transport status (`connecting`/`live`/`reconnecting`/`down`) from
   *  the one shared wire's status stream. */
  status: Accessor<SurfaceConnectionStatus>;
  /** The COMBINED health fact — `surfaceClientsHealth(clients)` — folding every
   *  sibling's subs + the shared transport `live` (AND-reduced). Pass it straight
   *  to `<SurfaceGate health={conn.health}>` / `<HostStatusPip health={conn.health}>`. */
  health: () => SurfaceHealth;
  /** Stop the heartbeat, dispose every sibling client's standing subscriptions,
   *  and release the wire. A page-lifetime cached bundle needn't call it. */
  dispose: () => Promise<void>;
}

export async function connectSurfaces<
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces.
  const E extends Record<string, Surface<any>> = Record<string, Surface<any>>,
>(opts: ConnectSurfacesOptions<E>): Promise<SurfacesConnection<E>> {
  const { surfaces, heartbeat: hb, onClientError, ...socketOptions } = opts;
  // Fail fast on an empty surface map: the watchdog probes the reserved
  // `system/live` member on the FIRST sibling's TAG, so with no sibling there is
  // no probe target and the heartbeat would address a tag nothing serves. The key
  // is only knowable here, where the surface map lives, so the existence assertion
  // belongs here (the call site). This also removes the old
  // `Object.keys(surfaces)[0] as string`, which CAST away `undefined`.
  const siblingKey = Object.keys(surfaces)[0];
  if (siblingKey === undefined) {
    throw new Error(
      "connectSurfaces: `surfaces` is empty — there is no sibling whose reserved " +
        "`system/live` member the half-open watchdog can probe. Pass at least one surface.",
    );
  }
  // The ONE combined group every sibling's tags live in — the client twin of
  // `implementSurfaces`. Deriving it here (rather than taking it as an option)
  // is what makes "the wire serves exactly these surfaces" true by construction.
  const composed = composeSurfaceContracts(surfaces);
  const { link, echo } = await createSurfaceSocket({
    ...socketOptions,
    group: composed.group,
  });
  // `createLiveSignal` takes the WHOLE `{ dispatch, wire }` the link factory
  // minted: it wires the half-open watchdog (probing the reserved liveness member
  // at the FIRST sibling's tag — every sibling answers it) AND mints the BRANDED
  // handle whose one `live` feeds every sibling's `health().live` (the leg
  // `surfaceClientsHealth` AND-reduces, so a dead wire flips the merged fact
  // not-live). We hand that whole handle to `surfaceClients` so clients and probe
  // share ONE dispatch — there is no separate, fabricatable probe target.
  const transport = createLiveSignal(link, { siblingKey, ...hb });
  const clients = surfaceClients(transport, surfaces, onClientError);
  return {
    link,
    echo,
    clients,
    transport,
    status: transport.status,
    health: () => surfaceClientsHealth(clients),
    dispose: async () => {
      transport.dispose();
      for (const client of Object.values(clients)) {
        (client as { dispose: () => void }).dispose();
      }
      await link.dispose();
    },
  };
}
