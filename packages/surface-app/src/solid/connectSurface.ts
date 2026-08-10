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
 * is optional to read — you can build a client and ignore `status` — but the wire's
 * terminal state is not something an app is allowed to be unaware of, so the
 * handler is a required option rather than an ignorable return value (see
 * `RetiredHandler`). The `pid` handshake, which used to be the OTHER ignorable
 * return value, is gone from the result entirely: the socket feeds its own echo.
 */

import type { Surface, SurfaceSpec } from "@kolu/surface/define";
import type { WebsocketLink } from "@kolu/surface/links/websocket";
import {
  createLiveSignal,
  type HeartbeatTuning,
  type SurfaceClient,
  type SurfaceConnectionStatus,
  surfaceClient,
} from "@kolu/surface/solid";
import type { Accessor } from "solid-js";
import { createSurfaceSocket, type SurfaceSocketOptions } from "../connect";

export interface ConnectSurfaceOptions<S extends SurfaceSpec>
  extends Omit<SurfaceSocketOptions, "group" | "siblingKey"> {
  /** The surface to build a reactive client for. Its `group` is what the wire
   *  link is built over, so the seam takes the surface (not a separate group) —
   *  a client and a wire that disagreed about the contract is unspellable. */
  surface: Surface<S>;
  /** TUNE the always-on liveness heartbeat (`intervalMs`/`timeoutMs`/`onStale`).
   *  There is deliberately NO disable option: the seam mints the watchdog-backed
   *  brand `surfaceClient` requires, and a disabled watchdog would mint a
   *  branded-but-blind signal — the override knob the design philosophy forbids.
   *  A wire whose liveness another layer owns simply doesn't use this seam (it
   *  passes that layer's `LiveSignalHandle` to `surfaceClient` directly). */
  heartbeat?: HeartbeatTuning;
}

/** A live single-surface connection: the wire link, the reactive client, a
 *  reactive transport `status` (for a per-connection indicator), and a `dispose`
 *  that stops the liveness heartbeat and closes the wire.
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
  /** Reactive transport status — `connecting` / `live` / `reconnecting` /
   *  `retired` — derived from the wire's own status stream (no identity probe).
   *  Render it so the watchdog's recovery is VISIBLE rather than silent. The
   *  terminal `retired` is spelled out here (it used to project as `down`, which
   *  read as a transient drop), so a four-state indicator built on this accessor
   *  alone can say "the server was replaced" — no lifecycle required. */
  status: Accessor<SurfaceConnectionStatus>;
  /** Stop the liveness heartbeat, tear down the client's standing subscriptions,
   *  and close the wire. A per-app-lifetime wire (cached for the page's life,
   *  like drishti's per-host clients) needn't call this. Async because releasing
   *  the link's scope is. */
  dispose: () => Promise<void>;
}

export async function connectSurface<const S extends SurfaceSpec>(
  opts: ConnectSurfaceOptions<S>,
): Promise<SurfaceConnection<S>> {
  const { surface, heartbeat: hb, ...socketOptions } = opts;
  const socket = await createSurfaceSocket({
    ...socketOptions,
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
  const client = surfaceClient(surface, transport);
  return {
    link,
    client,
    status: transport.status,
    // Stop the watchdog, tear down the client's build-time standing
    // subscriptions (the eager `liveWhen`-cell readiness subs — present when the
    // surface is mirrored), and release the socket (its identity/retired observers
    // plus the link's dial/ping/response fibers), so a torn-down connection leaks
    // none of the three.
    dispose: async () => {
      transport.dispose();
      client.dispose();
      await socket.dispose();
    },
  };
}
