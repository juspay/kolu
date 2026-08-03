/**
 * @kolu/surface-app/solid — the headless app-shell model + SW retirement.
 *
 * The library provides the MODEL (`useSurfaceApp()` → relationship-to-server +
 * reload + desktop affordances); the app renders the chrome (badge, rail, prompt)
 * in its own CSS. Build-skew is one `status` among connection states — the
 * unifying insight made concrete. Fed YOUR control-plane surface client + YOUR
 * baked commit; the library never imports your rpc or your build define.
 *
 * Written without JSX syntax (uses `createComponent`) so it's safely consumable
 * from `node_modules` without the consumer's Solid JSX transform reaching in.
 */

import {
  type Accessor,
  createComponent,
  createContext,
  createSignal,
  getOwner,
  type JSX,
  onCleanup,
  useContext,
} from "solid-js";
import {
  type BuildInfoDef,
  buildInfo as defaultBuildInfo,
  type ServerProbe,
} from "../surface";

// The non-component lifecycle calls live in the framework-free `/lifecycle`
// subpath; re-exported here so `<SurfaceAppProvider>` consumers reach them from
// one import. Apps with no component in scope (root setup) import `/lifecycle`.
// `retireSocket` is GONE — the link's terminal-close classifier retires a stale
// wire itself (see `../lifecycle`'s note).
export {
  registerOrRetireServiceWorker,
  registerServiceWorker,
  reloadForUpdate,
  retireServiceWorker,
} from "../lifecycle";

import { Effect } from "effect";
import type { UnaryEffect } from "@kolu/surface/client";
import type { WatchableWire } from "@kolu/surface/link";
import { gracedDown, onWake, type SurfaceFace } from "@kolu/surface/solid";
import {
  createHeartbeat,
  type HeartbeatConfig,
  normalizeHeartbeat,
} from "../connect";
import { reloadForUpdate } from "../lifecycle";

// The turnkey single-surface connect seam (socket + client + default-on
// heartbeat). It builds a Solid `surfaceClient`, so it lives in this `/solid`
// subpath, not the framework-free `/connect`.
export {
  type ConnectSurfaceOptions,
  connectSurface,
  type SurfaceConnection,
} from "./connectSurface";
// The turnkey MULTI-surface connect seam (one socket → a `surfaceClients`
// bundle + one default-on heartbeat + the combined `surfaceClientsHealth` fact).
export {
  type ConnectSurfacesOptions,
  connectSurfaces,
  type SurfacesConnection,
} from "./connectSurfaces";
// The single, UNFORGEABLE minter of a `LiveSignal` — wires the half-open watchdog
// AND brands the liveness accessor in one call — now lives in `@kolu/surface`
// (co-located with the module-private brand symbol, so nothing can forge a brand).
// Re-exported here for compat: `connectSurface`/`connectSurfaces` wrap it, and a
// hand-built `surfaceClient + websocketLink` (an example, or kolu's combined
// `wire.ts`) calls it directly. `SurfaceConnectionStatus` / `HeartbeatTuning` also
// moved there; re-exported so existing `@kolu/surface-app/solid` importers keep one
// import path. (`WatchableSocket` is deleted — the watchdog's seam is the
// transport-neutral `WatchableWire` in `@kolu/surface/link`, re-exported below.)
export type { WatchableWire, WireStatus } from "@kolu/surface/link";
export {
  createLiveSignal,
  type CreateLiveSignalOptions,
  type HeartbeatTuning,
  type LiveSignalHandle,
  type SurfaceConnectionStatus,
} from "@kolu/surface/solid";

/** The live relationship to the server this client is bound to. */
export type ConnectionStatus = "live" | "reconnecting" | "restarted" | "down";

/** The full lifecycle of that relationship — connecting, connected, a transient
 *  drop (`disconnected` → `reconnected`), or a server restart (a new `processId`
 *  after a drop). This is kolu's `rpc.ts` lifecycle, encapsulated so every
 *  surface app derives it instead of re-deriving it. */
export type ServerLifecycleEvent =
  | { kind: "connecting" }
  | { kind: "connected"; processId: string }
  | { kind: "disconnected" }
  | { kind: "reconnected"; processId: string }
  // A restart arrives two physically-distinct ways, and consumers must tell them
  // apart without re-reading the transport: `transport: "open"` is a probe-driven
  // restart (the wire is open against a fresh process); `transport: "closed"`
  // is a stale-restart (the server rejected this tab at the handshake, so the
  // link classified the close as TERMINAL and reported `WireStatus` `"retired"`
  // — it will never re-dial). Nobody outside the link ever sees a close CODE.
  //
  // `processId` rides ONLY the open shape — that's the id of the live process
  // this open landed against. The closed shape has NO live id to report: the
  // socket closed at the handshake before any probe, so the only id on hand is
  // the dead process we were detached from. Omitting it (rather than carrying
  // the stale id under the same field) keeps `serverProcessId()` from projecting
  // a contradictory "current" id — it returns `undefined` and the rail renders
  // its `—` placeholder.
  | { kind: "restarted"; processId: string; transport: "open" }
  | { kind: "restarted"; transport: "closed" };

