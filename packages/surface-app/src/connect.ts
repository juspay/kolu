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
 * **The echo is no longer a wiring job.** It used to be: the seam returned an
 * `echo` and the app was expected to feed it, by threading
 * `createServerLifecycle`'s `onProcessId` into `echo.remember`. An app that kept
 * only the client and dropped both (olai#61) shipped reconnects with no `pid`, so
 * `rejectStaleProcess(null, live)` never rejected, the server's stale-tab gate was
 * dead code, and the wire's `retired` state was unreachable — a tab bound to a
 * replaced server looked healthy forever. `createSurfaceSocket` now probes the
 * framework-reserved `system/identity` member itself on every open and feeds the
 * echo, and it REQUIRES a `retired` handler for the rejection that earns. Both
 * halves of the handshake live at the one seam that dials the wire; there is no
 * app-side step left to omit.
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
  SURFACE_TAG_PREFIX,
  siblingTagPrefix,
  surfaceTag,
} from "@kolu/surface/define";
import {
  createHeartbeat as createHeartbeatPrimitive,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  type HeartbeatTuning,
} from "@kolu/surface/heartbeat";
import {
  IDENTITY_NAMESPACE,
  IDENTITY_VERB,
  type ServedIdentity,
} from "@kolu/surface/identity";
import type { WatchableWire } from "@kolu/surface/link";
import {
  websocketLink,
  type WebsocketLink,
} from "@kolu/surface/links/websocket";
import { Effect } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { SERVER_PROCESS_ID_PARAM, STALE_PROCESS_CLOSE_CODE } from "./index";

// The watchdog timing constants live with the lifted primitive in `@kolu/surface`
// (the cadence is a property of the watchdog, not of either leg); re-exported here
// so existing importers from `./connect` (and the cross-leg timing test) keep one
// import path.
export { DEFAULT_HEARTBEAT_INTERVAL_MS, DEFAULT_HEARTBEAT_TIMEOUT_MS };

/** The `pid` handshake echo: the client's record of the last server `processId`
 *  it observed, threaded back as the `pid` query param on every (re)connect so a
 *  RESTARTED server can recognize and reject a stale tab at the handshake. One
 *  echo per app — kolu has a single wire so it owns one implicitly; drishti
 *  shares ONE echo across its per-host + admin wires.
 *
 *  **The framework feeds it.** `createSurfaceSocket` probes the framework-reserved
 *  `system/identity` member on every wire OPEN and calls `remember` itself, so the
 *  handshake works in every app with zero app code. It used to be an app's job to
 *  thread `createServerLifecycle`'s `onProcessId` into `remember` — and an app that
 *  didn't (olai#61) shipped a wire whose reconnects carried no `pid`, which made the
 *  server's gate dead code and the wire's `retired` state unreachable. There is no
 *  longer anything for an app to forget: `remember` is called by the same seam that
 *  appends `appendTo`'s result to the URL. */
export interface ProcessIdEcho {
  /** Record the latest observed server `processId`. Called by
   *  `createSurfaceSocket`'s own identity probe; an app does not call it.
   *  Closure-based (no `this`), so the bound method is safe to detach. */
  remember: (processId: string) => void;
  /** Append `?pid=<last>` (or `&pid=`) to a URL — respecting an existing query
   *  string (drishti's `?host=`). A no-op until the first id is observed, so the
   *  first-ever connect omits the param. */
  appendTo: (url: string) => string;
}

/** A fresh `pid` echo. Pass the SAME instance to every `createSurfaceSocket` that
 *  must echo one server's identity (drishti's per-host + admin wires); omit it
 *  and `createSurfaceSocket` builds a private one (kolu's single wire). Either
 *  way the framework, not the app, feeds it. */
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
  /** The shared `pid` echo. Omit to build a private one; pass a shared instance
   *  when several wires echo one server (drishti). Fed by this seam either way. */
  echo?: ProcessIdEcho;
  /** For a wire carrying SIBLING surfaces (`connectSurfaces`), the sibling key
   *  whose framework-reserved `system/identity` member the echo probe reads —
   *  every sibling answers it with the same per-process id, so any key works; pass
   *  the first. Omit for a single-surface wire, where the reserved member sits at
   *  the bare `surface/system/identity`. */
  siblingKey?: string;
  /** What to do when the SERVER retires this wire — the terminal state. REQUIRED,
   *  and that is the point: see {@link RetiredHandler}. */
  retired: RetiredHandler;
  /** The platform's WebSocket constructor. Omitted in a browser (the link uses
   *  `globalThis.WebSocket`); supplied by a Node host or a test that has none. */
  connect?: (url: string) => WebSocket;
}

/**
 * What an app does when the server RETIRES its wire: this tab is bound to a
 * process that no longer exists, the link has stopped dialling for good, and every
 * call on it fails with `SurfaceTransportRetired`. Nothing recovers it but a
 * reload.
 *
 * It is a REQUIRED option on every seam that dials a surface app's wire, and it has
 * no default. A default would be a silent policy — and silence is the whole defect:
 * an app can otherwise build a wire, keep only its client, and ship a tab that sits
 * on a dead server looking healthy forever (olai#61). Requiring the handler does not
 * make an app render anything (nothing at the type level can), but it does make the
 * terminal state impossible to be UNAWARE of: a wire that compiles has been asked
 * what happens when it dies, and answered.
 *
 * `retired: reloadForUpdate` (from `@kolu/surface-app/lifecycle`) is the one-liner
 * for an app content to land the deployed build immediately; an app that would
 * rather take the screen and let the reader choose passes its own handler
 * (`() => setRetired(true)`). Called at most once — `retired` is terminal.
 */
