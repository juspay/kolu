/**
 * `createLiveSignal` — derive a transport-liveness `LiveSignal` for a reconnecting
 * socket AND wire the half-open watchdog that makes it honest, in ONE call. This
 * is the ONLY way to obtain a `LiveSignal`, and it is **unforgeable** — by every
 * vector, not just import:
 *
 *   - The brand is membership in a module-private, **un-reflectable** `WeakSet`
 *     ({@link BRANDED_LIVE}). A `WeakSet` enumerates nothing, so — unlike the
 *     round-7 symbol property — a consumer holding a genuine `LiveSignal` cannot
 *     read the brand off it and copy it onto a blind accessor.
 *   - The function that stamps it ({@link brandLiveSignal}) is **never exported** —
 *     private to this module, called only by `createLiveSignal` below, AFTER the
 *     watchdog is wired.
 *   - There is no `heartbeat: false` opt-out: `createLiveSignal` ALWAYS wires the
 *     watchdog, so a `LiveSignal` existing is proof a watchdog backs it.
 *   - The probe runs over a link `createLiveSignal` **builds from the very socket it
 *     watches and reconnects** — not a caller-supplied target. A consumer once handed
 *     back an in-memory `{ surface: { system: { live: () => Promise.resolve() } } }`
 *     that resolved off a literal (never touching the socket) and so branded a dead
 *     link; now the only inputs are the socket and an optional sibling-key STRING, so
 *     the probe channel IS the reconnected channel. The brand certifies the socket it
 *     guards is being PROBED — "I probed something" cannot differ from "I probed the
 *     thing I'm guarding."
 *   - The brand is **bound to that built link by identity** ({@link LIVE_SIGNAL_LINK}),
 *     and `requireTransportLive` checks the binding — so a caller cannot mint a brand
 *     over a HEALTHY socket and then build the client over a self-rolled
 *     `websocketLink(deadWs2)`: the brand vouches only for the link the watchdog
 *     actually probes. "I hold a brand" cannot differ from "I hold the brand for THIS
 *     link." Build the client over the returned {@link LiveSignalHandle.link}.
 *
 * The probe gate reads the SAME `status` `live` reads (not a second, independent
 * `ws.readyState`), so a socket can't be "open enough to set live, too closed to
 * probe" — the gate and the signal can never disagree.
 *
 * So the half-open-blind transport leg (`() => true`, or an open/close-only
 * `() => socketStatus() === "live"`) is not merely refused by the guard — it
 * literally cannot be SPELLED: there is no reachable function that turns such an
 * accessor into a `LiveSignal` (#1564, one seam up from the dot). `surfaceClient`/
 * `surfaceClients` accept a `{ live }` over a half-openable websocket ONLY when it
 * is a `LiveSignal` (see `requireTransportLive`).
 *
 * It lives in `@kolu/surface` (not `@kolu/surface-app`) precisely so the brand
 * symbol and its sole minter share one module — co-location is what makes the
 * stamp un-namable from anywhere else. `@kolu/surface-app`'s `connectSurface` /
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

/** The brand membership set. Module-private and **un-reflectable**: a `WeakSet`
 *  exposes no enumeration, so — unlike a symbol property — a consumer holding a
 *  genuine `LiveSignal` cannot read the brand off it (`Object.getOwnPropertySymbols`
 *  finds nothing) and stamp a fresh blind accessor with it. The only way into this
 *  set is {@link brandLiveSignal}, which is never exported. */
const BRANDED_LIVE = new WeakSet<object>();

/** The phantom compile-time brand. `declare const … : unique symbol` is erased at
 *  runtime (the property never exists), so it ONLY tightens the type — the runtime
 *  truth is {@link BRANDED_LIVE} membership, which nothing outside this file can add to. */
declare const LIVE_SIGNAL_BRAND: unique symbol;

/** A transport-liveness accessor `createLiveSignal` minted AFTER wiring the
 *  half-open watchdog — the only `{ live }` `surfaceClient`/`surfaceClients` accept
 *  over a half-openable websocket link. Structurally an `Accessor<boolean>`; its
 *  brand is membership in the module-private {@link BRANDED_LIVE} WeakSet (the
 *  phantom property is a compile-time tag only). */
export type LiveSignal = Accessor<boolean> & {
  readonly [LIVE_SIGNAL_BRAND]: true;
};

/** Stamp a liveness accessor as a {@link LiveSignal}. PRIVATE — never exported;
 *  the sole caller is {@link createLiveSignal} below, which stamps only after
 *  wiring the watchdog the brand asserts. The stamp adds `live` to the un-reflectable
 *  {@link BRANDED_LIVE} WeakSet, so even a consumer holding a real `LiveSignal`
 *  cannot copy the brand onto a watchdog-blind accessor (the round-7 symbol brand
 *  was reflection-forgeable; this is not). */
function brandLiveSignal(live: Accessor<boolean>): LiveSignal {
  BRANDED_LIVE.add(live);
  return live as unknown as LiveSignal;
}

