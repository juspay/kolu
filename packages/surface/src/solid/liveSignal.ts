/**
 * `createLiveSignal` — derive a transport-liveness `LiveSignal` for a reconnecting
 * socket AND wire the half-open watchdog that makes it honest, in ONE call. It
 * returns a {@link LiveSignalHandle} that bundles the watchdog-backed `live`, the
 * oRPC `link` it guards, and the `status`/`dispose` handles as ONE inseparable
 * object — and THAT object is the **unforgeable** unit, by every vector:
 *
 *   - The brand is membership in a module-private, **un-reflectable** `WeakSet`
 *     ({@link LIVE_SIGNAL_HANDLES}). A `WeakSet` enumerates nothing, so a consumer
 *     holding a genuine handle cannot read the brand off it and copy it onto a
 *     hand-rolled `{ live, link }` look-alike.
 *   - The only thing that adds to that set is `createLiveSignal` below, AFTER the
 *     watchdog is wired and over the link it built — there is no exported stamper.
 *   - There is no `heartbeat: false` opt-out: `createLiveSignal` ALWAYS wires the
 *     watchdog, so a handle existing is proof a watchdog backs it.
 *   - The probe runs over a link `createLiveSignal` **builds from the very socket it
 *     watches and reconnects** — not a caller-supplied target. A consumer once handed
 *     back an in-memory `{ surface: { system: { live: () => Promise.resolve() } } }`
 *     that resolved off a literal (never touching the socket) and so branded a dead
 *     link; now the only inputs are the socket and an optional sibling-key STRING, so
 *     the probe channel IS the reconnected channel. The brand certifies the socket it
 *     guards is being PROBED.
 *   - The link the client is built over and the link the watchdog probes are the SAME
 *     object — because `surfaceClient`/`surfaceClients` take the WHOLE handle and read
 *     `.link` and `.live` off it themselves (you cannot hand them a `live` paired with
 *     a DIFFERENT, self-rolled `websocketLink(deadWs2)`). The pairing holds by
 *     construction, so there is nothing to re-prove at runtime — the old "watch ws1,
 *     build over ws2" forge is simply **unspellable**: no external caller supplies a
 *     separate link.
 *
 * The probe gate reads the SAME `status` `live` reads (not a second, independent
 * `ws.readyState`), so a socket can't be "open enough to set live, too closed to
 * probe" — the gate and the signal can never disagree.
 *
 * So the half-open-blind transport leg (`() => true`, or an open/close-only
 * `() => socketStatus() === "live"`) is not merely refused by the guard — it
 * literally cannot be SPELLED: there is no reachable function that turns such an
 * accessor into a `LiveSignalHandle` (#1564, one seam up from the dot). `surfaceClient`/
 * `surfaceClients` accept a half-openable websocket ONLY as a `LiveSignalHandle`
 * (see `surfaceClient`'s `resolveTransport`).
 *
 * It lives in `@kolu/surface` (not `@kolu/surface-app`) precisely so the brand set
 * and its sole minter share one module — co-location is what makes the stamp
 * un-namable from anywhere else. `@kolu/surface-app`'s `connectSurface` /
 * `connectSurfaces` wrap it (turnkey socket + client + watchdog); a hand-built
 * `surfaceClient + websocketLink` (a minimal example, or kolu's combined-link
 * `wire.ts`) calls it directly. It depends only on Solid + the framework-free
 * `@kolu/surface/heartbeat` primitive + a STRUCTURAL socket — no partysocket — so
 * the partysocket commitment stays in `@kolu/surface-app`.
 */

import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import type { AnyContractRouter, ContractRouterClient } from "@orpc/contract";
import { type Accessor, createSignal } from "solid-js";
import { createHeartbeat, type HeartbeatTuning } from "../heartbeat";
import { websocketLink } from "../links/websocket";
import { probeSurfaceLive } from "../liveness";

export type { HeartbeatTuning };

/** The brand membership set for {@link LiveSignalHandle}s. Module-private and
 *  **un-reflectable**: a `WeakSet` exposes no enumeration, so a consumer holding a
 *  genuine handle cannot read the brand off it and stamp a hand-rolled look-alike.
 *  The only way into this set is {@link createLiveSignal}, which adds the handle it
 *  returns AFTER wiring the watchdog over the link it built. */
const LIVE_SIGNAL_HANDLES = new WeakSet<object>();

/** True if `value` is a {@link LiveSignalHandle} minted by {@link createLiveSignal}
 *  — i.e. it carries a watchdog-backed `live` paired (by construction) with the
 *  `link` the watchdog probes. `surfaceClient`/`surfaceClients` consult this to take
 *  the WHOLE handle (reading `.link` and `.live` off it) over a half-openable
 *  websocket, instead of accepting a separately-supplied `{ live }` that would have
 *  to be re-proven to belong to the link. Read-only: checking membership can never
 *  add to the WeakSet. */