export type RetiredHandler = () => void;

/** A constructed surface wire and the echo feeding its `pid` param. */
export interface SurfaceSocket {
  /** The reconnecting wire: the branded `dispatch` a surface client is built
   *  over, the `WatchableWire` a watchdog observes, and `dispose`. Hand the
   *  WHOLE value to `createLiveSignal` — it is the `{ dispatch, wire }` pairing
   *  (`WireTransport`) minted together, which is what makes "the watchdog probes
   *  the transport it reconnects" hold by construction. */
  link: WebsocketLink;
  /** Stop the identity/retired observers and release the link's scope. Use this
   *  rather than `link.dispose()`: the observers this seam installed outlive the
   *  link otherwise, and a remounted wire (drishti's per-host clients, a test
   *  re-dialling) would accumulate them. */
  dispose: () => Promise<void>;
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

// The reserved identity member's TAG, minted through the SAME tag algebra
// `defineSurface` mints it with — so the echo probe can never address a member the
// surface does not carry, and a sibling-scoped probe is a tag prefix rather than a
// walk through a nested client. (The twin of `createLiveSignal`'s `system/live`
// tag; same shape, different question.)
function identityTagFor(siblingKey: string | undefined): string {
  return surfaceTag(
    siblingKey === undefined
      ? SURFACE_TAG_PREFIX
      : siblingTagPrefix(siblingKey),
    IDENTITY_NAMESPACE,
    IDENTITY_VERB,
  );
}

/** Dial a surface app's reconnecting wire with the WHOLE stale-tab handshake wired
 *  in — both halves, neither of them an app's job:
 *
 *   1. **The echo feeds itself.** On every wire OPEN this probes the
 *      framework-reserved `system/identity` member over the link's own dispatch and
 *      hands the server's `processId` to `echo.remember`. The URL thunk appends it
 *      as `?pid=` on EVERY re-dial, so a tab that was live across a restart
 *      re-presents the now-stale id and is re-rejected until a fresh page resets
 *      it. Nothing outside this function has to observe an id, and nothing can
 *      forget to.
 *   2. **The retirement is answered.** The server's stale-close retires the wire for
 *      good (the link's terminal classifier), and `opts.retired` — required, no
 *      default — runs. A wire that compiles has a policy for its own death.
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
  const identityTag = identityTagFor(opts.siblingKey);
  // Which OPEN a probe belongs to. A probe from a superseded open landing late
  // would write an id from a connection we have already left — usually the dead
  // transport rejects first, but nothing guarantees it, so the write is guarded on
  // the generation rather than on hope.
  let openEpoch = 0;
  const readIdentity = (): void => {
    const epoch = ++openEpoch;
    // THE ECHO'S RUN EDGE. A member call is an `Effect`; `wire.onStatus` is a plain
    // callback with no Effect to compose into, and the value this produces is a
    // mutable the URL thunk reads on the next dial. One edge, here, rather than one
    // per consuming app — which is exactly what the old `onProcessId` seam made
    // every app open for itself.
    Effect.runPromise(link.dispatch.unary(identityTag, {}))
      .then((served) => {
        if (epoch !== openEpoch) return;
        echo.remember((served as ServedIdentity).processId);
      })
      .catch((err) => {
        // A probe in flight when the wire drops (or when the server retires this
        // tab at the very next handshake) fails BECAUSE the mechanism worked; the
        // next open re-probes. Report only a failure on a still-open wire, where it
        // means the reserved member itself is unreachable — the handshake is then
        // silently dead, which is the state this whole seam exists to end.
        if (epoch !== openEpoch || link.wire.status() !== "open") return;
        console.error(
          "surface-app: the reserved `system/identity` probe failed on an OPEN wire — " +
            "this connection echoes no `pid`, so the server cannot recognize it as a " +
            "stale tab after a restart",
          err,
        );
      });
  };
  // ONE-SHOT, and it has to be enforced rather than assumed. `retired` is terminal
  // on the wire, but this seam reads the status TWICE — through the subscription
  // and through the catch-up read below, which exist to cover different windows —
  // and the link dials on its own fiber, so a wire that retires between the two
  // would announce it once through each. An app whose handler reloads the page
  // would then be asked to reload twice.
  let announcedRetired = false;
  const announceRetired = (): void => {
    if (announcedRetired) return;
    announcedRetired = true;
    opts.retired();
  };
  const detachStatus = link.wire.onStatus((status) => {
    if (status === "open") readIdentity();
    else if (status === "retired") announceRetired();
  });
  // The wire may already have settled before this subscription existed — the link
  // dials on its own fiber, so a caller awaiting `createSurfaceSocket` can hold an
  // already-open (or already-retired) wire, and the status stream only reports
  // CHANGES.
  const settled = link.wire.status();
  if (settled === "open") readIdentity();
  else if (settled === "retired") announceRetired();
  return {
    link,
    dispose: async () => {
      detachStatus();
      // Supersede any in-flight probe so its late resolution cannot write to an
      // echo whose wire is gone.
      openEpoch++;
      await link.dispose();
    },
  };
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
  /** Observe every DEFINITIVE probe verdict (alive or stale) with the wall clock
   *  it settled at — additive observability, never policy. See
   *  `HeartbeatTuning.onProbeSettled` (`@kolu/surface/heartbeat`). */
  onProbeSettled?: (ok: boolean, atMs: number) => void;
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
    // Pass-through, undefined when the consumer wants none: a tuning field this
    // wrapper dropped would be a knob that silently does nothing.
    onProbeSettled: opts.onProbeSettled,
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