/** What an identity probe reports: the server process id — a value that changes
 *  when the server restarts (so a reconnect to a *different* process is a restart,
 *  not a transient drop). Kept distinct from build identity (`commit`). Re-exported
 *  from `@kolu/surface-app/surface`, where it is derived (`typeof …Schema.Type`)
 *  from `ServerProbeSchema` — the single source of the probe's wire shape, so the
 *  type and the runtime validator can't desync. An app may send a superset (the
 *  provider is generic over the probe response — see `P`). */
export type { ServerProbe };

/** Pure A→B table — exhaustive at the type level (Record requires every key). */
const STATUS_OF: Record<ServerLifecycleEvent["kind"], ConnectionStatus> = {
  connecting: "reconnecting",
  connected: "live",
  disconnected: "down",
  reconnected: "live",
  restarted: "restarted",
};

/** How long the transport may sit `down` before a consumer's full-screen
 *  "Disconnected" overlay should appear. A forced reconnect — the half-open
 *  watchdog recovering, the link riding out a Wi-Fi roam — closes and reopens
 *  the socket in well under a second, and flashing a full-screen alarm for that
 *  blink is noise. The model's grace-windowed `presentingDown` (derived in the
 *  provider via `gracedDown` over `status`, the SAME window for every source shape)
 *  holds the overlay back until `down` has PERSISTED this long; a genuine sustained
 *  outage still surfaces promptly. Baked, not a knob — a tunable would just be a way
 *  to make the flash reappear. `status()` itself stays INSTANTANEOUS: it gates the
 *  heartbeat probe, the client, and the header dot, none of which want a delay. */
export const DISCONNECT_OVERLAY_GRACE_MS = 1_000;

/**
 * THE lifecycle's probe edge — the ONE place `@kolu/surface-app` runs an effect.
 *
 * A surface member call is an `Effect`, so both probes this module drives — the
 * IDENTITY round-trip that classifies the lifecycle, and the LIVENESS round-trip
 * the half-open watchdog fires — arrive as descriptions. Neither consumer of them
 * is Effect-shaped, and deliberately: the lifecycle hangs off `wire.onStatus`, a
 * plain callback, and `createHeartbeat` is the framework-free primitive that
 * races a probe against a timer (the same contract `@kolu/surface`'s own
 * `liveSignal` declares).
 *
 * It lives HERE rather than at each consumer because there are three of them —
 * kolu's `rpc.ts`, drishti's provider, and this package's example — and a probe
 * that crossed at the call site would be three edges describing one fact. It
 * cannot be delegated to `liveSignal`'s existing edge either: that one runs
 * `system.live` off the branded dispatch it guards and has NO caller-supplied
 * probe target on purpose (#1564 — a consumer once handed back a target that
 * resolved off a literal and branded a dead link), while this runs
 * `identity.info` and READS its `processId` as the classification input. Same
 * shape, different question, and one of them is a hardening we would be undoing.
 */
function runProbe<A>(effect: Effect.Effect<A, unknown>): Promise<A> {
  return Effect.runPromise(effect);
}

/** Derive the server lifecycle from a wire + an identity probe — the generic
 *  form of kolu's `rpc.ts`. On each `open` the probe reads the server's
 *  `processId`: the first connect is `connected`; a later one is `reconnected`
 *  (same id) or `restarted` (changed). A `closed` after the first connect is
 *  `disconnected`; the TERMINAL `retired` status is a definitive `restarted` (the
 *  server rejected a stale tab, the link will never re-dial, no probe can run).
 *
 *  Listener cleanup: if called inside a reactive owner the wire subscription is
 *  detached via `onCleanup`; the returned `dispose()` is the explicit handle for
 *  a module-level caller with no owner. */
export function createServerLifecycle<
  P extends ServerProbe = ServerProbe,
