/**
 * `connectSurface` — the turnkey client seam for a SINGLE surface over one
 * reconnecting wire, with the liveness watchdog wired in BY DEFAULT.
 *
 * This is the no-lifecycle counterpart to `createServerLifecycle`: an app with
 * no shared connection-status UI driven off the wire — drishti's per-host
 * fleet wires — builds its reactive client AND its half-open watchdog in one
 * call, instead of hand-rolling `createSurfaceSocket` → `createLiveSignal` →
 * `surfaceClient` (the steps every such app FORGOT — the watchdog, and threading
 * its handle). The heartbeat is default-on and probes the framework-reserved
 * `system/live` member (`@kolu/surface/liveness`), so it needs no app-supplied
 * probe — there is no probe left for an app to forget.
 *
 * An app that DOES drive shared connection-status UI off the wire (kolu's
 * header dot) derives a `createServerLifecycle` instead — which folds the SAME
 * watchdog in — and builds its own (possibly multi-sibling) clients over the
 * combined dispatch. So an app that reaches for either of the two seams gets the
 * liveness watchdog BY DEFAULT — there is no probe to forget. (A consumer that
 * hand-builds the raw seam, like a minimal example, calls `createLiveSignal(link)`
 * itself and passes the WHOLE handle to `surfaceClient(surface, transport)` — that
 * is the only hand-built path, since handing `surfaceClient` a bare wire dispatch
 * THROWS, and the branded handle can't be obtained any other way. The seams exist so
 * it doesn't have to wire the wire + client + watchdog by hand.)
 *
 * ASYNC (PLAN D5): the dial is `websocketLink`, and building a protocol and its
 * fibers is an effect — so this seam, like every wire link factory, returns a
 * Promise.
 *
 * WHAT THE CALLER MUST STILL SPELL: `retired`. Everything else this seam produces
 * is optional to read — you can build a client and ignore the readout — but the
 * wire's terminal state is not something an app is allowed to be unaware of, so the
 * handler is a required option rather than an ignorable return value (see
 * `RetiredHandler`). The `pid` handshake, which used to be the OTHER ignorable
 * return value, is gone from the result entirely: the socket feeds its own echo.
 *
 * WHAT AN INDICATOR READS is `readout`, not a transport `status`. This seam used
 * to hand back the transport's own four states, leaving the fifth — a live socket
 * under a DEAD subscription — to a `client.health()` call an app was free to skip.
 * Apps skipped it, and a page whose collection had stopped arriving drew a green
 * light over an empty screen. The two facts are folded (and memoized) here now, so
 * "green" is a claim about what reaches the page; see `@kolu/surface/solid`'s
 * `./readout` for the five states, and for the line between what the framework
 * decides (which state is true) and what the app decides (what it is called).
 */

import type { Surface, SurfaceSpec } from "@kolu/surface/define";
import type { WebsocketLink } from "@kolu/surface/links/websocket";
import {
  createLiveSignal,
  createSurfaceReadout,
  type HeartbeatTuning,
  type OnClientError,
  type SurfaceClient,
  type SurfaceReadout,
  surfaceClient,
} from "@kolu/surface/solid";
import type { Accessor } from "solid-js";
import { createSurfaceSocket, type SurfaceSocketOptions } from "../connect";
import { surfaceWsUrl } from "../index";

/** The dial URL when the caller names none: the page's own origin through
 *  `surfaceWsUrl`. A thunk deferred to connect time, so merely importing this
 *  module never touches `location`; called without one (Node), it throws
 *  loudly instead of dialling a fabricated address. */
const defaultSurfaceUrl = (): string => {
  if (typeof location === "undefined") {
    throw new Error(
      "connectSurface: no `url` was given and there is no browser `location` " +
        "to derive one from — pass `url` explicitly outside a browser",
    );
  }
  return surfaceWsUrl(location.origin);
};

