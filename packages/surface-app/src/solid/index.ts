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
export { reloadForUpdate, retireServiceWorker } from "../lifecycle";

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
  | { kind: "restarted"; processId: string };

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
  addEventListener(type: "open" | "close", listener: () => void): void;
  removeEventListener?(type: "open" | "close", listener: () => void): void;
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
 *  `disconnected`.
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
  /** Surface a failed identity probe. A broken `surfaceApp.info` otherwise leaves
   *  the UI stuck in its prior state with no diagnostic — pass this to log it.
   *  The next `open` still retries; this is observation, not a transition. */
  onProbeError?: (err: unknown) => void;
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
        setLifecycle({
          kind: restarted ? "restarted" : "reconnected",
          processId,
        });
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
  /** Land the deployed build. */
  reload: () => void;
  /** Set an attention/unread count: OS app badge if installed (best-effort) +
   *  the document title — degrades per browser. Pass 0 to clear. */
  setAttention: (count: number) => void;
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
 *      probe is reported through the provider's `onError` prop.
 *    - neither — `status()` is permanently `"live"` (build-skew only). */
export type ConnectionSource<P extends ServerProbe = ServerProbe> =
  | { status: Accessor<ConnectionStatus>; ws?: undefined; probe?: undefined }
  | { ws: WsLike; probe: () => Promise<P>; status?: undefined }
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
  // `createServerLifecycle` would double the `surfaceApp.info` probe per reconnect
  // and let two observers disagree). Otherwise derive it here from `ws`+`probe`
  // (the turnkey shape), or stay permanently `"live"` when neither is given.
  const status: Accessor<ConnectionStatus> = props.status
    ? props.status
    : props.ws && props.probe
      ? createServerLifecycle({
          ws: props.ws,
          probe: props.probe,
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
  const model: SurfaceAppModel<T> = {
    status,
    stale: () => isStale(server()),
    server,
    clientCommit: props.clientCommit,
    reload: reloadForUpdate,
    setAttention,
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