>(opts: {
  /** The wire the lifecycle observes — `createSurfaceSocket(...).link.wire`. It
   *  reads the status stream (open/closed/retired) and, when it owns the
   *  watchdog (below), calls `forceReconnect()` on a silently half-open wire. */
  wire: WatchableWire;
  /** The identity round-trip. An `Effect`, because a surface member call is one
   *  — {@link surfaceAppProbe} builds it and this lifecycle runs it, at
   *  {@link runProbe}. */
  probe: () => Effect.Effect<P, unknown>;
  /** The liveness round-trip the half-open watchdog uses — independent of `probe`.
   *  `probe` answers "WHICH process is on the other end?" (identity, for lifecycle
   *  classification); the watchdog answers the separate "is this link answering AT
   *  ALL?". Pass the framework-reserved verb — `probeSurfaceLive(client.rpc)` is
   *  the effect that asks it — exactly as `connectSurface` does, so every watchdog
   *  asks the one reserved question instead of an app-nominated verb. Omit it ONLY
   *  when no surface client `.rpc` is on hand (the `<SurfaceAppProvider>`
   *  `{ wire, probe }` turnkey path), where the watchdog falls back to `probe` —
   *  documented at the heartbeat site. */
  livenessProbe?: () => Effect.Effect<unknown, unknown>;
  /** Disable or tune the built-in liveness heartbeat (default ON). The watchdog
   *  probes `livenessProbe` (the reserved `system.live`) on an interval and forces
   *  `wire.forceReconnect()` on a silently half-open wire. Pass `false` only if you wire
   *  your own `createHeartbeat`; pass an object to tune its `intervalMs` /
   *  `timeoutMs` / `onStale`. The same {@link HeartbeatConfig} knob `connectSurface`
   *  accepts (a `heartbeat.probe` override here wins over `livenessProbe`). */
  heartbeat?: HeartbeatConfig;
  /** Surface a failed identity probe. A broken `identity.info` otherwise leaves
   *  the UI stuck in its prior state with no diagnostic — pass this to log it.
   *  The next `open` still retries; this is observation, not a transition. */
  onProbeError?: (err: unknown) => void;
  /** Fires after each successful identity probe with the observed `processId`,
   *  AFTER the lifecycle has already classified and committed the transition
   *  (`knownProcessId` / `setLifecycle`). It only PUBLISHES the observation
   *  outward so a consumer can echo it back as the `pid` handshake param on the
   *  next reconnect — without re-wrapping `probe` to carry a side-effect. It runs
   *  in a guarded block: a throwing consumer is reported via `onProbeError`, never
   *  unwinding the lifecycle transition. Distinct from `serverProcessId()`, which
   *  is `undefined` on a stale-close restart; the echo needs the last *snapshot*
   *  id, which this is. */
  onProcessId?: (processId: string) => void;
  // There is no `onStaleRestart` any more. It existed so a consumer could
  // `retireSocket(ws)` at the one site that decoded the stale close — and both
  // halves are gone: the LINK owns the close-code classifier now (it halts its
  // retry schedule and fails every call with `SurfaceTransportRetired`), so a
  // retired wire needs no consumer action and there is nothing left to hand out.
}): {
  lifecycle: Accessor<ServerLifecycleEvent>;
  status: Accessor<ConnectionStatus>;
  serverProcessId: Accessor<string | undefined>;
  /** Detach the wire subscription. Auto-wired to `onCleanup` under an owner;
   *  call it directly for a module-level (owner-less) lifecycle. */
  dispose: () => void;
} {
  const [lifecycle, setLifecycle] = createSignal<ServerLifecycleEvent>({
    kind: "connecting",
  });
  // Have we ever *successfully* observed a server identity? Classify on this, not
  // on raw `open` count: if the first WS open is followed by a FAILED probe, no
  // identity was established, so the next successful probe is still the initial
  // `connected` — not a spurious `reconnected`. `knownProcessId` is null until a
  // probe resolves, so its nullness IS that flag.
  let knownProcessId: string | null = null;
  const onOpen = () => {
    runProbe(opts.probe())
      .then(({ processId }) => {
        // Classify and transition FIRST, independent of the observer. The
        // `onProcessId` publish is fired afterwards in a guarded block: an
        // observer hook must not be able to poison the core lifecycle — a
        // throwing callback would otherwise turn a successful probe into a probe
        // failure, skip the transition, and leave the UI stuck in `connecting` /
        // `disconnected`.
        //
        // First *successful* identity (regardless of how many opens preceded it):
        // the initial connect. Only once an identity is on record does a later
        // probe become reconnect (same id) / restart (changed id).
        if (knownProcessId === null) {
          knownProcessId = processId;
          setLifecycle({ kind: "connected", processId });
        } else {
          const restarted = processId !== knownProcessId;
          knownProcessId = processId;
          setLifecycle(
            restarted
              ? // Probe-driven restart: this open landed against a fresh
                // process, so the socket is OPEN.
                { kind: "restarted", processId, transport: "open" }
              : { kind: "reconnected", processId },
          );
        }
        // Publish the observation — consumers echo it back as the next
        // reconnect's `pid` handshake param. Guarded so a throwing consumer is
        // reported (not silently swallowed) without unwinding the transition
        // already committed above.
        try {
          opts.onProcessId?.(processId);
        } catch (err) {
          opts.onProbeError?.(err);
        }
      })
      .catch((err) => {
        // The next `open` retries; don't transition on a failed probe. But
        // surface it — a permanently-broken probe is otherwise invisible.
        opts.onProbeError?.(err);
      });
  };
  const onClose = () => {
    // Only report a drop once an identity has been established — a close before
    // the first successful probe never established a relationship to report lost.
    if (knownProcessId !== null) setLifecycle({ kind: "disconnected" });
  };
  const onRetired = () => {
    // The link classified the close as TERMINAL (kolu's server rejecting a stale
    // tab whose `pid` no longer matches the live process): it has stopped
    // re-dialling for good, so this is a definitive restart, not a transient
    // drop. Go straight to `restarted` so the reload overlay takes over instead
    // of a "reconnecting" spinner that would wait for a reconnect that can never
    // come. The new id isn't observable (the wire closed before any probe) and
    // the LAST known id is the dead process we were detached from — NOT the live
    // server — so the closed shape carries no `processId` at all, and
    // `serverProcessId()` returns `undefined` rather than a stale "current" id.
    // Still gated on an established identity: a retirement before the first
    // connect never had a relationship to lose.
    if (knownProcessId === null) return;
    setLifecycle({ kind: "restarted", transport: "closed" });
  };
  // ONE subscription, on the wire's own status stream — the close CODE never
  // leaves the link (review #5), so the lifecycle reads a classified status
  // instead of re-decoding `event.code`. `connecting` is not a transition: it is
  // either the cold start (already the initial state) or the re-dial that follows
  // the `closed` we just reported.
  const detachStatus = opts.wire.onStatus((status) => {
    if (status === "open") onOpen();
    else if (status === "closed") onClose();
    else if (status === "retired") onRetired();
  });
  // A wire that opened before this subscription existed would otherwise never
  // probe — the status stream only reports CHANGES. (Real today: the link's dial
  // runs on its own fiber, so a caller awaiting `createSurfaceSocket` may well
  // hold an already-open wire.)
  if (opts.wire.status() === "open") onOpen();
  // The lifecycle OWNS this wire's observation, so it also owns its LIVENESS: a
  // default-on heartbeat probes `livenessProbe` on an interval and forces
  // `wire.forceReconnect()` on a SILENTLY half-open socket (laptop sleep / Wi-Fi
  // roam / NAT idle-eviction — TCP dead with no FIN/RST, so no status change ever
  // fires and the lifecycle alone would never notice; every stream hangs). This
  // folds in the watchdog that used to be a SECOND hand-wired `createHeartbeat`
  // beside every `createServerLifecycle` call (kolu's `rpc.ts`, the provider's
  // turnkey branch) — so deriving a lifecycle can no longer leave the wire
  // without one. A missed probe just warns and reconnects (a routine recovery).
  //
  // The watchdog's job (is the link answering AT ALL?) is independent of the
  // lifecycle's job (WHICH process is on the other end?), so it does NOT reuse the
  // identity `probe`: it probes `livenessProbe` — the framework-reserved
  // `system.live` round-trip, like `connectSurface` and the ssh-leg HostSession.
  // It falls back to `opts.probe` ONLY when no `livenessProbe` was supplied — the
  // `<SurfaceAppProvider>` `{ wire, probe }` turnkey path has the transport and the
  // identity probe but no surface client `.rpc` to build `system.live` from, so
  // there the identity probe doubles as the liveness round-trip.
  const liveness = opts.livenessProbe ?? opts.probe;
  const heartbeatOptions = normalizeHeartbeat(opts.heartbeat, {
    wire: opts.wire,
    // `createHeartbeat` is framework-free and Promise-shaped by contract (it races
    // the probe against a timer), so the effect crosses at the same one edge the
    // identity probe does.
    probe: () => runProbe(liveness()),
  });
  const heartbeat = heartbeatOptions && createHeartbeat(heartbeatOptions);
  // When this lifecycle owns the watchdog (the turnkey `{ wire, probe }` path —
  // drishti's admin control plane), give it the browser's fast resume re-probe too:
  // a wake event probes NOW instead of waiting up to a full interval for a wire a
  // suspension killed. No-op off-DOM and when the watchdog is disabled (kolu's
  // `heartbeat: false`, where the wire-side `createLiveSignal` already wired it).
  const detachWake = heartbeat ? onWake(heartbeat.wake) : undefined;
  const dispose = () => {
    detachStatus();
    detachWake?.();
    heartbeat?.dispose();
  };
  if (getOwner()) onCleanup(dispose);
  return {
    lifecycle,
    status: () => STATUS_OF[lifecycle().kind],
    serverProcessId: () => {
      const e = lifecycle();
      return "processId" in e ? e.processId : undefined;
    },
    dispose,
  };
}

