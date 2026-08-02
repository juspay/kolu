/**
 * @kolu/surface-app/connect — the client transport assembly for a surface app's
 * stale-tab handshake.
 *
 * Both kolu and drishti hand-rolled the SAME two pieces:
 *
 *   1. the `pid`-echo mutable + URL-param threading (`lastServerProcessId` +
 *      `rememberServerProcessId` + appending `?pid=` on every reconnect), and
 *   2. the dial itself, with that echo'd URL and the stale-close handling.
 *
 * This module owns both, so a consumer brings only its URL and its close-code
 * vocabulary. The lifecycle + clients assembly stays with the consumer ON
 * PURPOSE: kolu derives its lifecycle in `rpc.ts`, drishti via
 * `<SurfaceAppProvider>`, and drishti runs MANY wires (per-host + one admin)
 * sharing ONE echo — so a single god-factory bundling wire + clients + lifecycle
 * would fit neither. The shared duplication is the echo and the dial; that is
 * what graduates here.
 *
 * Framework-free (no SolidJS): pure transport, like its sibling `./lifecycle`.
 *
 * **partysocket is gone** (PLAN D5). The reconnecting socket is now
 * `@kolu/surface`'s `websocketLink`, which owns the dial, the retry schedule,
 * the URL thunk re-evaluated on every re-dial (review #6c — the pid echo), and
 * the TERMINAL-close classifier (review #5). surface-app's only remaining job on
 * that leg is to supply the app's close-code vocabulary — `STALE_PROCESS_CLOSE_CODE`
 * is surface-app's constant, and `@kolu/surface` may not import it (the
 * dependency arrow points the other way), so it travels as the link's
 * `isTerminalClose` option. The old `retireSocket` send-poisoning and the
 * `retireOnStaleClose` listener are DELETED with it: a retired wire stops
 * re-dialling and fails every in-flight and future call with
 * `SurfaceTransportRetired` by construction, and reports the terminal
 * `WireStatus` `"retired"`.
 */

import {
  createHeartbeat as createHeartbeatPrimitive,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  type HeartbeatTuning,
} from "@kolu/surface/heartbeat";
import type { WatchableWire } from "@kolu/surface/link";
import {
  websocketLink,
  type WebsocketLink,
} from "@kolu/surface/links/websocket";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { SERVER_PROCESS_ID_PARAM, STALE_PROCESS_CLOSE_CODE } from "./index";

// The watchdog timing constants live with the lifted primitive in `@kolu/surface`
// (the cadence is a property of the watchdog, not of either leg); re-exported here
// so existing importers from `./connect` (and the cross-leg timing test) keep one
// import path.
export { DEFAULT_HEARTBEAT_INTERVAL_MS, DEFAULT_HEARTBEAT_TIMEOUT_MS };

/** The `pid` handshake echo: the client's record of the last server `processId`
 *  it snapshot, threaded back as the `pid` query param on every (re)connect so a
 *  RESTARTED server can recognize and reject a stale tab at the handshake. One
 *  echo per app — kolu has a single wire so it owns one implicitly; drishti
 *  shares ONE echo across its per-host + admin wires, all fed by the admin
 *  wire's lifecycle. */
export interface ProcessIdEcho {
  /** Record the latest observed server `processId`. Wire this to
   *  `createServerLifecycle`'s `onProcessId` (or `<SurfaceAppProvider onProcessId>`)
   *  so each probe result updates the echo. Closure-based (no `this`), so the
   *  bound method is safe to detach and pass as a callback. */
  remember: (processId: string) => void;
  /** Append `?pid=<last>` (or `&pid=`) to a URL — respecting an existing query
   *  string (drishti's `?host=`). A no-op until the first id is observed, so the
   *  first-ever connect omits the param. */
  appendTo: (url: string) => string;
}

/** A fresh `pid` echo. Pass the SAME instance to every `createSurfaceSocket` that
 *  must echo one server's identity (drishti's per-host + admin wires); omit it
 *  and `createSurfaceSocket` builds a private one (kolu's single wire). */
export function createProcessIdEcho(): ProcessIdEcho {
  let last: string | null = null;
  return {
    remember: (processId) => {
      last = processId;
    },
    appendTo: (url) => {
      if (last === null) return url;
      const sep = url.includes("?") ? "&" : "?";
      return `${url}${sep}${SERVER_PROCESS_ID_PARAM}=${encodeURIComponent(last)}`;
    },
  };
}

