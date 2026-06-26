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
export {
  registerOrRetireServiceWorker,
  registerServiceWorker,
  reloadForUpdate,
  retireServiceWorker,
  retireSocket,
} from "../lifecycle";

import {
  createHeartbeat,
  type HeartbeatConfig,
  normalizeHeartbeat,
} from "../connect";
import { reloadForUpdate, retireSocket } from "../lifecycle";

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
export { createSocketStatus } from "./socketStatus";
// The single, UNFORGEABLE minter of a `LiveSignal` — wires the half-open watchdog
// AND brands the liveness accessor in one call — now lives in `@kolu/surface`
// (co-located with the module-private brand symbol, so nothing can forge a brand).
// Re-exported here for compat: `connectSurface`/`connectSurfaces` wrap it, and a
// hand-built `surfaceClient + websocketLink` (an example, or kolu's combined
// `wire.ts`) calls it directly. `SurfaceConnectionStatus` / `HeartbeatTuning` also
// moved there; re-exported so existing `@kolu/surface-app/solid` importers keep one
// import path.
export {
  createLiveSignal,
  type CreateLiveSignalOptions,
  type HeartbeatTuning,
  type LiveSignalHandle,
  type SurfaceConnectionStatus,
  type WatchableSocket,
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
  // apart without re-reading the socket: `transport: "open"` is a probe-driven
  // restart (the socket is open against a fresh process); `transport: "closed"`
  // is a stale-restart (the server rejected this tab at the handshake via
  // `restartCloseCode`, so the socket is genuinely closed). The discriminator
  // carries the close-code interpretation OUT of the receptacle so kolu never
  // re-decodes `restartCloseCode` against the bare socket.
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
 *  from `@kolu/surface-app/surface`, where it is derived (`z.infer`) from
 *  `ServerProbeSchema` — the single source of the probe's wire shape, so the type
 *  and the runtime validator can't desync. An app may send a superset (the
 *  provider is generic over the probe response — see `P`). */
export type { ServerProbe };

/** The transport surface-app observes — `WebSocket` / `PartySocket` both fit.
 *  `removeEventListener` is optional: when present, `createServerLifecycle`
 *  detaches its listeners on dispose (no leak across remounts). */
export interface WsLike {
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(
    type: "close",
    listener: (event?: { code?: number }) => void,
  ): void;
  removeEventListener?(
    type: "open" | "close",
    listener: (event?: { code?: number }) => void,
  ): void;
}

/** Pure A→B table — exhaustive at the type level (Record requires every key). */
const STATUS_OF: Record<ServerLifecycleEvent["kind"], ConnectionStatus> = {
  connecting: "reconnecting",
  connected: "live",
  disconnected: "down",
  reconnected: "live",
  restarted: "restarted",
};

/** Derive the server lifecycle from a transport + an identity probe — the generic
 *  form of kolu's `rpc.ts`. On each `open` the probe reads the server's
 *  `processId`: the first connect is `connected`; a later one is `reconnected`
 *  (same id) or `restarted` (changed). A `close` after the first connect is
 *  `disconnected` — unless it carries `restartCloseCode`, which is a definitive
 *  `restarted` (the server rejected a stale tab; no probe can run).
 *
 *  Listener cleanup: if called inside a reactive owner the open/close listeners
 *  are detached via `onCleanup` (when the transport exposes `removeEventListener`);
 *  the returned `dispose()` is the explicit handle for a module-level caller with
 *  no owner. */
export function createServerLifecycle<
  P extends ServerProbe = ServerProbe,