/** surface-app's own `identity.info` restart probe, as a typed call on a surface
 *  client's `.rpc`. A client whose surface registers surface-app under a key
 *  exposes the probe at the SCOPED wire path `surface.identity.info` (the key is
 *  consumed by the scope and does not reappear). `.rpc` is the STRUCTURAL
 *  `SurfaceFace` (per-member precision lives in the bound faces — PLAN D2), so the
 *  one narrowing lives HERE, beside the surface that defines the probe, instead of
 *  being hand-pinned at every `createServerLifecycle({ probe })` site.
 *
 *  A face with no `identity.info` is a wrong-client mistake (drishti's per-host
 *  client vs. its admin one), so it CRASHES rather than answering with a failed
 *  effect that would read as a transient probe failure and leave the lifecycle
 *  silently stuck in `connecting`. The check is EAGER — outside the returned
 *  effect — deliberately: `createServerLifecycle` and `createHeartbeat` both
 *  distinguish a probe that threw SYNCHRONOUSLY (miswired: no round-trip was
 *  made) from one that failed asynchronously (the link answered with an error),
 *  and burying this inside an `Effect.suspend` would collapse the two.
 *
 *  It returns an **`Effect`**, because a unary member call is one: nothing
 *  dispatches until the caller runs it. `createServerLifecycle`'s `probe` /
 *  `livenessProbe` seams stay Promise-shaped (they are the framework-free
 *  watchdog contract — a probe raced against a timer, shared with non-Effect
 *  consumers), so a consumer wiring this in runs it at whatever Promise edge it
 *  already owns rather than this module opening a new one. */