export interface ConnectSurfaceOptions<S extends SurfaceSpec>
  extends Omit<SurfaceSocketOptions, "group" | "siblingKey" | "url"> {
  /** The surface to build a reactive client for. Its `group` is what the wire
   *  link is built over, so the seam takes the surface (not a separate group) —
   *  a client and a wire that disagreed about the contract is unspellable. */
  surface: Surface<S>;
  /** Base WS URL — a string, or a thunk re-evaluated on every reconnect when
   *  the base itself varies (the `pid` echo is appended on top either way; see
   *  `SurfaceSocketOptions.url`). OPTIONAL here, unlike the raw socket seam:
   *  omitted, it defaults to `surfaceWsUrl(location.origin)` — the page's own
   *  origin through the ONE scheme-swap + path derivation, which is the value
   *  a browser consumer spells by hand otherwise (never a choice: a browser
   *  app dials the origin that served it, and the reference consumer's hand
   *  wiring re-derived exactly this). Omitting it anywhere without a
   *  `location` (a Node caller) throws loudly — pass the URL you actually
   *  mean there. */
  url?: SurfaceSocketOptions["url"];
  /** TUNE the always-on liveness heartbeat (`intervalMs`/`timeoutMs`/`onStale`).
   *  There is deliberately NO disable option: the seam mints the watchdog-backed
   *  brand `surfaceClient` requires, and a disabled watchdog would mint a
   *  branded-but-blind signal — the override knob the design philosophy forbids.
   *  A wire whose liveness another layer owns simply doesn't use this seam (it
   *  passes that layer's `LiveSignalHandle` to `surfaceClient` directly). */
  heartbeat?: HeartbeatTuning;
  /** The app's ONE origin-free client-error interpreter — the same slot
   *  `connectSurfaces` takes, in the same position, for the same reason: a
   *  surface whose spec DECLARES a `client.onError` policy (built through
   *  `defineSurfaceWithPolicy`) has to have somewhere to route it, and
   *  `buildSurfaceClient` throws at CONSTRUCTION when a declared policy would route
   *  nowhere — a declared error handler that silently swallows is the
   *  `caught-error-must-not-collapse-to-empty` defect.
   *
   *  Without this slot a policy-bearing surface was simply unreachable through this
   *  door while every other door in the family took the interpreter — an asymmetry
   *  with no design behind it, since the underlying `surfaceClient` has taken the
   *  argument all along.
   *
   *  OPTIONAL at the type: a policy-FREE surface (`TPolicy = never`, every caller
   *  that existed before the slot) declares no `client.onError`, so it needs none. */
  onClientError?: OnClientError;
}

/** A live single-surface connection: the wire link, the reactive client, the
 *  reactive `readout` (for a per-connection indicator that cannot lie), and a
 *  `dispose` that stops the liveness heartbeat and closes the wire.
 *
 *  There is no `echo` here any more. It used to be returned for an app to feed, and
 *  an app that dropped it shipped a dead stale-tab handshake (olai#61);
 *  `createSurfaceSocket` feeds it itself now, so there is nothing on this value
 *  whose omission breaks the wire. An app that shares ONE echo across several wires
 *  still creates it (`createProcessIdEcho()`) and passes it IN. */