>(opts: {
  // The lifecycle OWNS this socket — it observes open/close, retires it on a
  // stale restart, AND (below) keeps it alive with a heartbeat — so its `ws` is
  // `WsLike` PLUS the verbs `createHeartbeat` needs (`reconnect`/`readyState`/
  // `OPEN`). Every real partysocket satisfies this.
  ws: WsLike & {
    reconnect(): void;
    readyState: number;
    readonly OPEN: number;
  };
  probe: () => Promise<P>;
  /** The liveness round-trip the half-open watchdog uses — independent of `probe`.
   *  `probe` answers "WHICH process is on the other end?" (identity, for lifecycle
   *  classification); the watchdog answers the separate "is this link answering AT
   *  ALL?". Pass the framework-reserved verb (`() => probeSurfaceLive(client.rpc)`),
   *  exactly as `connectSurface` does, so every watchdog asks the one reserved
   *  question instead of an app-nominated verb. Omit it ONLY when no surface client
   *  `.rpc` is on hand (the `<SurfaceAppProvider>` `{ ws, probe }` turnkey path),
   *  where the watchdog falls back to `probe` — documented at the heartbeat site. */
  livenessProbe?: () => Promise<unknown>;
  /** Disable or tune the built-in liveness heartbeat (default ON). The watchdog
   *  probes `livenessProbe` (the reserved `system.live`) on an interval and forces
   *  `ws.reconnect()` on a silently half-open socket. Pass `false` only if you wire
   *  your own `createHeartbeat`; pass an object to tune its `intervalMs` /
   *  `timeoutMs` / `onStale`. The same {@link HeartbeatConfig} knob `connectSurface`
   *  accepts (a `heartbeat.probe` override here wins over `livenessProbe`). */
  heartbeat?: HeartbeatConfig;
  /** Surface a failed identity probe. A broken `identity.info` otherwise leaves
   *  the UI stuck in its prior state with no diagnostic — pass this to log it.
   *  The next `open` still retries; this is observation, not a transition. */
  onProbeError?: (err: unknown) => void;
  /** Close code that signals a definitive server restart rather than a transient
   *  drop. When the transport closes with this exact code, the lifecycle goes
   *  straight to `restarted` (not `disconnected`) — no probe needed, because the
   *  socket closed before one could run. kolu passes its server's stale-process
   *  handshake-rejection code (`STALE_PROCESS_CLOSE_CODE`) here. */
  restartCloseCode?: number;
  /** Fires after each successful identity probe with the observed `processId`,
   *  AFTER the lifecycle has already classified and committed the transition
   *  (`knownProcessId` / `setLifecycle`). It only PUBLISHES the observation
   *  outward so a consumer can echo it back as the `pid` handshake param on the
   *  next reconnect — without re-wrapping `probe` to carry a side-effect. It runs
   *  in a guarded block: a throwing consumer is reported via `onProbeError`, never
   *  unwinding the lifecycle transition. Distinct from `serverProcessId()`, which
   *  is `undefined` on a stale-close restart; the echo needs the last *observed*
   *  id, which this is. */
  onProcessId?: (processId: string) => void;
  /** Fired synchronously when a stale-close restart is decoded (the
   *  `restartCloseCode` path → `restarted` / `transport: "closed"`). The consumer
   *  supplies the teardown for the socket it owns — typically `retireSocket(ws)`
   *  — so the *action* lives at the call site while the *decision* (this is a
   *  stale restart) stays the library's, decoded in exactly one place. Not fired
   *  for a probe-driven restart (`transport: "open"`), whose socket is alive. */
  onStaleRestart?: () => void;
}): {
  lifecycle: Accessor<ServerLifecycleEvent>;
  status: Accessor<ConnectionStatus>;
  serverProcessId: Accessor<string | undefined>;
  /** Detach the transport listeners. Auto-wired to `onCleanup` under an owner;
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
    opts
      .probe()
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
  const onClose = (event?: { code?: number }) => {
    // A dedicated restart close code (kolu's server rejecting a stale tab whose
    // `pid` no longer matches the live process) is a definitive restart, not a
    // transient drop. Go straight to `restarted` so the reload overlay takes
    // over instead of a "reconnecting" spinner that would loop as the client
    // keeps re-presenting the same stale id. The new id isn't observable (the
    // socket closed before any probe) and the LAST known id is the dead process
    // we were detached from — NOT the live server — so the closed shape carries
    // no `processId` at all, and `serverProcessId()` returns `undefined` rather
    // than a stale "current" id. Still gated on an established identity: a
    // restart close before the first connect never had a relationship to lose.
    if (
      opts.restartCloseCode !== undefined &&
      event?.code === opts.restartCloseCode &&
      knownProcessId !== null
    ) {
      // Stale-restart: the socket closed before any probe could run, so it is
      // genuinely CLOSED. The discriminator hands that fact to consumers so they
      // don't re-inspect `event.code` themselves. No `processId`: the only id on
      // hand is the dead process we were detached from, and surfacing it under
      // the live-id field would have `serverProcessId()` report a contradictory
      // "current" id.
      setLifecycle({ kind: "restarted", transport: "closed" });
      // Fire the consumer's teardown synchronously, here at the single site that
      // decodes the stale-close — so the consumer provides the *action* (retire
      // THIS socket) without re-reading `event.code` itself or racing a reactive
      // effect. The library owns *when* (this decode), the consumer owns *what*.
      opts.onStaleRestart?.();
      return;
    }
    // Only report a drop once an identity has been established — a close before
    // the first successful probe never established a relationship to report lost.
    if (knownProcessId !== null) setLifecycle({ kind: "disconnected" });
  };
  opts.ws.addEventListener("open", onOpen);
  opts.ws.addEventListener("close", onClose);
  // The lifecycle OWNS this socket, so it also owns its LIVENESS: a default-on
  // heartbeat probes `livenessProbe` on an interval and forces `ws.reconnect()` on
  // a SILENTLY half-open socket (laptop sleep / Wi-Fi roam / NAT idle-eviction —
  // TCP dead with no FIN/RST, so neither `open` nor `close` fires and the
  // lifecycle alone would never notice; every stream hangs). This folds in the
  // watchdog that used to be a SECOND hand-wired `createHeartbeat({ ws, probe })`
  // beside every `createServerLifecycle` call (kolu's `rpc.ts`, the provider's
  // turnkey branch) — so deriving a lifecycle can no longer leave the socket
  // without one. A missed probe just warns and reconnects (a routine recovery).
  //
  // The watchdog's job (is the link answering AT ALL?) is independent of the
  // lifecycle's job (WHICH process is on the other end?), so it does NOT reuse the
  // identity `probe`: it probes `livenessProbe` — the framework-reserved
  // `system.live` round-trip, like `connectSurface` and the ssh-leg HostSession.
  // It falls back to `opts.probe` ONLY when no `livenessProbe` was supplied — the
  // `<SurfaceAppProvider>` `{ ws, probe }` turnkey path has the transport and the
  // identity probe but no surface client `.rpc` to build `system.live` from, so
  // there the identity probe doubles as the liveness round-trip.
  const heartbeatOptions = normalizeHeartbeat(opts.heartbeat, {
    ws: opts.ws,
    probe: opts.livenessProbe ?? opts.probe,
  });
  const heartbeat = heartbeatOptions && createHeartbeat(heartbeatOptions);
  const dispose = () => {
    opts.ws.removeEventListener?.("open", onOpen);
    opts.ws.removeEventListener?.("close", onClose);
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
 *  consumed by the scope and does not reappear). `.rpc` is typed `unknown` (the
 *  dynamic combined link can't be expanded per-key — see `SurfaceClient.rpc`), so
 *  the structural cast lives HERE once, beside the surface that defines the probe,
 *  instead of being hand-pinned at every `createServerLifecycle({ probe })` site. */
export function surfaceAppProbe(client: {
  rpc: unknown;
}): Promise<ServerProbe> {
  return (
    client.rpc as {
      surface: { identity: { info: (input: object) => Promise<ServerProbe> } };
    }
  ).surface.identity.info({});
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
 *    - `{ ws, probe }` — the provider derives the lifecycle itself (the turnkey
 *      shape for an app with no other lifecycle consumer); a failed identity
 *      probe is reported through the provider's `onError` prop. Because this
 *      source OWNS the socket, it handles the whole stale-tab handshake: pass
 *      `restartCloseCode` for the synchronous stale-restart fast path (a close
 *      with that code goes straight to `restarted`), `onProcessId` to echo the
 *      `pid` param from your URL thunk, and the provider retires the socket for
 *      you on a stale-restart. Its `ws` is therefore `WsLike & { close, send }`
 *      (the verbs `retireSocket` needs), not bare `WsLike`. A consumer with its
 *      own lifecycle uses `{ status }` instead and wires those itself.
 *    - neither — `status()` is permanently `"live"` (build-skew only). */
export type ConnectionSource<P extends ServerProbe = ServerProbe> =
  | { status: Accessor<ConnectionStatus>; ws?: undefined; probe?: undefined }
  | {
      // The turnkey source OWNS the socket's whole lifecycle — observe (open/
      // close → status), retire it on a stale-restart, AND keep it alive with a
      // heartbeat — so its `ws` is `WsLike` PLUS the verbs `retireSocket` and
      // `createHeartbeat` need. The observation-only `WsLike` stays minimal for
      // the `{ status }` path; only here, where the provider acts on the socket,
      // is the richer shape required (every real partysocket satisfies it).
      ws: WsLike & {
        close(): void;
        send: unknown;
        reconnect(): void;
        readyState: number;
        readonly OPEN: number;
      };
      probe: () => Promise<P>;
      restartCloseCode?: number;
      /** Opt the lifecycle's OWN half-open watchdog out (`heartbeat: false`) when
       *  another layer over the SAME socket already owns it — e.g. the
       *  `connectSurfaces` that built this socket's client bundle wires a
       *  watchdog-backed `LiveSignal` by construction. The lifecycle then only
       *  observes open/close + the identity probe (it mints no brand, so disabling
       *  its watchdog is watchdog-OWNERSHIP coordination, never a branded-but-blind
       *  signal). Omit it (default) for a socket no other layer watches. */
      heartbeat?: HeartbeatConfig;
      /** Fired with each observed `processId` (forwards `createServerLifecycle`'s
       *  `onProcessId`). A turnkey caller stashes it in the mutable its socket's
       *  URL thunk echoes as the `pid` handshake param — without re-wrapping its
       *  own `probe` to carry the side-effect. */
      onProcessId?: (processId: string) => void;
      status?: undefined;
    }
  | { ws?: undefined; probe?: undefined; status?: undefined };

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
  } else if (props.ws && props.probe) {
    const ws = props.ws;
    const lifecycle = createServerLifecycle({
      ws,
      probe: props.probe,
      // Forward the turnkey caller's stale-restart fast path (a transport
      // close with this exact code is a definitive `restarted`), so the
      // `{ ws, probe }` shape reaches the same behavior as a manual
      // `createServerLifecycle` — no need to drop to the `{ status }` mode
      // just to set it.
      restartCloseCode: props.restartCloseCode,
      // Forward the watchdog opt-out: when `connectSurfaces` already wired a
      // watchdog over this same admin socket (the usual control-plane shape), the
      // lifecycle takes `heartbeat: false` so the socket isn't double-watched — it
      // mints no brand, so this is ownership coordination, not a blind signal.
      heartbeat: props.heartbeat,
      // Forward the observed-id publisher so a turnkey caller can echo the `pid`
      // handshake param from its own URL thunk without re-wrapping `probe`.
      onProcessId: props.onProcessId,
      // The turnkey source OWNS this socket, so it owns the teardown: on a
      // stale-restart (the server rejected this tab) retire the socket so neither
      // a reconnecting wrapper's offline buffer nor oRPC's pending peers grow
      // behind the reload prompt. The `{ status }` source never reaches here —
      // there the app owns the socket and passes its own `onStaleRestart` to the
      // `createServerLifecycle` it derived (e.g. kolu's `rpc.ts`).
      onStaleRestart: () => retireSocket(ws),
      // Route probe failures through the same `onError` the buildInfo
      // stream uses — a turnkey caller has no separate `createServerLifecycle`
      // to attach `onProbeError` to, so a broken probe would otherwise be
      // swallowed and leave `status()` stuck with no diagnostic.
      onProbeError: (err) =>
        props.onError?.(err instanceof Error ? err : new Error(String(err))),
    });
    status = lifecycle.status;
    // The turnkey source owns the socket's LIVENESS too — but that watchdog now
    // lives INSIDE `createServerLifecycle` (default-on, disposed with the
    // lifecycle), so there is no separate `createHeartbeat` to wire here. A
    // consumer using this `{ ws, probe }` shape (e.g. drishti's admin control
    // plane) gets the half-open watchdog for free.
  } else {
    status = () => "live";
  }
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