export function surfaceAppProbe(client: {
  rpc: SurfaceFace;
}): Effect.Effect<ServerProbe, unknown> {
  const info = client.rpc.surface.identity?.info as
    | UnaryEffect<Record<string, never>, ServerProbe, never>
    | undefined;
  if (typeof info !== "function") {
    throw new Error(
      "surfaceAppProbe: this client's surface carries no `identity.info` — it is " +
        "not a surface-app surface (did you pass a per-entity client instead of " +
        "the control plane?).",
    );
  }
  return info({});
}

/** The environment facts that decide PWA install state — passed in so the
 *  decision is pure and unit-testable (the provider reads them from the DOM). */
export interface InstallEnv {
  /** `window.isSecureContext` — true for https + the localhost/loopback set. */
  isSecureContext: boolean;
  /** Any installed display-mode (standalone / minimal-ui / fullscreen). */
  displayModeStandalone: boolean;
  /** iOS Safari's legacy `navigator.standalone`. */
  navigatorStandalone: boolean;
}

/** Already installed / running as an app. */
export function isInstalledFromEnv(env: InstallEnv): boolean {
  return env.displayModeStandalone || env.navigatorStandalone;
}

/** A secure context where the **one-click** install prompt (and the app badge /
 *  service workers) can work, and not already installed. False over plain
 *  `http://` on a LAN/Tailscale IP — only https and the localhost/loopback set
 *  are secure contexts. Gate the *one-click* affordance on this; manual install
 *  via the browser menu still works over http, so don't use it to hide install
 *  entirely. */
export function canInstallFromEnv(env: InstallEnv): boolean {
  return env.isSecureContext && !isInstalledFromEnv(env);
}

/** Read the live install environment from the browser (SSR/test-safe). */
function readInstallEnv(): InstallEnv {
  if (typeof window === "undefined") {
    return {
      isSecureContext: false,
      displayModeStandalone: false,
      navigatorStandalone: false,
    };
  }
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches;
  return {
    isSecureContext: window.isSecureContext,
    displayModeStandalone: standalone,
    navigatorStandalone:
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  };
}

/** The headless model `useSurfaceApp()` returns. */
export interface SurfaceAppModel<
  T extends { commit: string } = { commit: string },