/** True if `live` carries the {@link LiveSignal} brand — i.e. `createLiveSignal`
 *  minted it after wiring the half-open watchdog. `requireTransportLive` consults
 *  this to refuse a bare/open-close-only signal over a half-openable link (a
 *  missing OR unbranded `{ live }` both fail). Read-only: checking membership can
 *  never add to the WeakSet. */
export function isLiveSignal(live: unknown): live is LiveSignal {
  return typeof live === "function" && BRANDED_LIVE.has(live as object);
}

/** The oRPC link each {@link LiveSignal} was minted to guard, keyed by the live
 *  accessor's identity. `createLiveSignal` builds the link AND wires the watchdog
 *  over ONE socket, then records the pair here — the ONLY writer. It is read by
 *  {@link liveSignalGuardsLink} so `requireTransportLive` can prove the `{ live }`
 *  and the `link` the client is built over watch the **same** socket. Module-private
 *  and GC-safe (a `WeakMap` keyed on the opaque accessor, never mutating it). */
const LIVE_SIGNAL_LINK = new WeakMap<object, object>();

/** True if `live` is a {@link LiveSignal} minted to guard **this exact `link`**
 *  (object identity) — strictly stronger than {@link isLiveSignal}. Membership in
 *  {@link LIVE_SIGNAL_LINK} implies the brand (the sole writer brands in the same
 *  breath), and additionally pins *which* link the watchdog probes. This closes the
 *  contrived "brand minted over `createLiveSignal(healthyWs1)` but client built over
 *  a self-rolled `websocketLink(deadWs2)`" forge: a branded signal now certifies a
 *  watchdog AND the link that watchdog reconnects, so it cannot vouch for a different
 *  socket's link. Read-only: a lookup never writes the map. */
export function liveSignalGuardsLink(live: unknown, link: unknown): boolean {
  if (
    typeof live !== "function" ||
    (typeof link !== "object" && typeof link !== "function") ||
    link === null
  ) {
    return false;
  }
  return LIVE_SIGNAL_LINK.get(live as object) === (link as object);
}

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

/** The branded live signal plus the handles a connect seam threads on. Generic over
 *  the link's contract `C` so {@link LiveSignalHandle.link} is typed for the caller's
 *  client (no cast); defaults to `AnyContractRouter` when omitted (the multi-surface
 *  combined-link case, where the full type is too complex to represent — TS2590). */
export interface LiveSignalHandle<
  C extends AnyContractRouter = AnyContractRouter,
> {
  /** The watchdog-backed, BRANDED transport-liveness accessor — pass straight to
   *  `surfaceClient`/`surfaceClients`'s `{ live }`. `true` only while the socket is
   *  `live`; a `down`/`reconnecting` transport (including after the watchdog forces
   *  a reconnect on a half-open socket) flips it `false`. */
  live: LiveSignal;
  /** The richer transport status the brand is derived from — render it for a
   *  per-connection indicator so the watchdog's recovery is VISIBLE, not silent. */
  status: Accessor<SurfaceConnectionStatus>;
  /** The oRPC link `createLiveSignal` built over the owned socket. Build the client
   *  over THIS link (`surfaceClient(surface, transport.link, { live })` /
   *  `surfaceClients(transport.link, …)`) so the client and the watchdog's probe
   *  share ONE link over the ONE socket — and so there is no separate, fabricatable
   *  probe target. Typed `ContractRouterClient<C, …>` when `createLiveSignal<C>` was
   *  called with the contract (single-surface seams, kolu's combined link), else the
   *  loose default. It is half-open-marked, so `surfaceClient` accepts it only with
   *  the branded `live` returned here. */
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
  // `() => status() === "live"` must never be a `LiveSignal` on its own.
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
  const heartbeat = createHeartbeat({
    // Gate the probe on the SAME source `live` reads (`status`), not a second,
    // independent `ws.readyState === ws.OPEN`. The two readings of the socket's
    // openness could disagree — a socket whose `open` fired while `readyState`
    // never reached `OPEN` would freeze the gate shut forever, so the probe never
    // runs and `live` stays `true` over a dead socket. Reading one source means the
    // gate and the signal can never diverge: if `live` says `live`, the probe runs.
    isLive: () => status() === "live",
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
  // Mint the brand ONLY now — after the watchdog above is wired over the owned link.
  // Because this is the one place that builds the link, wires the watchdog, AND
  // mints, a `LiveSignal` existing IS proof a watchdog probes the socket it guards.
  const live = brandLiveSignal(() => status() === "live");
  // Record WHICH link this brand guards, by identity. `requireTransportLive` reads
  // it (via `liveSignalGuardsLink`) so a caller can't pass this brand alongside a
  // SELF-ROLLED `websocketLink(otherWs)`: the brand vouches only for the link built
  // here, over the socket the watchdog actually probes and reconnects. Build the
  // client over the returned `link` and the pairing holds by construction.
  LIVE_SIGNAL_LINK.set(live, link as object);
  return { live, status, link, dispose: () => heartbeat.dispose() };
}
