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
  /** Optional live connection status, if your transport exposes one; defaults
   *  to `"live"`. */
  status?: Accessor<ConnectionStatus>;
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
  const status: Accessor<ConnectionStatus> = props.status ?? (() => "live");
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