> {
  /** Connection lifecycle — build-skew is one facet of the same relationship. */
  status: Accessor<ConnectionStatus>;
  /** `status() === "down"`, GRACE-WINDOWED: true only once the transport has been
   *  `down` longer than {@link DISCONNECT_OVERLAY_GRACE_MS}. Gate a full-screen
   *  "Disconnected" overlay on THIS, not `status()`, so a sub-second forced
   *  reconnect (the half-open watchdog recovering, a Wi-Fi roam) never flashes the
   *  alarm. Use `status()` for the always-instant header dot. */
  presentingDown: Accessor<boolean>;
  /** This browser's build is provably behind the server's. */
  stale: Accessor<boolean>;
  /** What am I bound to — whatever the buildInfo cell carries (commit, …). */
  server: Accessor<T | undefined>;
  /** This client's baked-in commit. */
  clientCommit: string;
  /** A fresh server build is live and reloading will land it — drives the reload
   *  prompt. The skew-OR-restart rule (`"restarted"` status or `stale()`) and the
   *  `"restarted"` status-string knowledge live here, beside the `reload()` they gate. */
  updateReady: Accessor<boolean>;
  /** Land the deployed build. */
  reload: () => void;
  /** Set an attention/unread count: OS app badge if installed (best-effort) +
   *  the document title — degrades per browser. Pass 0 to clear. */
  setAttention: (count: number) => void;
  /** Running as an installed app (standalone display-mode / iOS `navigator.standalone`). */
  isInstalled: Accessor<boolean>;
  /** A secure context where the **one-click** install prompt — plus the OS app
   *  badge and service workers — can work (https or localhost), and not already
   *  installed. False over plain `http://` on a LAN/Tailscale IP, where *manual*
   *  install via the browser menu still works; gate the one-click affordance on
   *  this, not the existence of any install path. */
  canInstallPwa: Accessor<boolean>;
}

/** The structural slice of a surface client the provider needs: a `buildInfo`
 *  server cell whose `.use({ authority: "server" })` yields the build identity.
 *  Typing `controlPlane` against this (rather than `any`) makes passing a client
 *  whose surface lacks `buildInfo` a compile error — the "wrong control plane"
 *  mistake (drishti's admin client vs. its per-host clients). A real
 *  `SurfaceClient<S>` from `@kolu/surface` whose surface composes
 *  `...buildInfo.cells` satisfies this. The read is `{ authority: "server" }`:
 *  `buildInfo` is a server cell, so `{ initial }` (the local-authority shape) is
 *  wrong for it. */
export interface ControlPlane<
  T extends { commit: string } = { commit: string },
> {
  cells: {
    buildInfo: {
      use(opts?: { authority?: "server"; onError?: (err: Error) => void }): {
        value: Accessor<T | undefined>;
      };
    };
  };
}

const SurfaceAppContext = createContext<SurfaceAppModel>();

/** How the provider learns the connection status. Three mutually-exclusive
 *  shapes (a union, not three independent optionals — passing only half of
 *  `ws`/`probe` is not representable):
 *
 *    - `{ status }` — you already derived the lifecycle (e.g. a module-level
 *      `createServerLifecycle` shared with the rest of your app); the provider
 *      reads YOUR accessor and never attaches a second listener/probe pair.
 *      The right shape when other UI (a header dot, a restart gate) reads the
 *      same lifecycle — one source, no disagreement, no double probe.
 *    - `{ wire, probe }` — the provider derives the lifecycle itself (the turnkey
 *      shape for an app with no other lifecycle consumer); a failed identity
 *      probe is reported through the provider's `onError` prop. Because this
 *      source OWNS the wire's observation, it handles the whole stale-tab
 *      handshake: the link's terminal-close classifier retires the wire and the
 *      lifecycle reads the `retired` status as `restarted` (no close code to
 *      pass, nothing to retire by hand), and `onProcessId` echoes the `pid`
 *      param from your URL thunk. A consumer with its own lifecycle uses
 *      `{ status }` instead and wires those itself.
 *    - neither — `status()` is permanently `"live"` (build-skew only). */
