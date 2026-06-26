/**
 * @kolu/surface-app/connect — the client transport assembly for a surface app's
 * stale-tab handshake.
 *
 * Both kolu and drishti hand-rolled the SAME two pieces on top of partysocket:
 *
 *   1. the `pid`-echo mutable + URL-param threading (`lastServerProcessId` +
 *      `rememberServerProcessId` + appending `?pid=` on every reconnect), and
 *   2. the `new PartySocket(urlThunk, …)` construction with that echo'd URL plus
 *      — for a socket NO lifecycle watches — the stale-close → `retireSocket`
 *      listener.
 *
 * This module owns both, so a consumer brings only its URL, its reconnect
 * options, and whether the socket self-retires. The lifecycle + clients assembly
 * stays with the consumer ON PURPOSE: kolu derives its lifecycle in `rpc.ts`,
 * drishti via `<SurfaceAppProvider>`, and drishti runs MANY sockets (per-host +
 * one admin) sharing ONE echo — so a single god-factory bundling socket + clients
 * + lifecycle would fit neither. The shared duplication is the echo and the
 * socket; that is what graduates here.
 *
 * Framework-free (no SolidJS): pure transport, like its sibling `./lifecycle`.
 * This is where @kolu/surface-app's commitment to partysocket becomes explicit —
 * the one `new PartySocket(...)` in the package (see the surface-connection note).
 */

import {
  createHeartbeat as createHeartbeatPrimitive,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  type HeartbeatTuning,
} from "@kolu/surface/heartbeat";
import { WebSocket as PartySocket } from "partysocket";
import { SERVER_PROCESS_ID_PARAM, STALE_PROCESS_CLOSE_CODE } from "./index";
import { retireSocket } from "./lifecycle";

// The watchdog timing constants live with the lifted primitive in `@kolu/surface`
// (the cadence is a property of the watchdog, not of either leg); re-exported here
// so existing importers from `./connect` (and the cross-leg timing test) keep one
// import path.
export { DEFAULT_HEARTBEAT_INTERVAL_MS, DEFAULT_HEARTBEAT_TIMEOUT_MS };