export interface SurfaceConnection<S extends SurfaceSpec> {
  /** The wire this connection rides — `{ dispatch, wire, dispose }`. Read
   *  `link.wire` for the status stream / `forceReconnect`; `link.dispatch` is the
   *  branded seam the client is built over. (Was `ws: PartySocket`.) */
  link: WebsocketLink;
  /** The reactive surface client. `.cells` / `.collections` / `.streams` are
   *  fully typed off `S`; declared imperative procedures ride the bound
   *  `client.procedures.<ns>.<verb>(input)` face — typed straight from `S`, no cast.
   *  `.rpc` is the STRUCTURAL `SurfaceFace` (per-member precision lives in the
   *  bound faces — PLAN D2), reserved for the framework-reserved members
   *  (`system.live` / `system.identity` / `system.clockNow`) and as the escape
   *  hatch for a member the bound shapes can't model. */
  client: SurfaceClient<S>;
  /** The reactive READOUT (`@kolu/surface/solid`'s {@link SurfaceReadout}) —
   *  `connecting` / `live` / `degraded` / `reconnecting` / `retired`, plus the
   *  `needsReload` bit and, when degraded, the NAMES of the subscriptions that
   *  stopped. Render it so the watchdog's recovery is VISIBLE rather than silent.
   *
   *  It is the readout and not the transport's own `status` because the two
   *  answer different questions, and only one of them is what an indicator
   *  claims: a socket can be open and answering while a subscription riding it is
   *  dead, and a page drawn from the transport alone paints that green. `status`
   *  used to be handed back here beside a `client.health()` an app was free never
   *  to call — and the app that never called it shipped a dead collection
   *  rendering as an empty one under a green light. The conjunction is folded in
   *  now, memoized, so there is no second call left to forget.
   *
   *  What the readout does NOT carry is what any of it is CALLED: the app owns
   *  the words and the colours (see the readout module's docstring for the cut).
   *  A consumer that genuinely wants the SOCKET rather than the page still has
   *  it: the raw wire status rides `link.wire.status()` / `link.wire.onStatus`. */
  readout: Accessor<SurfaceReadout>;
  /** Stop the liveness heartbeat, tear down the client's standing subscriptions,
   *  and close the wire. A per-app-lifetime wire (cached for the page's life,
   *  like drishti's per-host clients) needn't call this. Async because releasing
   *  the link's scope is. */
  dispose: () => Promise<void>;
}

export async function connectSurface<const S extends SurfaceSpec>(
  opts: ConnectSurfaceOptions<S>,
): Promise<SurfaceConnection<S>> {
  const { surface, heartbeat: hb, url, onClientError, ...socketOptions } = opts;
  const socket = await createSurfaceSocket({
    ...socketOptions,
    url: url ?? defaultSurfaceUrl(),
    group: surface.group,
  });
  const { link } = socket;
  // `createLiveSignal` takes the WHOLE `{ dispatch, wire }` the link factory
  // minted together: it derives the reactive transport `status`, wires the
  // half-open watchdog (probing the reserved `system/live` TAG over the very
  // dispatch it guards), AND mints the BRANDED handle the client requires — in one
  // call. We hand that whole handle to `surfaceClient`, so client and watchdog
  // share ONE dispatch over ONE wire by construction. Without it `surfaceClient`
  // refuses a bare wire dispatch: a surface whose socket is silently half-open (or
  // retired `down`) but whose subs already yielded a first frame would otherwise
  // read `ready` — the green-dot-over-a-dead-link lie.
  const transport = createLiveSignal(link, hb ?? {});
  // The app's one error interpreter reaches this client too: a surface reached
  // through the SINGULAR door is no more allowed to route a declared policy nowhere
  // than one reached through the plural.
  const client = surfaceClient(surface, transport, onClientError);
  // The readout is the transport `status` folded WITH this client's own health
  // fact — the conjunction, memoized once here rather than re-derived (or
  // forgotten) at every indicator. It owns a `createRoot`, because this seam runs
  // outside any reactive owner, so its disposer joins the three below.
  const readout = createSurfaceReadout(transport.status, client.health);
  return {
    link,
    client,
    readout: readout.readout,
    // Stop the watchdog, drop the readout's memo, tear down the client's
    // build-time standing subscriptions (the eager `liveWhen`-cell readiness subs
    // — present when the surface is mirrored), and release the socket (its
    // identity/retired observers plus the link's dial/ping/response fibers), so a
    // torn-down connection leaks none of the four.
    dispose: async () => {
      transport.dispose();
      readout.dispose();
      client.dispose();
      await socket.dispose();
    },
  };
}