/** Options for `createSurfaceSocket`. */
export interface SurfaceSocketOptions {
  /** The served surface's flat `RpcGroup` — `surface.group` for a single
   *  surface, `composeSurfaceContracts(...).group` for a sibling bundle. The
   *  link needs it to build its typed client; it is the ONE piece of the
   *  contract the transport sees. */
  group: RpcGroup.RpcGroup<Rpc.Any>;
  /** Base WS URL — a string (kolu's fixed `/rpc/ws`), or a thunk re-evaluated on
   *  every reconnect when the base itself varies (drishti's per-host `?host=`).
   *  The `pid` echo is appended on top, so don't add it here. */
  url: string | (() => string);
  /** The shared `pid` echo. Omit to build a private one (returned as `.echo`);
   *  pass a shared instance when several wires echo one server (drishti). */
  echo?: ProcessIdEcho;
  /** The platform's WebSocket constructor. Omitted in a browser (the link uses
   *  `globalThis.WebSocket`); supplied by a Node host or a test that has none. */
  connect?: (url: string) => WebSocket;
}

/** A constructed surface wire and the echo feeding its `pid` param. */
export interface SurfaceSocket {
  /** The reconnecting wire: the branded `dispatch` a surface client is built
   *  over, the `WatchableWire` a watchdog observes, and `dispose`. Hand the
   *  WHOLE value to `createLiveSignal` — it is the `{ dispatch, wire }` pairing
   *  (`WireTransport`) minted together, which is what makes "the watchdog probes
   *  the transport it reconnects" hold by construction. */
  link: WebsocketLink;
  /** The echo this wire reads. When the caller passed one in, this is that same
   *  instance; otherwise it's the private one created here — wire its `remember`
   *  to the lifecycle's `onProcessId`. */
  echo: ProcessIdEcho;
}

/** Is this close code the server RETIRING a stale tab? The one place surface-app's
 *  close-code vocabulary meets `@kolu/surface`'s transport: the link stops its
 *  retry schedule on a `true` verdict and fails every in-flight and future call
 *  with `SurfaceTransportRetired`, so a tab bound to a dead process settles
 *  instead of re-presenting the same stale `pid` in a reconnect storm. Every
 *  other code is an ordinary transient drop the link re-dials through. */
export function isStaleProcessClose(code: number): boolean {
  return code === STALE_PROCESS_CLOSE_CODE;
}

/** Dial a surface app's reconnecting wire with the `pid` handshake wired in: the
 *  URL thunk appends the echo'd `pid` on EVERY re-dial (so a tab that was live
 *  across a restart re-presents the now-stale id and is re-rejected until a fresh
 *  page resets it), and the server's stale-close retires the wire for good.
 *
 *  Async because building the protocol and its fibers is an effect — the whole
 *  link family is Promise-shaped at this edge. The clients + lifecycle stay with
 *  the caller. */
export async function createSurfaceSocket(
  opts: SurfaceSocketOptions,
): Promise<SurfaceSocket> {
  const echo = opts.echo ?? createProcessIdEcho();
  const resolveBase =
    typeof opts.url === "function" ? opts.url : () => opts.url as string;
  const link = await websocketLink({
    group: opts.group,
    // The URL is a THUNK the link re-evaluates on every (re)dial, so the latest
    // echo'd `pid` rides each reconnect (review #6c).
    url: () => echo.appendTo(resolveBase()),
    isTerminalClose: isStaleProcessClose,
    connect: opts.connect,
  });
  return { link, echo };
}

/** Options for `createHeartbeat` — the wire-shaped face of the lifted
 *  `@kolu/surface/heartbeat` primitive. This leg supplies the wire; the
 *  primitive owns the race/settle/skip-overlap/dispose algorithm. */
export interface HeartbeatOptions {
  /** The wire to watch — `createSurfaceSocket(...).link.wire`. The watchdog
   *  reads its `status()` for the live gate and calls its `forceReconnect()` to
   *  recover a silently half-open wire. */
  wire: WatchableWire;
  /** A cheap server round-trip whose RESOLUTION is the liveness signal (its value
   *  is ignored) — the framework-reserved `system.live` verb. A REJECTION still
   *  counts as alive: the round-trip completed (the server answered, even with an
   *  error) and a genuine transport drop surfaces as a close the link already
   *  reconnects through — so only a TIMEOUT (no answer at all) means half-open. A
   *  SYNCHRONOUS throw is treated DIFFERENTLY: it means no round-trip happened
   *  (the probe is miswired), so it's reported via `onProbeError` rather than
   *  silently counted as liveness, and does NOT force a reconnect. */
  probe: () => Promise<unknown>;
  /** How often to probe while the wire is OPEN. Default 15s. */
  intervalMs?: number;
  /** How long to wait for a probe before declaring the wire half-open and
   *  forcing a reconnect. Default 10s. */
  timeoutMs?: number;
  /** Report a forced reconnect (a missed probe). Defaults to a `console.warn` so
   *  a silent half-open recovery is never invisible; pass your own logger. */
  onStale?: () => void;
  /** Report a probe that threw SYNCHRONOUSLY (a miswired/broken probe, distinct
   *  from an async rejection). Defaults to a `console.error` so the heartbeat
   *  going inert is never silent; pass your own logger. */
  onProbeError?: (error: unknown) => void;
}