/** The `pid` handshake echo: the client's record of the last server `processId`
 *  it observed, threaded back as the `pid` query param on every (re)connect so a
 *  RESTARTED server can recognize and reject a stale tab at the handshake. One
 *  echo per app — kolu has a single socket so it owns one implicitly; drishti
 *  shares ONE echo across its per-host + admin sockets, all fed by the admin
 *  socket's lifecycle. */
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
 *  must echo one server's identity (drishti's per-host + admin sockets); omit it
 *  and `createSurfaceSocket` builds a private one (kolu's single socket). */
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

/** The structural socket `retireOnStaleClose` drives — a partysocket, reduced to
 *  the verbs it touches (observe `close`, then `retireSocket`'s `{ close, send }`). */
type RetireableSocket = {
  addEventListener: (
    type: "close",
    listener: (event: { code?: number }) => void,
  ) => void;
} & Parameters<typeof retireSocket>[0];

/** Retire a socket the server closed as stale — for a socket NO lifecycle watches
 *  (drishti's per-host sockets, which have no provider/`createServerLifecycle`).
 *  On a close whose code is `restartCloseCode`, run `retireSocket(ws)` so neither
 *  partysocket's offline buffer nor oRPC's pending peers grow unbounded; other
 *  close codes are ordinary transient drops partysocket reconnects through. A
 *  socket OWNED by `createServerLifecycle` / `<SurfaceAppProvider>` leaves this
 *  off and lets the lifecycle's `onStaleRestart` do the retiring (one decode
 *  site, no double-retire). Exported for direct testing; `createSurfaceSocket`
 *  wires it when `retireOnStaleClose` is set. */
export function retireOnStaleClose(
  ws: RetireableSocket,
  restartCloseCode: number,
): void {
  ws.addEventListener("close", (event) => {
    if (event.code === restartCloseCode) retireSocket(ws);
  });
}

/** Options for `createSurfaceSocket`. */
export interface SurfaceSocketOptions {
  /** Base WS URL — a string (kolu's fixed `/rpc/ws`), or a thunk re-evaluated on
   *  every reconnect when the base itself varies (drishti's per-host `?host=`).
   *  The `pid` echo is appended on top, so don't add it here. */
  url: string | (() => string);
  /** The shared `pid` echo. Omit to build a private one (returned as `.echo`);
   *  pass a shared instance when several sockets echo one server (drishti). */
  echo?: ProcessIdEcho;
  /** partysocket reconnect options (e.g. a longer `connectionTimeout` for a
   *  cold-starting server — drishti's 60s agent-provision window). */
  socketOptions?: ConstructorParameters<typeof PartySocket>[2];
  /** Self-retire on the server's stale-close (a socket with no lifecycle/provider
   *  watching it). See `retireOnStaleClose`. */
  retireOnStaleClose?: boolean;
  /** The stale-close code to match when `retireOnStaleClose` is set. Defaults to
   *  `STALE_PROCESS_CLOSE_CODE` (the code surface-app's server gate closes with). */
  restartCloseCode?: number;
}

/** A constructed surface socket and the echo feeding its `pid` param. */
export interface SurfaceSocket {
  /** The reconnecting partysocket. Build the oRPC link over it
   *  (`websocketLink(ws as unknown as WebSocket)`) and, if it carries the
   *  lifecycle, hand it to `createServerLifecycle` / `<SurfaceAppProvider>`. */
  ws: PartySocket;
  /** The echo this socket reads. When the caller passed one in, this is that same
   *  instance; otherwise it's the private one created here — wire its `remember`
   *  to the lifecycle's `onProcessId`. */
  echo: ProcessIdEcho;
}

/** Construct a surface app's reconnecting WebSocket with the `pid` handshake
 *  wired in: the URL thunk appends the echo'd `pid` on every reconnect, and (when
 *  `retireOnStaleClose` is set) a stale-close retires the socket. Owns the one
 *  `new PartySocket(...)` both consumers used to hand-roll; the link + clients +
 *  lifecycle stay with the caller. */
export function createSurfaceSocket(opts: SurfaceSocketOptions): SurfaceSocket {
  const echo = opts.echo ?? createProcessIdEcho();
  const resolveBase =
    typeof opts.url === "function" ? opts.url : () => opts.url as string;
  // The URL is a THUNK so partysocket re-reads the latest echo'd `pid` on every
  // reconnect — that's how a tab that was live across a restart re-presents the
  // (now stale) id and is re-rejected until a fresh page resets it.
  const ws = new PartySocket(
    () => echo.appendTo(resolveBase()),
    undefined,
    opts.socketOptions,
  );
  if (opts.retireOnStaleClose) {
    retireOnStaleClose(ws, opts.restartCloseCode ?? STALE_PROCESS_CLOSE_CODE);
  }
  return { ws, echo };
}

/** The structural socket `createHeartbeat` drives — a partysocket reduced to the
 *  two verbs the watchdog touches: read `readyState`/`OPEN` (only probe a live
 *  socket) and `reconnect()` (abandon a half-open one and connect fresh). */
export type HeartbeatSocket = {
  readyState: number;
  readonly OPEN: number;
  reconnect: () => void;
};

/** Options for `createHeartbeat` — the partysocket-shaped face of the lifted
 *  `@kolu/surface/heartbeat` primitive. This leg supplies the socket; the
 *  primitive owns the race/settle/skip-overlap/dispose algorithm. */
export interface HeartbeatOptions {
  /** The socket to watch — the `createSurfaceSocket` partysocket. */
  ws: HeartbeatSocket;
  /** A cheap server round-trip whose RESOLUTION is the liveness signal (its value
   *  is ignored) — the framework-reserved `system.live` verb. A REJECTION still
   *  counts as alive: the round-trip completed (the server answered, even with an
   *  error) and a genuine transport drop surfaces as a `close` partysocket already
   *  reconnects through — so only a TIMEOUT (no answer at all) means half-open. A
   *  SYNCHRONOUS throw is treated DIFFERENTLY: it means no round-trip happened
   *  (the probe is miswired), so it's reported via `onProbeError` rather than
   *  silently counted as liveness, and does NOT force a reconnect. */
  probe: () => Promise<unknown>;
  /** How often to probe while the socket is OPEN. Default 15s. */
  intervalMs?: number;
  /** How long to wait for a probe before declaring the socket half-open and
   *  forcing a reconnect. Default 10s. */
  timeoutMs?: number;
  /** Report a forced reconnect (a missed probe). Defaults to a `console.warn` so
   *  a silent half-open recovery is never invisible; pass your own logger. */
  onStale?: () => void;
  /** Report a probe that threw SYNCHRONOUSLY (a miswired/broken probe, distinct
   *  from an async rejection). Defaults to a `console.warn` so the heartbeat
   *  going inert is never silent; pass your own logger. */
  onProbeError?: (error: unknown) => void;
}

const warnStale = () =>
  console.warn(
    "surface-app: heartbeat probe timed out — forcing reconnect (half-open socket)",
  );

const warnProbeThrew = (error: unknown) =>
  console.warn(
    "surface-app: heartbeat probe threw synchronously — no round-trip was made; " +
      "the probe is likely miswired (heartbeat is inert until fixed)",
    error,
  );

/** A heartbeat watchdog for a reconnecting WebSocket — the partysocket-shaped
 *  WRAPPER over the lifted `@kolu/surface/heartbeat` primitive. It turns a
 *  SILENTLY half-open socket — the TCP died with no FIN/RST (laptop sleep, Wi-Fi
 *  roam, NAT/proxy idle eviction) — into a real `close` + reconnect, so the
 *  transport's EXISTING recovery (partysocket auto-reconnect + oRPC stream
 *  re-subscribe via the retry plugin) takes over. partysocket ships NO
 *  ping/keepalive, and a half-open socket fires neither `error` nor `close`, so
 *  without this the socket sits `OPEN` forever: every stream iterator hangs and
 *  the UI freezes until a manual reload. This is the "no-op procedure on an
 *  interval" heartbeat `@kolu/surface`'s peer-server note anticipates.
 *
 *  The race/settle/skip-overlap/late-fire-safe-dispose algorithm is the lifted
 *  primitive's; this wrapper only maps the partysocket's two variation points
 *  onto it: the live GATE is `readyState === OPEN`, and the on-stale ACTION is
 *  `ws.reconnect()` (abandon the half-open socket and connect fresh — with code
 *  1000, NOT the stale-tab 4001, so the retire path is untouched). The public
 *  `onStale` here is a REPORTER (default `console.warn`), run after the reconnect.
 *
 *  Returns `dispose()` to stop the interval AND any in-flight probe timeout —
 *  wire it to the consumer's teardown (kolu's `onCleanup`). */
export function createHeartbeat(opts: HeartbeatOptions): {
  dispose: () => void;
} {
  return createHeartbeatPrimitive({
    probe: opts.probe,
    intervalMs: opts.intervalMs,
    timeoutMs: opts.timeoutMs,
    // The two partysocket variation points: the live gate and the recovery action.
    isLive: () => opts.ws.readyState === opts.ws.OPEN,
    onStale: () => opts.ws.reconnect(),
    // surface-app's public `onStale` is a REPORTER (not the action), defaulting to
    // a warn so a silent half-open recovery is never invisible.
    onStaleReport: opts.onStale ?? warnStale,
    onProbeError: opts.onProbeError ?? warnProbeThrew,
  });
}

/** The "tune-or-disable the watchdog" knob for `createServerLifecycle` ONLY.
 *  `false` disables the lifecycle's own watchdog — legitimate, because the
 *  lifecycle mints NO brand (it derives connecting/restarted/… for the UI), so a
 *  disabled lifecycle watchdog is watchdog-OWNERSHIP coordination (the socket is
 *  watched by a `createLiveSignal` elsewhere — kolu's `wire.ts`, or the
 *  `connectSurfaces` that built the same admin socket's clients), NOT a path to a
 *  branded-but-blind signal. The brand-minting seams (`connectSurface` /
 *  `connectSurfaces` / `createLiveSignal`) take {@link HeartbeatTuning} instead —
 *  no `false` — so a brand can never be minted without a watchdog. The liveness
 *  `probe` is NOT tunable here: each seam supplies the framework-reserved
 *  `system.live` round-trip as the one liveness verb. */
export type HeartbeatConfig = false | HeartbeatTuning;

/** Normalize a {@link HeartbeatConfig} + the seam's `{ ws, probe }` base into the
 *  {@link HeartbeatOptions} `createHeartbeat` takes — `undefined` when the config
 *  is `false` (watchdog disabled). The base `probe` is the seam's liveness verb
 *  (each seam passes the framework-reserved `system.live` round-trip). This
 *  replaces the per-field `typeof cfg === "object" ? cfg.x : undefined` ternaries
 *  each seam used to hand-roll — one spread, one place. */
export function normalizeHeartbeat(
  config: HeartbeatConfig | undefined,
  base: { ws: HeartbeatSocket; probe: () => Promise<unknown> },
): HeartbeatOptions | undefined {
  if (config === false) return undefined;
  const tuned = typeof config === "object" ? config : {};
  return {
    ws: base.ws,
    probe: base.probe,
    intervalMs: tuned.intervalMs,
    timeoutMs: tuned.timeoutMs,
    onStale: tuned.onStale,
  };
}
