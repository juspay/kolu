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
import { transportRetiredError } from "@kolu/surface/client";
import {
  type BuildInfoDef,
  buildInfo as defaultBuildInfo,
  type ServerProbe,
} from "../surface";

// The non-component lifecycle calls live in the framework-free `/lifecycle`
// subpath; re-exported here so `<SurfaceAppProvider>` consumers reach them from
// one import. Apps with no component in scope (root setup) import `/lifecycle`.
export {
  registerServiceWorker,
  reloadForUpdate,
  retireServiceWorker,
} from "../lifecycle";

import { reloadForUpdate } from "../lifecycle";

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
  ws: WsLike;
  probe: () => Promise<P>;
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
  /** Fires after each successful identity probe with the observed `processId`.
   *  The lifecycle already classifies it internally (`knownProcessId`); this just
   *  PUBLISHES the observation outward so a consumer can echo it back as the `pid`
   *  handshake param on the next reconnect — without re-wrapping `probe` to carry
   *  a side-effect. Distinct from `serverProcessId()`, which is `undefined` on a
   *  stale-close restart; the echo needs the last *observed* id, which this is. */
  onProcessId?: (processId: string) => void;
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
        // Publish the observation before classifying it — consumers echo it back
        // as the next reconnect's `pid` handshake param.
        opts.onProcessId?.(processId);
        // First *successful* identity (regardless of how many opens preceded it):
        // the initial connect. Only once an identity is on record does a later
        // probe become reconnect (same id) / restart (changed id).
        if (knownProcessId === null) {
          knownProcessId = processId;
          setLifecycle({ kind: "connected", processId });
          return;
        }
        const restarted = processId !== knownProcessId;
        knownProcessId = processId;
        setLifecycle(
          restarted
            ? // Probe-driven restart: this open landed against a fresh process,
              // so the socket is OPEN.
              { kind: "restarted", processId, transport: "open" }
            : { kind: "reconnected", processId },
        );
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
      return;
    }
    // Only report a drop once an identity has been established — a close before
    // the first successful probe never established a relationship to report lost.
    if (knownProcessId !== null) setLifecycle({ kind: "disconnected" });
  };
  opts.ws.addEventListener("open", onOpen);
  opts.ws.addEventListener("close", onClose);
  const dispose = () => {
    opts.ws.removeEventListener?.("open", onOpen);
    opts.ws.removeEventListener?.("close", onClose);
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

/** Permanently retire a transport the server rejected as stale (a tab bound to a
 *  previous process). The app's reload affordance is now the only way forward, so
 *  neither a reconnecting wrapper's offline buffer nor oRPC's pending peers may
 *  grow unbounded behind it. Two side-effects, both required for the surface
 *  family's transport (partysocket + oRPC):
 *
 *   - `close()` stops auto-reconnect — partysocket flips `_shouldReconnect` to
 *     false, so it won't re-present the same dead `pid` and be re-rejected in a
 *     loop. A fresh page resets it.
 *   - REPLACING `send` with a throwing stub makes oRPC's `ClientPeer` REJECT each
 *     later request. A `send` that returns normally looks dispatched, then awaits
 *     a response that never arrives (the socket is closed and won't reconnect, so
 *     no close event settles the peer either) — every post-stale call would hang
 *     forever, accumulating unresolved peers; partysocket would also enqueue it
 *     into an unbounded offline buffer (`maxEnqueuedMessages: Infinity`). The
 *     throw rejects through the caller's existing error path instead.
 *
 *  The throw is an `ORPCError` (via `transportRetiredError`), NOT a plain `Error`:
 *  the surface family's shared retry fence (`shouldNotRetryORPCError`) only treats
 *  an `ORPCError` as non-retriable. A plain throw would still look like a retriable
 *  transport error, so a streaming consumer on `STREAM_RETRY` (infinite retries)
 *  would re-subscribe forever — and for the terminal attach stream, each retry
 *  fires `onRetry` → `terminal.reset()`, repeatedly clearing the readable buffer
 *  behind the reload overlay. The non-retry shape settles the retired tab instead.
 *
 *  Fire it off the lifecycle's `restarted` event whose `transport` is `"closed"`.
 *  Takes a structural `{ close, send }` (not the concrete socket type) so the
 *  transport library never leaks across the package boundary; `send` is typed
 *  `unknown` because it is overwritten, never called. */
export function retireSocket(ws: { close(): void; send: unknown }): void {
  ws.close();
  ws.send = () => {
    throw transportRetiredError(
      "surface-app: server restarted — reload required (stale tab)",
    );
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
 *      probe is reported through the provider's `onError` prop. Pass the optional
 *      `restartCloseCode` to get the synchronous stale-restart fast path
 *      (`createServerLifecycle`'s option of the same name) without dropping to
 *      the manual `{ status }` shape — a transport close with that code goes
 *      straight to `restarted`.
 *    - neither — `status()` is permanently `"live"` (build-skew only). */
export type ConnectionSource<P extends ServerProbe = ServerProbe> =
  | { status: Accessor<ConnectionStatus>; ws?: undefined; probe?: undefined }
  | {
      ws: WsLike;
      probe: () => Promise<P>;
      restartCloseCode?: number;
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
  /** This client's baked-in commit (your bundler define — e.g. injected by the
   *  surface-app commit stamp as `__SURFACE_APP_COMMIT__`). */
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
  const status: Accessor<ConnectionStatus> = props.status
    ? props.status
    : props.ws && props.probe
      ? createServerLifecycle({
          ws: props.ws,
          probe: props.probe,
          // Forward the turnkey caller's stale-restart fast path (a transport
          // close with this exact code is a definitive `restarted`), so the
          // `{ ws, probe }` shape reaches the same behavior as a manual
          // `createServerLifecycle` — no need to drop to the `{ status }` mode
          // just to set it.
          restartCloseCode: props.restartCloseCode,
          // Route probe failures through the same `onError` the buildInfo
          // stream uses — a turnkey caller has no separate `createServerLifecycle`
          // to attach `onProbeError` to, so a broken probe would otherwise be
          // swallowed and leave `status()` stuck with no diagnostic.
          onProbeError: (err) =>
            props.onError?.(
              err instanceof Error ? err : new Error(String(err)),
            ),
        }).status
      : () => "live";
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
