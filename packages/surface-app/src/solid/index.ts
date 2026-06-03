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
  type JSX,
  useContext,
} from "solid-js";
import {
  buildInfo as defaultBuildInfo,
  type BuildInfoDef,
} from "../surface.ts";

/** Whether the SW API is exposed (any secure context — incl. localhost + the
 *  Chrome insecure-origin flag). The right gate for retirement: a worker on such
 *  an origin is removable here, where a `protocol === "https:"` check would
 *  wrongly skip it (the bug that orphaned kolu's worker). */
const swApiAvailable =
  typeof navigator !== "undefined" && "serviceWorker" in navigator;

/** Unregister every service worker on this origin and delete its caches. Run on
 *  load so a browser left with a legacy worker self-heals; pairs with the
 *  package's self-destructing `SW_SOURCE`. No-op where the SW API isn't exposed. */
export function retireServiceWorker(): void {
  if (!swApiAvailable) return;
  void navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const r of regs) void r.unregister();
  });
  if (typeof caches !== "undefined") {
    void caches.keys().then((keys) => {
      for (const key of keys) void caches.delete(key);
    });
  }
}

/** Apply the latest build: a plain reload. With no SW and a `no-store` shell,
 *  this always fetches the current `index.html` — and thus the current bundle. */
export function reloadForUpdate(): void {
  location.reload();
}

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
 *  not a transient drop). Kept distinct from build identity (`commit`). */
export interface ServerProbe {
  processId: string;
}

/** The transport surface-app observes — `WebSocket` / `PartySocket` both fit. */
export interface WsLike {
  addEventListener(type: "open" | "close", listener: () => void): void;
}

function statusOf(kind: ServerLifecycleEvent["kind"]): ConnectionStatus {
  switch (kind) {
    case "connecting":
      return "reconnecting";
    case "disconnected":
      return "down";
    case "restarted":
      return "restarted";
    default:
      return "live"; // connected | reconnected
  }
}

/** Derive the server lifecycle from a transport + an identity probe — the generic
 *  form of kolu's `rpc.ts`. On each `open` the probe reads the server's
 *  `processId`: the first connect is `connected`; a later one is `reconnected`
 *  (same id) or `restarted` (changed). A `close` after the first connect is
 *  `disconnected`. Run inside a reactive owner (e.g. `<SurfaceAppProvider>`). */
export function createServerLifecycle(opts: {
  ws: WsLike;
  probe: () => Promise<ServerProbe>;
}): {
  lifecycle: Accessor<ServerLifecycleEvent>;
  status: Accessor<ConnectionStatus>;
  serverProcessId: Accessor<string | undefined>;
} {
  const [lifecycle, setLifecycle] = createSignal<ServerLifecycleEvent>({
    kind: "connecting",
  });
  let connectCount = 0;
  let knownProcessId: string | null = null;
  opts.ws.addEventListener("open", () => {
    connectCount++;
    const isFirst = connectCount === 1;
    opts
      .probe()
      .then(({ processId }) => {
        if (isFirst) {
          knownProcessId = processId;
          setLifecycle({ kind: "connected", processId });
          return;
        }
        const restarted =
          knownProcessId !== null && processId !== knownProcessId;
        knownProcessId = processId;
        setLifecycle({
          kind: restarted ? "restarted" : "reconnected",
          processId,
        });
      })
      .catch(() => {
        // The next `open` retries; don't transition on a failed probe.
      });
  });
  opts.ws.addEventListener("close", () => {
    if (connectCount > 0) setLifecycle({ kind: "disconnected" });
  });
  return {
    lifecycle,
    status: () => statusOf(lifecycle().kind),
    serverProcessId: () => {
      const e = lifecycle();
      return "processId" in e ? e.processId : undefined;
    },
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

// biome-ignore lint/suspicious/noExplicitAny: surface's bound cell `.use()` is an authority-discriminated overload union that a minimal structural shape can't satisfy; the runtime path (cells.buildInfo.use().value()) is stable. Typing this against surface's exported SurfaceClient is a ship-time hardening.
type ControlPlane = any;

const SurfaceAppContext = createContext<SurfaceAppModel>();

export interface SurfaceAppProviderProps<T extends { commit: string }> {
  /** Your control-plane surface client (the one carrying the global buildInfo
   *  cell — for a many-client app, not a per-entity client). */
  controlPlane: ControlPlane;
  /** This client's baked-in commit (your bundler define — e.g. injected by the
   *  surface-app commit stamp as `__SURFACE_APP_COMMIT__`). */
  clientCommit: string;
  /** The build-identity fragment — defaults to `{ commit }`. Pass your extended
   *  one (e.g. kolu's pty-host axis) to drive `stale` off it. */
  buildInfo?: BuildInfoDef<T>;
  /** The WebSocket transport. surface-app derives the connection lifecycle from
   *  its open/close; pair with `probe` to tell a transient drop from a restart.
   *  Omit both and `status()` stays `"live"`. */
  ws?: WsLike;
  /** Reads the server's `processId` on each (re)connect — distinguishes
   *  `reconnected` from `restarted`. Pair with `ws`. */
  probe?: () => Promise<ServerProbe>;
  children: JSX.Element;
}

const baseTitle = typeof document !== "undefined" ? document.title : "";

function setAttention(count: number): void {
  // OS app badge — installed Chromium (Win/macOS) etc.; no-op elsewhere. Do not
  // gate on install state — feature-detect and call; if it works, it works.
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (count > 0) void nav.setAppBadge?.(count).catch(() => {});
  else void nav.clearAppBadge?.().catch(() => {});
  // Document title — the universal fallback (the in-browser-tab case).
  if (typeof document !== "undefined") {
    document.title = count > 0 ? `(${count}) ${baseTitle}` : baseTitle;
  }
}

/** Provide the headless app-shell model to the tree. Render your chrome from
 *  `useSurfaceApp()` underneath it. */
export function SurfaceAppProvider<T extends { commit: string }>(
  props: SurfaceAppProviderProps<T>,
): JSX.Element {
  const def = (props.buildInfo ?? defaultBuildInfo) as BuildInfoDef<T>;
  const cell = props.controlPlane.cells.buildInfo.use({
    initial: def.cells.buildInfo.default,
  });
  const server = () => cell.value() as T | undefined;
  // Derive the connection lifecycle in-library (kolu's rpc.ts, encapsulated):
  // open/close from the transport + a processId probe for reconnected-vs-restarted.
  const status: Accessor<ConnectionStatus> =
    props.ws && props.probe
      ? createServerLifecycle({ ws: props.ws, probe: props.probe }).status
      : () => "live";
  const model: SurfaceAppModel<T> = {
    status,
    stale: () =>
      def.isStale(server() ?? def.cells.buildInfo.default, props.clientCommit),
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