export type ConnectionSource<P extends ServerProbe = ServerProbe> =
  | {
      status: Accessor<ConnectionStatus>;
      wire?: undefined;
      probe?: undefined;
    }
  | {
      // The turnkey source OWNS the wire's whole lifecycle — observe (status →
      // connection status) AND keep it alive with a heartbeat. Both affordances
      // live on the transport-neutral `WatchableWire` a wire link factory mints,
      // so there is no socket shape to satisfy any more.
      wire: WatchableWire;
      probe: () => Effect.Effect<P, unknown>;
      /** Opt the lifecycle's OWN half-open watchdog out (`heartbeat: false`) when
       *  another layer over the SAME wire already owns it — e.g. the
       *  `connectSurfaces` that built this wire's client bundle wires a
       *  watchdog-backed `LiveSignal` by construction. The lifecycle then only
       *  observes the status stream + the identity probe (it mints no brand, so
       *  disabling its watchdog is watchdog-OWNERSHIP coordination, never a
       *  branded-but-blind signal). Omit it (default) for a wire no other layer
       *  watches. */
      heartbeat?: HeartbeatConfig;
      /** Fired with each observed `processId` (forwards `createServerLifecycle`'s
       *  `onProcessId`). A turnkey caller stashes it in the mutable its wire's
       *  URL thunk echoes as the `pid` handshake param — without re-wrapping its
       *  own `probe` to carry the side-effect. */
      onProcessId?: (processId: string) => void;
      status?: undefined;
    }
  | { wire?: undefined; probe?: undefined; status?: undefined };

export type SurfaceAppProviderProps<
  T extends { commit: string } = { commit: string },
  P extends ServerProbe = ServerProbe,
> = {
  /** Your control-plane surface client (the one carrying the global buildInfo
   *  cell — for a many-client app, not a per-entity client). Constrained to a
   *  client whose surface carries `buildInfo`, so the wrong client is a compile
   *  error rather than a silent runtime read. */
  controlPlane: ControlPlane<T>;
  /** This client's build commit — read off the shell global the build injected
   *  (`shellCommit()` from `@kolu/surface-app/lifecycle`, reading
   *  `window.__SURFACE_APP_COMMIT__`). It rides the `no-store` shell, never a
   *  hashed-asset define (kolu#1319). */
  clientCommit: string;
  /** The build-identity fragment — defaults to `{ commit }`. Pass your extended
   *  one (e.g. kolu's pty-host axis) to drive `stale` off it. */
  buildInfo?: BuildInfoDef<T>;
  /** Surface a failed `buildInfo` subscription. The cell is a server stream; if
   *  it dies, `stale()` silently falls back to the default and the user sees no
   *  error. Pass this to toast / log the drop. In the turnkey `{ ws, probe }`
   *  connection mode this also receives identity-probe failures (a broken
   *  `probe` otherwise leaves `status()` stuck with no diagnostic) — so a single
   *  handler covers both the build-identity stream and the lifecycle probe. */
  onError?: (err: Error) => void;
  children: JSX.Element;
} & ConnectionSource<P>;

// The `(<n>) ` count prefix this module writes onto `document.title`. Stripping
// it recovers the app's own title from the live `document.title` — so the title
// the app drives (e.g. kolu's async-server-info `<Title>`) is read at call time,
// not snapshotted at module load. A module-load snapshot would clobber the
// current title with the import-time one the moment attention clears.
const ATTENTION_PREFIX = /^\(\d+\) /;

function setAttention(count: number): void {
  // OS app badge — installed Chromium (Win/macOS) etc.; no-op elsewhere. Do not
  // gate on install state — feature-detect and call; if it works, it works.
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  // Badging API rejections (permission denied, unsupported) are safe to ignore —
  // the badge is a best-effort decoration; the app functions identically without it.
  if (count > 0) void nav.setAppBadge?.(count).catch(() => {});
  else void nav.clearAppBadge?.().catch(() => {});
  // Document title — the universal fallback (the in-browser-tab case). Read the
  // CURRENT title and strip any prefix we previously applied, so the base is
  // whatever the app's title source has set since (not a module-load snapshot).
  if (typeof document !== "undefined") {
    const base = document.title.replace(ATTENTION_PREFIX, "");
    document.title = count > 0 ? `(${count}) ${base}` : base;
  }
}

/** Provide the headless app-shell model to the tree. Render your chrome from
 *  `useSurfaceApp()` underneath it. */
export function SurfaceAppProvider<
  T extends { commit: string } = { commit: string },
  P extends ServerProbe = ServerProbe,