export function isLiveSignalHandle(
  value: unknown,
): value is LiveSignalHandle<AnyContractRouter> {
  return (
    typeof value === "object" &&
    value !== null &&
    LIVE_SIGNAL_HANDLES.has(value)
  );
}

/** A transport-liveness accessor `createLiveSignal` mints AFTER wiring the
 *  half-open watchdog and carries on the {@link LiveSignalHandle} it returns.
 *  Structurally an `Accessor<boolean>`; its honesty comes from the handle that
 *  bundles it with the link the watchdog probes — pass the WHOLE handle to
 *  `surfaceClient`/`surfaceClients`, never this accessor alone. */
export type LiveSignal = Accessor<boolean>;

/** The transport-level status of a reconnecting surface socket: `connecting`
 *  until the first `open`, `live` while open, `reconnecting` after a transient
 *  drop (partysocket auto-reconnects), `down` after a stale-close the socket was
 *  retired on (a parent restart — it won't reconnect until the page reloads). */
export type SurfaceConnectionStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "down";

/** The reconnecting socket a `LiveSignal` watches — the open/close events the
 *  status derivation reads PLUS the `readyState`/`OPEN`/`reconnect` verbs the
 *  half-open watchdog drives. Every real partysocket satisfies it. */
export type WatchableSocket = {
  readyState: number;
  readonly OPEN: number;
  reconnect: () => void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(
    type: "close",
    listener: (event?: { code?: number }) => void,
  ): void;
};

export interface CreateLiveSignalOptions extends HeartbeatTuning {
  /** For a MULTI-surface combined link, the sibling key whose framework-reserved
   *  `system.live` the watchdog probes (`link.surface[siblingKey].system.live`) —
   *  every surface answers it, so any sibling works; pass the first. Omit for a
   *  single-surface link, where `system.live` sits directly at `link.surface`.
   *
   *  Note this is a STRING, not a link object: `createLiveSignal` builds the oRPC
   *  link over the very socket it watches and reconnects (see {@link
   *  LiveSignalHandle.link}), then probes `system.live` over THAT link (sliced by
   *  this key). There is no caller-supplied probe target to fabricate — the prior
   *  `link: () => unknown` let a caller hand back an in-memory
   *  `{ surface: { system: { live: () => Promise.resolve() } } }` that resolves off a
   *  literal, never touching the socket, and so brand a dead link. Deriving the link
   *  from the owned socket internally is what makes "the watchdog probes the socket
   *  it reconnects" structurally true rather than asserted. */
  siblingKey?: string;
  /** A stale-close on a self-retiring socket reads `down` (terminally — reload to
   *  recover) instead of `reconnecting`. Off by default. */
  retireOnStaleClose?: boolean;
  /** The exact close code that marks a stale-restart when `retireOnStaleClose` is
   *  set — supplied by the caller (it is a `@kolu/surface-app` protocol constant,
   *  so it is NOT defaulted here; the connect seams pass it). */
  restartCloseCode?: number;
}

/** The branded unit `createLiveSignal` returns: the watchdog-backed `live`, the
 *  oRPC `link` it guards, the richer `status`, and `dispose` — ONE inseparable
 *  object, and the unit the brand lives on ({@link LIVE_SIGNAL_HANDLES}). Generic
 *  over the link's contract `C` so {@link LiveSignalHandle.link} is typed for the
 *  caller's client (no cast); defaults to `AnyContractRouter` when omitted (the
 *  multi-surface combined-link case, where the full type is too complex to
 *  represent — TS2590). Pass the WHOLE handle to `surfaceClient`/`surfaceClients`. */
export interface LiveSignalHandle<
  C extends AnyContractRouter = AnyContractRouter,
> {
  /** The watchdog-backed transport-liveness accessor — `true` only while the socket
   *  is `live`; a `down`/`reconnecting` transport (including after the watchdog forces
   *  a reconnect on a half-open socket) flips it `false`. `surfaceClient`/
   *  `surfaceClients` read it off the handle themselves; do not pull it out and pass
   *  it alone. */
  live: LiveSignal;
  /** The richer transport status the brand is derived from — render it for a
   *  per-connection indicator so the watchdog's recovery is VISIBLE, not silent. */
  status: Accessor<SurfaceConnectionStatus>;
  /** The oRPC link `createLiveSignal` built over the owned socket. `surfaceClient`/
   *  `surfaceClients` build the client over THIS link (read off the handle) so the
   *  client and the watchdog's probe share ONE link over the ONE socket — and so
   *  there is no separate, fabricatable probe target. Typed `ContractRouterClient<C,
   *  …>` when `createLiveSignal<C>` was called with the contract (single-surface
   *  seams, kolu's combined link), else the loose default. */
  link: ContractRouterClient<C, ClientRetryPluginContext>;
  /** Stop the watchdog (and any in-flight probe timeout). Wire to the consumer's
   *  teardown; a page-lifetime socket needn't call it. */
  dispose: () => void;
}

