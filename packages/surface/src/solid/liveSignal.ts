/**
 * `createLiveSignal` — derive a transport-liveness `LiveSignal` for a reconnecting
 * socket AND wire the half-open watchdog that makes it honest, in ONE call. This
 * is the ONLY way to obtain a `LiveSignal`, and it is **unforgeable**:
 *
 *   - The brand is a module-private `Symbol` ({@link LIVE_SIGNAL_BRAND}) — nothing
 *     outside this file can name it.
 *   - The function that stamps it ({@link brandLiveSignal}) is **never exported** —
 *     it is private to this module, called only by `createLiveSignal` below, AFTER
 *     the watchdog is wired.
 *   - There is no `heartbeat: false` opt-out: `createLiveSignal` ALWAYS wires the
 *     watchdog, so a `LiveSignal` existing is proof a watchdog backs it — not a
 *     marker the guard merely trusts.
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

export type { HeartbeatTuning };

/** The unforgeable brand. Module-private — nothing outside this file can name it,
 *  so the only way to stamp a `LiveSignal` is {@link brandLiveSignal}, which is
 *  itself never exported. */
const LIVE_SIGNAL_BRAND = Symbol("kolu.surface.liveSignal");

/** A transport-liveness accessor `createLiveSignal` minted AFTER wiring the
 *  half-open watchdog — the only `{ live }` `surfaceClient`/`surfaceClients` accept
 *  over a half-openable websocket link. Structurally an `Accessor<boolean>` plus
 *  the unforgeable {@link LIVE_SIGNAL_BRAND}. */
export type LiveSignal = Accessor<boolean> & {
  readonly [LIVE_SIGNAL_BRAND]: true;
};

/** Stamp a liveness accessor as a {@link LiveSignal}. PRIVATE — never exported;
 *  the sole caller is {@link createLiveSignal} below, which stamps only after
 *  wiring the watchdog the brand asserts. Co-locating the stamp with the
 *  module-private symbol is what makes a `LiveSignal` un-forgeable: there is no
 *  reachable function anywhere that turns a watchdog-blind accessor into one. */
function brandLiveSignal(live: Accessor<boolean>): LiveSignal {
  return Object.assign(live, {
    [LIVE_SIGNAL_BRAND]: true as const,
  }) as LiveSignal;
}

/** True if `live` carries the {@link LiveSignal} brand — i.e. `createLiveSignal`
 *  minted it after wiring the half-open watchdog. `requireTransportLive` consults
 *  this to refuse a bare/open-close-only signal over a half-openable link (a
 *  missing OR unbranded `{ live }` both fail). Read-only: checking the brand can
 *  never mint one. */
export function isLiveSignal(live: unknown): live is LiveSignal {
  return (
    typeof live === "function" &&
    (live as unknown as Record<symbol, unknown>)[LIVE_SIGNAL_BRAND] === true
  );
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
  /** The liveness round-trip the watchdog probes on an interval — the
   *  framework-reserved `system.live` (`() => probeSurfaceLive(link)`). A TIMEOUT
   *  (no answer) means the socket is half-open and is force-reconnected; a
   *  rejection still counts as alive (the round-trip completed). */
  probe: () => Promise<unknown>;
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
    probe: opts.probe,
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