>(props: SurfaceAppProviderProps<T, P>): JSX.Element {
  const def = (props.buildInfo ?? defaultBuildInfo) as BuildInfoDef<T>;
  // `buildInfo` is a server cell — read it with `{ authority: "server" }`, not
  // the `{ initial }` (local-authority) shape. Pass `onError` so a dead stream
  // surfaces instead of silently collapsing `stale()` to the default.
  const cell = props.controlPlane.cells.buildInfo.use({
    authority: "server",
    onError: props.onError,
  });
  const server = () => cell.value();
  // The connection status. Prefer a caller-supplied `status` accessor (the app
  // already derived the lifecycle once — read it, don't re-derive it: a second
  // `createServerLifecycle` would double the `identity.info` probe per reconnect
  // and let two observers disagree). Otherwise derive it here from `ws`+`probe`
  // (the turnkey shape), or stay permanently `"live"` when neither is given.
  let status: Accessor<ConnectionStatus>;
  if (props.status) {
    status = props.status;
  } else if (props.wire && props.probe) {
    const lifecycle = createServerLifecycle({
      wire: props.wire,
      probe: props.probe,
      // Forward the watchdog opt-out: when `connectSurfaces` already wired a
      // watchdog over this same admin wire (the usual control-plane shape), the
      // lifecycle takes `heartbeat: false` so the wire isn't double-watched — it
      // mints no brand, so this is ownership coordination, not a blind signal.
      heartbeat: props.heartbeat,
      // Forward the snapshot-id publisher so a turnkey caller can echo the `pid`
      // handshake param from its own URL thunk without re-wrapping `probe`.
      onProcessId: props.onProcessId,
      // Route probe failures through the same `onError` the buildInfo
      // stream uses — a turnkey caller has no separate `createServerLifecycle`
      // to attach `onProbeError` to, so a broken probe would otherwise be
      // swallowed and leave `status()` stuck with no diagnostic.
      onProbeError: (err) =>
        props.onError?.(err instanceof Error ? err : new Error(String(err))),
    });
    status = lifecycle.status;
    // The turnkey source owns the wire's LIVENESS too — but that watchdog now
    // lives INSIDE `createServerLifecycle` (default-on, disposed with the
    // lifecycle), so there is no separate `createHeartbeat` to wire here. A
    // consumer using this `{ wire, probe }` shape (e.g. drishti's admin control
    // plane) gets the half-open watchdog for free. Retirement needs no wiring
    // either: the link retires ITSELF on the server's stale close, and the
    // lifecycle reads that as `restarted` / `transport: "closed"`.
  } else {
    status = () => "live";
  }
  // The overlay-gating predicate: `status()`'s `down`, grace-windowed so a
  // sub-second forced reconnect never paints the full-screen alarm. Derived ONCE
  // over the resolved `status` — uniformly for every source shape, so the policy
  // can't be lost by a consumer forgetting to thread it — and never debounced onto
  // `status` itself (which must stay instant for the header dot and heartbeat gate).
  const presentingDown = gracedDown(
    () => status() === "down",
    DISCONNECT_OVERLAY_GRACE_MS,
  );
  // Staleness is a property of the build-identity fragment; the fragment's
  // `isStale` wants a concrete value, so fall back to the schema default.
  const isStale = (srv: T | undefined): boolean =>
    def.isStale(srv ?? def.cells.buildInfo.default, props.clientCommit);
  const stale = () => isStale(server());
  // Install environment — a signal so `isInstalled`/`canInstallPwa` update when
  // the app gets installed (`appinstalled`) or its display-mode flips (the user
  // launches it standalone). Listeners detach on dispose under an owner.
  const [installEnv, setInstallEnv] = createSignal<InstallEnv>(
    readInstallEnv(),
  );
  if (typeof window !== "undefined") {
    const refresh = () => setInstallEnv(readInstallEnv());
    window.addEventListener("appinstalled", refresh);
    const mq = window.matchMedia("(display-mode: standalone)");
    mq.addEventListener?.("change", refresh);
    if (getOwner())
      onCleanup(() => {
        window.removeEventListener("appinstalled", refresh);
        mq.removeEventListener?.("change", refresh);
      });
  }
  const model: SurfaceAppModel<T> = {
    status,
    presentingDown,
    stale,
    server,
    clientCommit: props.clientCommit,
    // A new build is live whether the deploy was caught live (`"restarted"`) or
    // this bundle's commit provably differs (`stale()`) — the unified rule lives
    // beside `reload()`, so consumers read the predicate instead of re-deriving it.
    updateReady: () => status() === "restarted" || stale(),
    reload: reloadForUpdate,
    setAttention,
    isInstalled: () => isInstalledFromEnv(installEnv()),
    canInstallPwa: () => canInstallFromEnv(installEnv()),
  };
  return createComponent(SurfaceAppContext.Provider, {
    value: model as SurfaceAppModel,
    get children() {
      return props.children;
    },
  });
}

/** Read the headless app-shell model. Must be used under `<SurfaceAppProvider>`. */
export function useSurfaceApp<
  T extends { commit: string } = { commit: string },
>(): SurfaceAppModel<T> {
  const model = useContext(SurfaceAppContext);
  if (!model) {
    throw new Error("useSurfaceApp must be used within <SurfaceAppProvider>");
  }
  return model as SurfaceAppModel<T>;
}