const warnStale = () =>
  console.warn(
    "surface: heartbeat probe timed out — forcing reconnect (half-open socket)",
  );

const warnProbeThrew = (error: unknown) =>
  console.warn(
    "surface: heartbeat probe threw synchronously — no round-trip was made; " +
      "the probe is likely miswired (heartbeat is inert until fixed)",
    error,
  );

export function createLiveSignal<
  C extends AnyContractRouter = AnyContractRouter,
>(ws: WatchableSocket, opts: CreateLiveSignalOptions): LiveSignalHandle<C> {
  // Derive the reactive transport `status` from the socket's own open/close. This
  // alone is half-open-BLIND (a silently dead socket fires neither event), which is
  // exactly why the watchdog below is mandatory — and why a bare
  // `() => status() === "live"` must never stand in for a `LiveSignalHandle`.
  const [status, setStatus] =
    createSignal<SurfaceConnectionStatus>("connecting");
  ws.addEventListener("open", () => setStatus("live"));
  ws.addEventListener("close", (event) => {
    const retired =
      opts.retireOnStaleClose === true &&
      opts.restartCloseCode !== undefined &&
      event?.code === opts.restartCloseCode;
    setStatus(retired ? "down" : "reconnecting");
  });
  // Build the oRPC link over THIS socket — the one we watch and reconnect — so the
  // probe channel IS the reconnected channel. There is no caller-supplied probe
  // target to fabricate: a caller could once hand back an in-memory
  // `{ surface: { system: { live: () => Promise.resolve() } } }` that resolves off a
  // literal (never touching `ws`) and brand a dead link; now the probe runs over the
  // link we built from `ws`, so "I probed something" can no longer differ from "I
  // probed the socket I'm guarding". The probe TARGET is `system.live` — sliced to
  // the named sibling for a combined link, or the link itself for a single surface.
  const link = websocketLink<C>(ws as unknown as WebSocket);
  // Walk-by-string of the freshly-built oRPC link to the named sibling (or the whole
  // link for a single surface). The cast is the narrow `{ surface }` shape, not `any`.
  const probeTarget: unknown =
    opts.siblingKey !== undefined
      ? {
          surface: (link as { surface: Record<string, unknown> }).surface[
            opts.siblingKey
          ],
        }
      : link;
  // The half-open watchdog — ALWAYS wired (there is no disable knob). It probes
  // `system.live` over the owned link while the socket is OPEN and, on a TIMEOUT,
  // forces `status` to `reconnecting` (so `live` flips false even if the socket's
  // own `reconnect()` somehow never fires a `close`) AND calls `ws.reconnect()` to
  // recover. The race/settle/skip-overlap/dispose algorithm is the framework-free
  // `@kolu/surface/heartbeat` primitive.
  // ONE source of truth for "is the socket live": the heartbeat's probe gate AND the
  // handle's `live` are the SAME closure, not two that merely happen to match. It
  // reads `status` (NOT a second, independent `ws.readyState === ws.OPEN`): the two
  // readings of the socket's openness could disagree — a socket whose `open` fired
  // while `readyState` never reached `OPEN` would freeze the gate shut forever, so
  // the probe never runs and `live` stays `true` over a dead socket. One closure
  // makes "the gate and the signal can never diverge" true by construction.
  const isLive = () => status() === "live";
  const heartbeat = createHeartbeat({
    isLive,
    onStale: () => {
      setStatus("reconnecting");
      ws.reconnect();
    },
    probe: () => probeSurfaceLive(probeTarget),
    intervalMs: opts.intervalMs,
    timeoutMs: opts.timeoutMs,
    onStaleReport: opts.onStale ?? warnStale,
    onProbeError: warnProbeThrew,
  });
  // Assemble the handle ONLY now — after the watchdog above is wired over the owned
  // link. Because this is the one place that builds the link, wires the watchdog,
  // AND mints the handle, a handle existing IS proof a watchdog probes the socket it
  // guards. Brand the handle object itself (not the `live` accessor): the link and
  // the live travel together on it, so the pairing holds by construction and
  // `surfaceClient`/`surfaceClients` need re-prove nothing — they read both legs off
  // this one object.
  const handle: LiveSignalHandle<C> = {
    live: isLive,
    status,
    link,
    dispose: () => heartbeat.dispose(),
  };
  LIVE_SIGNAL_HANDLES.add(handle);
  return handle;
}
