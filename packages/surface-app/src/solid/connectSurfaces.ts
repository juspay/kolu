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
  createSurfaceReadout,
  type HeartbeatTuning,
  type LiveSignalHandle,
  type OnClientError,
  type SurfaceClients,
  type SurfaceHealth,
  type SurfaceReadout,
  surfaceClients,
  surfaceClientsHealth,
} from "@kolu/surface/solid";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import type { Accessor } from "solid-js";
import { createSurfaceSocket, type SurfaceSocketOptions } from "../connect";

export interface ConnectSurfacesOptions<
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces, each pinning its own spec.
  E extends Record<string, Surface<any>>,
  // The sibling key is DERIVED here (the first surface), not passed: this seam is
  // the one that knows the surface map.
> extends Omit<SurfaceSocketOptions, "group" | "siblingKey"> {
  /** The sibling surfaces to build a client bundle for — the same map
   *  `surfaceClients` takes (`{ admin: adminSurface, surfaceApp: appSurface }`).
   *  Each becomes a scoped client at the tags `surface/<key>/<member>/<verb>`.
   *  The combined `RpcGroup` the wire is built over is derived from them here
   *  (`composeSurfaceContracts`), so the wire and the clients can never disagree
   *  about which members exist. */
  surfaces: E;
  /** Groups MULTIPLEXED on the same wire that are not sibling `Surface`s — the tags a
   *  consumer dials over `conn.transport` rather than through `clients.<key>`:
   *
   *   - a keyed `SurfaceMap`'s group, for the documented
   *     `connectSurfaceMap(map, conn.transport)` composition (kolu's padi host map);
   *   - a host's HAND-WRITTEN root procedures (kolu's `server/*`, `daemon/*`,
   *     `hosts/*`), reached through `conn.transport.dispatch`.
   *
   *  They belong here because the wire's `RpcGroup` is what carries every tag's
   *  payload/success SCHEMAS: Effect RPC's flat client looks a call's tag up in the
   *  group it was built over, so a tag the group never minted cannot be dispatched at
   *  all. Deriving the group from `surfaces` ALONE therefore made the two documented
   *  multiplexing paths above unspellable — the wire connected, and every call over it
   *  died. This option is what keeps "the wire serves exactly the tags this connection
   *  can dial" true for a consumer that multiplexes.
   *
   *  Each group must be DISJOINT from the composed siblings and from every other extra
   *  group: `RpcGroup.merge` is a last-writer-wins `Map.set` with no collision
   *  detection, so a collision would silently drop one spelling of a shared tag. The
   *  merge below COUNTS the result and throws if any tag was swallowed. */
  extraGroups?: ReadonlyArray<RpcGroup.RpcGroup<Rpc.Any>>;
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

/** A live multi-surface connection: the shared wire, the per-key client bundle,
 *  the branded transport handle (for framework composition), the reactive
 *  `readout` (the wire's state folded with every sibling's subscription health),
 *  the COMBINED health fact across every sibling, and a `dispose` that stops the
 *  heartbeat, tears down every client's standing subscriptions, and closes the
 *  wire.
 *
 *  No `echo`: the socket feeds its own `pid` handshake (see `../connect`), so there
 *  is no longer a returned value whose omission silently kills it. */
export interface SurfacesConnection<
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces.
  E extends Record<string, Surface<any>>,
> {
  /** The wire this bundle rides — `{ dispatch, wire, dispose }`. (Was
   *  `ws: PartySocket`.) */
  link: WebsocketLink;
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
  /** The reactive READOUT (`@kolu/surface/solid`'s {@link SurfaceReadout}) —
   *  `connecting` / `live` / `degraded` / `reconnecting` / `retired`, the
   *  `needsReload` bit, and the NAMES of whatever stopped — folded from the shared
   *  wire's status AND the combined fact below, so `live` is a claim about what
   *  reaches the page rather than about a socket. Across siblings the names arrive
   *  already prefixed by surface key (`surfaceApp/buildInfo`), which is what makes
   *  a multi-surface degraded readout say WHICH surface went quiet.
   *
   *  It replaced a transport-only `status` beside a `health()` an app could
   *  forget to call. Memoized, so every indicator bound to it costs one fold. */
  readout: Accessor<SurfaceReadout>;
  /** The COMBINED health fact — `surfaceClientsHealth(clients)` — folding every
   *  sibling's subs + the shared transport `live` (AND-reduced). Pass it straight
   *  to `<SurfaceGate health={conn.health}>` / `<HostStatusPip health={conn.health}>`.
   *
   *  Still the FACT, and still the gate's input: the gate's policy (pending blocks
   *  the body) is deliberately not the readout's (pending does not amber the
   *  light). Note it re-folds the whole registry per READ — bind
   *  {@link SurfacesConnection.readout} for an indicator; reach for the raw fact
   *  when a component wants the per-sub `pending`/`error` detail. */
  health: () => SurfaceHealth;
  /** Stop the heartbeat, dispose every sibling client's standing subscriptions,
   *  and release the wire. A page-lifetime cached bundle needn't call it. */
  dispose: () => Promise<void>;
}

export async function connectSurfaces<
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces.
  const E extends Record<string, Surface<any>> = Record<string, Surface<any>>,
>(opts: ConnectSurfacesOptions<E>): Promise<SurfacesConnection<E>> {
  const {
    surfaces,
    extraGroups = [],
    heartbeat: hb,
    onClientError,
    ...socketOptions
  } = opts;
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
  // ...plus anything else multiplexed on this wire (a keyed map's group, a host's
  // root procedures). `RpcGroup.merge` has no collision detection, so disjointness is
  // only real if it is COUNTED — the same proof kolu-server's `servedGroup` carries on
  // the serving side. A swallowed tag would present as "the wire is up and this one
  // call answers the wrong schema", which is far worse than a boot crash.
  const expectedTags = extraGroups.reduce(
    (n, g) => n + g.requests.size,
    composed.group.requests.size,
  );
  const group = extraGroups.reduce(
    (g, extra) => g.merge(extra),
    composed.group as RpcGroup.RpcGroup<Rpc.Any>,
  );
  if (group.requests.size !== expectedTags) {
    throw new Error(
      `connectSurfaces: the dialled group carries ${group.requests.size} tag(s), expected ` +
        `${expectedTags} — an \`extraGroups\` entry collides with a sibling surface's tags ` +
        "(or with another extra group), and the merge silently dropped one of them.",
    );
  }
  const socket = await createSurfaceSocket({
    ...socketOptions,
    group,
    // The reserved `system/identity` member the echo probe reads lives under EVERY
    // sibling's tag prefix and answers the same per-process id, so the first
    // sibling — the same one the watchdog probes for `system/live` — is the one
    // both reserved round-trips address.
    siblingKey,
  });
  const { link } = socket;
  // `createLiveSignal` takes the WHOLE `{ dispatch, wire }` the link factory
  // minted: it wires the half-open watchdog (probing the reserved liveness member
  // at the FIRST sibling's tag — every sibling answers it) AND mints the BRANDED
  // handle whose one `live` feeds every sibling's `health().live` (the leg
  // `surfaceClientsHealth` AND-reduces, so a dead wire flips the merged fact
  // not-live). We hand that whole handle to `surfaceClients` so clients and probe
  // share ONE dispatch — there is no separate, fabricatable probe target.
  const transport = createLiveSignal(link, { siblingKey, ...hb });
  const clients = surfaceClients(transport, surfaces, onClientError);
  const health = (): SurfaceHealth => surfaceClientsHealth(clients);
  // ONE fold of the two facts for the whole bundle: the shared wire's status and
  // every sibling's subs. Memoized here (this seam runs outside any reactive
  // owner, so the memo brings its own root) rather than re-walked at each
  // indicator — the merged fact re-folds N registries per read.
  const readout = createSurfaceReadout(transport.status, health);
  return {
    link,
    clients,
    transport,
    readout: readout.readout,
    health,
    dispose: async () => {
      transport.dispose();
      readout.dispose();
      for (const client of Object.values(clients)) {
        (client as { dispose: () => void }).dispose();
      }
      await socket.dispose();
    },
  };
}