const warnStale = () =>
  console.warn(
    "surface-app: heartbeat probe timed out — forcing reconnect (half-open wire)",
  );

// `error` level, not `warn` (matching `@kolu/surface`'s `liveSignal` reporter): a
// synchronous throw is an unexpected exception that leaves the watchdog permanently
// INERT — a hard fault, not the degraded-but-recoverable blip a timed-out probe is
// (`warnStale`, which recovers by reconnecting). Operators filtering on `error`
// must see a heartbeat that has gone silent.
const warnProbeThrew = (error: unknown) =>
  console.error(
    "surface-app: heartbeat probe threw synchronously — no round-trip was made; " +
      "the probe is likely miswired (heartbeat is inert until fixed)",
    error,
  );

/** A heartbeat watchdog for a reconnecting wire — the wire-shaped WRAPPER over
 *  the lifted `@kolu/surface/heartbeat` primitive. It turns a SILENTLY half-open
 *  socket — the TCP died with no FIN/RST (laptop sleep, Wi-Fi roam, NAT/proxy
 *  idle eviction) — into a real close + re-dial, so the transport's EXISTING
 *  recovery (the link's retry schedule + the face's per-subscription re-subscribe
 *  fence) takes over. A half-open socket fires neither `error` nor `close`, so
 *  without this the wire sits `open` forever: every stream hangs and the UI
 *  freezes until a manual reload.
 *
 *  The race/settle/skip-overlap/late-fire-safe-dispose algorithm is the lifted
 *  primitive's; this wrapper only maps the wire's two variation points onto it:
 *  the live GATE is `wire.status() === "open"`, and the on-stale ACTION is
 *  `wire.forceReconnect()` (sever the half-open socket so the link's schedule
 *  dials fresh — with close code 1000, NOT the stale-tab 4001, so the terminal
 *  classifier stays untriggered). The public `onStale` here is a REPORTER
 *  (default `console.warn`), run after the reconnect.
 *
 *  Returns `dispose()` to stop the interval AND any in-flight probe timeout (wire
 *  it to the consumer's teardown — kolu's `onCleanup`), plus `wake()` — the
 *  browser leg's fast resume re-probe (wire it to `onWake`). */
export function createHeartbeat(opts: HeartbeatOptions): {
  dispose: () => void;
  wake: () => void;
} {
  return createHeartbeatPrimitive({
    probe: opts.probe,
    intervalMs: opts.intervalMs,
    timeoutMs: opts.timeoutMs,
    // The two wire variation points: the live gate and the recovery action.
    isLive: () => opts.wire.status() === "open",
    onStale: () => opts.wire.forceReconnect(),
    // surface-app's public `onStale` is a REPORTER (not the action), defaulting to
    // a warn so a silent half-open recovery is never invisible.
    onStaleReport: opts.onStale ?? warnStale,
    onProbeError: opts.onProbeError ?? warnProbeThrew,
  });
}

/** The "tune-or-disable the watchdog" knob for `createServerLifecycle` ONLY.
 *  `false` disables the lifecycle's own watchdog — legitimate, because the
 *  lifecycle mints NO brand (it derives connecting/restarted/… for the UI), so a
 *  disabled lifecycle watchdog is watchdog-OWNERSHIP coordination (the wire is
 *  watched by a `createLiveSignal` elsewhere — kolu's `wire.ts`, or the
 *  `connectSurfaces` that built the same admin wire's clients), NOT a path to a
 *  branded-but-blind signal. The brand-minting seams (`connectSurface` /
 *  `connectSurfaces` / `createLiveSignal`) take {@link HeartbeatTuning} instead —
 *  no `false` — so a brand can never be minted without a watchdog. The liveness
 *  `probe` is NOT tunable here: each seam supplies the framework-reserved
 *  `system.live` round-trip as the one liveness verb. */
export type HeartbeatConfig = false | HeartbeatTuning;

/** Normalize a {@link HeartbeatConfig} + the seam's `{ wire, probe }` base into
 *  the {@link HeartbeatOptions} `createHeartbeat` takes — `undefined` when the
 *  config is `false` (watchdog disabled). The base `probe` is the seam's liveness
 *  verb (each seam passes the framework-reserved `system.live` round-trip). This
 *  replaces the per-field `typeof cfg === "object" ? cfg.x : undefined` ternaries
 *  each seam used to hand-roll — one spread, one place. */
export function normalizeHeartbeat(
  config: HeartbeatConfig | undefined,
  base: { wire: WatchableWire; probe: () => Promise<unknown> },
): HeartbeatOptions | undefined {
  if (config === false) return undefined;
  const tuned = typeof config === "object" ? config : {};
  return {
    wire: base.wire,
    probe: base.probe,
    intervalMs: tuned.intervalMs,
    timeoutMs: tuned.timeoutMs,
    onStale: tuned.onStale,
  };
}
