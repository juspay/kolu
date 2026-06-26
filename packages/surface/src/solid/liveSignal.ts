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
 *   - The probe is **hardcoded** to a real `system.live` round-trip
 *     (`probeSurfaceLive` over the caller's link) — not a caller-supplied thunk a
 *     consumer could make trivially settle (`() => Promise.resolve()`) and so mint
 *     a brand whose watchdog ticks but never detects a dead link. The brand
 *     certifies the link is being PROBED, not merely that a timer runs.
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

import { type Accessor, createSignal } from "solid-js";
import { createHeartbeat, type HeartbeatTuning } from "../heartbeat";
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
  /** The link (or scoped per-sibling slice) whose framework-reserved `system.live`
   *  the watchdog probes — a THUNK, read at probe time so a multi-surface seam can
   *  return a sibling client built AFTER this call. The caller supplies only WHAT to
   *  probe (the real link); the HOW is hardcoded: the watchdog ALWAYS calls
   *  `probeSurfaceLive` over it, a real `system.live` round-trip whose TIMEOUT means
   *  half-open. There is deliberately no arbitrary `probe` thunk — a caller could
   *  make one trivially settle (`() => Promise.resolve()`) and so mint a brand whose
   *  watchdog ticks but never detects a dead link. By pinning the probe to a real
   *  round-trip, the brand certifies the link is being PROBED, not just that a timer
   *  runs. */
  link: () => unknown;
  /** A stale-close on a self-retiring socket reads `down` (terminally — reload to
   *  recover) instead of `reconnecting`. Off by default. */
  retireOnStaleClose?: boolean;
  /** The exact close code that marks a stale-restart when `retireOnStaleClose` is
   *  set — supplied by the caller (it is a `@kolu/surface-app` protocol constant,
   *  so it is NOT defaulted here; the connect seams pass it). */
  restartCloseCode?: number;
}

/** The branded live signal plus the handles a connect seam threads on. */
export interface LiveSignalHandle {
  /** The watchdog-backed, BRANDED transport-liveness accessor — pass straight to
   *  `surfaceClient`/`surfaceClients`'s `{ live }`. `true` only while the socket is
   *  `live`; a `down`/`reconnecting` transport (including after the watchdog forces
   *  a reconnect on a half-open socket) flips it `false`. */
  live: LiveSignal;
  /** The richer transport status the brand is derived from — render it for a
   *  per-connection indicator so the watchdog's recovery is VISIBLE, not silent. */
  status: Accessor<SurfaceConnectionStatus>;
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

export function createLiveSignal(
  ws: WatchableSocket,
  opts: CreateLiveSignalOptions,
): LiveSignalHandle {
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
  // The half-open watchdog — ALWAYS wired (there is no disable knob). It probes
  // `system.live` on an interval while the socket is OPEN and forces
  // `ws.reconnect()` on a TIMEOUT, which flips `status` off `"live"`. The two
  // partysocket variation points (the live GATE and the recovery ACTION) are the
  // only socket-specific bits; the race/settle/skip-overlap/dispose algorithm is
  // the framework-free `@kolu/surface/heartbeat` primitive.
  const heartbeat = createHeartbeat({
    isLive: () => ws.readyState === ws.OPEN,
    onStale: () => ws.reconnect(),
    // The probe is HARDCODED to a real `system.live` round-trip over the caller's
    // link — not a caller-supplied thunk that could trivially settle and blind the
    // watchdog. A synchronous throw here (a miswired/absent link) is reported via
    // `onProbeError`, never counted as liveness.
    probe: () => probeSurfaceLive(opts.link()),
    intervalMs: opts.intervalMs,
    timeoutMs: opts.timeoutMs,
    onStaleReport: opts.onStale ?? warnStale,
    onProbeError: warnProbeThrew,
  });
  // Mint the brand ONLY now — after the watchdog above is wired. Because this is
  // the one place that mints AND the one place that wires the watchdog, a
  // `LiveSignal` existing IS proof a watchdog backs it.
  const live = brandLiveSignal(() => status() === "live");
  return { live, status, dispose: () => heartbeat.dispose() };
}
