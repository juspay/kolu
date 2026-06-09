/**
 * @kolu/surface-app/server — the Hono glue that serves the shell fresh.
 *
 * `installFreshStatic` is the freshness contract on the wire: no-store shell,
 * immutable hashed assets, 404 on an asset miss (never the HTML shell), the
 * `/sw.js` worker (self-destructing by default; the fetch-less notification
 * worker when `serviceWorker: "notify"`), and the SPA fallback. `installPwaManifest` serves
 * the desktop-app manifest. `installSurfaceApp` wires both in the common order.
 * `buildInfoServer` is the buildInfo cell's server impl; `surfaceAppServer`
 * bundles it with the `identity.info` probe impl as the deps a consumer drops
 * into an `implementSurfaces` entry — surface-app is served as a SIBLING surface,
 * not merged into the app surface. Register your `/rpc/*` (surface) routes
 * BEFORE the static installers — the static catch-all is last.
 */

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import {
  ASSET_MISS_CACHE_CONTROL,
  cacheControlFor,
  type FreshnessPaths,
  isImmutableAssetPath,
  NOTIFICATION_SW_SOURCE,
  rejectStaleProcess,
  SERVER_PROCESS_ID_PARAM,
  SHELL_CACHE_CONTROL,
  STALE_PROCESS_CLOSE_CODE,
  SW_SOURCE,
} from "./index";
import type { BuildInfo } from "./surface";
import { resolveCommit } from "./vite";

/** Which worker the `/sw.js` route serves — and which page-side lifecycle call
 *  it pairs with. `"retire"` (default) serves the self-destructing `SW_SOURCE`
 *  for the no-worker class of app (pair with `retireServiceWorker()`). `"notify"`
 *  serves the fetch-less `NOTIFICATION_SW_SOURCE` so the app can show OS
 *  notifications (pair with `registerServiceWorker()`). */
export type ServiceWorkerMode = "retire" | "notify";

const SW_SOURCE_FOR: Record<ServiceWorkerMode, string> = {
  retire: SW_SOURCE,
  notify: NOTIFICATION_SW_SOURCE,
};

/** A web app manifest. `name` is required; everything else has a sensible
 *  default, and any extra fields (id, description, orientation, screenshots,
 *  maskable icons, …) pass straight through — real manifests are richer than
 *  three fields. */
export interface ManifestOptions {
  name: string;
  short_name?: string;
  themeColor?: string;
  backgroundColor?: string;
  icons?: { src: string; sizes: string; type: string; purpose?: string }[];
  [extra: string]: unknown;
}

/** Stamp the freshness `Cache-Control` policy onto a Hono app and serve the SPA
 *  from `root`. Serves the `/sw.js` worker itself (no-cache); a `/assets/*` miss
 *  404s; any other unmatched path serves the `no-store` shell so a normal reload
 *  can never replay a stale one. `serviceWorker` picks which worker `/sw.js`
 *  serves (default `"retire"`, the self-destructing one). */
export function installFreshStatic(
  app: Hono,
  opts: { root: string; serviceWorker?: ServiceWorkerMode } & FreshnessPaths,
): void {
  const root = resolve(opts.root);
  const swSource = SW_SOURCE_FOR[opts.serviceWorker ?? "retire"];
  // The `/sw.js` worker, served no-cache — registered first so the static
  // catch-all never shadows it, and so the app never hand-rolls this route.
  app.get("/sw.js", (c) => {
    c.header("Cache-Control", cacheControlFor("/sw.js")!);
    return c.body(swSource, 200, {
      "content-type": "text/javascript; charset=utf-8",
    });
  });
  app.use("/*", async (c, next) => {
    const directive = cacheControlFor(c.req.path, opts);
    if (directive) c.header("Cache-Control", directive);
    return next();
  });
  app.use("/*", serveStatic({ root }));
  app.get(
    "/*",
    (c, next) => {
      if (isImmutableAssetPath(c.req.path, opts)) {
        c.header("Cache-Control", ASSET_MISS_CACHE_CONTROL);
        return c.notFound();
      }
      c.header("Cache-Control", SHELL_CACHE_CONTROL);
      return next();
    },
    serveStatic({ root, path: "index.html" }),
  );
}

/** Serve a dynamic web app manifest. The app supplies branding; the library
 *  owns assembly + the install-friendly defaults (start_url, display). */
export function installPwaManifest(
  app: Hono,
  manifest: ManifestOptions,
  path = "/manifest.webmanifest",
): void {
  const { name, short_name, themeColor, backgroundColor, icons, ...extra } =
    manifest;
  // `c.body` (not `c.json`) so the spec-mandated `application/manifest+json`
  // content-type isn't overridden back to `application/json`.
  app.get(path, (c) =>
    c.body(
      JSON.stringify({
        name,
        short_name: short_name ?? name,
        start_url: "/",
        display: "standalone",
        theme_color: themeColor ?? "#0c0c0e",
        background_color: backgroundColor ?? "#0c0c0e",
        icons: icons ?? [],
        ...extra,
      }),
      200,
      { "content-type": "application/manifest+json" },
    ),
  );
}

/** The greenfield convenience: manifest (if given) + fresh static serving
 *  (incl. `/sw.js`), wired in the right order. Granular pieces are exported for
 *  apps that want to compose them by hand. */
export function installSurfaceApp(
  app: Hono,
  opts: {
    clientDist: string;
    manifest?: ManifestOptions;
    serviceWorker?: ServiceWorkerMode;
  } & FreshnessPaths,
): void {
  if (opts.manifest) installPwaManifest(app, opts.manifest);
  installFreshStatic(app, {
    root: opts.clientDist,
    assetPrefix: opts.assetPrefix,
    shellPaths: opts.shellPaths,
    serviceWorker: opts.serviceWorker,
  });
}

/** A build-identity source. A plain value or a sync thunk is read at
 *  construction (the cell is seeded with it); an async thunk is the boot-time
 *  axis (kolu's `system.version` over the in-process link), resolving *after*
 *  the cell is seeded with `{ commit }`. An async source may resolve a full `T`
 *  or a `Partial<T>` patch (merged onto the seed) — so an app only computes the
 *  axis it actually learns late, not the whole value again. */
export type BuildInfoSource<T extends BuildInfo> =
  | T
  | (() => T)
  | (() => Promise<T | Partial<T>>);

/** The composable cell entry `buildInfoServer` emits — spread it straight into
 *  `implementSurface`'s `cells` (`{ ...buildInfoServer() }`). It carries the
 *  surface runtime's standard cell deps (`store`, `equals`) PLUS the fragment's
 *  own async handle (`current`, `ready`, `connect`); the runtime reads only the
 *  deps it knows and ignores the rest, so the spread stays a single clean cell
 *  entry rather than leaking sibling keys into the cells map.
 *
 *  `equals` (on the entry) makes the runtime dedup every write — including
 *  kolu's post-boot `ctx.cells.buildInfo.set` — the way confStore cells do. */
export interface BuildInfoCellEntry<T extends BuildInfo> {
  store: { get: () => T; set: (value: T) => void };
  equals: (a: T, b: T) => boolean;
  /** The value the store currently holds (after any sync source resolved). */
  current: () => T;
  /** Settles once an async `buildInfo` source (if any) has been applied. When
   *  there is no async source, resolves immediately. */
  ready: Promise<void>;
  /** Drive a late-arriving (async) axis through the cell's publish path so it
   *  reaches subscribers. This is the surface runtime's cell-dep `connect`: the
   *  core fires it automatically once the `buildInfo` cell ctx is built, so a
   *  consumer serving this fragment via `implementSurfaces` never calls it. The
   *  fragment owns the seed→resolve→set composition; the app never hand-writes
   *  the `{ commit }` seed and a second `ctx.set`. A no-op (deduped) when the
   *  source was sync — nothing late to push. */
  connect: (cell: { set: (value: T) => void }) => Promise<void>;
}

/** What `buildInfoServer` returns: a one-cell map, spreadable into `cells`. */
export interface BuildInfoServerFragment<T extends BuildInfo> {
  buildInfo: BuildInfoCellEntry<T>;
}

/** The `buildInfo` cell's server implementation, as a composable fragment:
 *  `implementSurface(surface, { …, cells: { ...buildInfoServer() } })`. The
 *  commit is resolved once (env → git → `"dev"`) unless you pass one — the app
 *  never hand-writes the store or a sha.
 *
 *  An app that EXTENDS build identity (e.g. kolu's pty-host axis) passes the
 *  full value via `buildInfo` and the return type narrows to its schema `T`, so
 *  the same fragment serves both the default `{ commit }` and an extended store
 *  — no app hand-writes the cell store. When the resolved value carries a
 *  `commit`, it's used as-is (falling back to the resolved commit only if
 *  absent/empty), so the single-source-of-truth resolver still owns the sha.
 *
 *  `buildInfo` may be a plain value, a sync thunk, OR an async thunk. An async
 *  thunk is the boot-time axis: the cell is seeded synchronously with the
 *  schema-valid `default` (every required axis present — pass `default` when `T`
 *  extends `{ commit }`), the resolved value (full `T` or a `Partial<T>` patch)
 *  is folded into the store as soon as the promise
 *  settles, and `connect(ctx.cells.buildInfo)` (called once at boot) republishes
 *  it to subscribers — so the late half flows through the *same* fragment
 *  instead of a hand-written second `ctx.cells.buildInfo.set`.
 *
 *  `equals` (default `JSON.stringify` identity) is emitted on the cell entry, so
 *  the surface runtime suppresses a no-op re-publish on every write path
 *  (`connect`, a later `ctx.set`, a wire `set`) — matching kolu's
 *  confStore-backed cells. */
export function buildInfoServer<T extends BuildInfo = BuildInfo>(
  opts: {
    commit?: string;
    buildInfo?: BuildInfoSource<T>;
    /** The schema-valid base the store is seeded with — every required axis
     *  the schema declares, at its default. REQUIRED when `T` extends the
     *  default `{ commit }` with more required fields (e.g. the example's
     *  `bootId`): the first snapshot rides the wire as a full `T`, so an async
     *  source resolving only a `Partial<T>` patch can't leave a required field
     *  absent until the promise settles (which would fail the cell's output
     *  schema). Pass your fragment's `default` (`buildInfo.cells.buildInfo.default`).
     *  Omit only for the bare `{ commit }` default. */
    default?: T;
    equals?: (a: T, b: T) => boolean;
    /** Surface a failed async boot-time axis. A rejected `buildInfo` source
     *  leaves the seed in place (the skew axis still works), but the failure is
     *  no longer indistinguishable from a legitimately absent optional axis —
     *  this fires with the rejection so the app can log it / alert. */
    onError?: (err: unknown) => void;
  } = {},
): BuildInfoServerFragment<T> {
  const equals =
    opts.equals ?? ((a, b) => JSON.stringify(a) === JSON.stringify(b));
  // The seed is the schema-valid `default` (every required axis present),
  // overlaid with whatever the source gives synchronously: a plain value, a
  // sync thunk's result, or — for an async source — nothing until it lands.
  // Seeding the full `default` (not just `{ commit }`) keeps the first wire
  // snapshot a valid `T` while an async axis is still pending.
  const syncSeed =
    typeof opts.buildInfo === "function" ? undefined : opts.buildInfo;
  const seed =
    opts.default !== undefined || syncSeed !== undefined
      ? ({ ...opts.default, ...syncSeed } as Partial<T>)
      : undefined;
  const stamp = (partial: Partial<T> | undefined): T => {
    const commit = opts.commit ?? (partial?.commit || resolveCommit());
    return { ...(partial ?? ({} as Partial<T>)), commit } as T;
  };
  let value = stamp(seed);
  const store = {
    get: () => value,
    set: (next: T) => {
      value = next;
    },
  };
  // Fold a resolved value/patch into the in-memory store (the fragment's own
  // copy). Republishing to subscribers is `connect`'s job (it has the ctx
  // setter); pre-`connect` writes just update the seed the next snapshot reads.
  const fold = (resolved: T | Partial<T>): T => {
    value = stamp({ ...value, ...resolved } as Partial<T>);
    return value;
  };
  // Resolve a sync thunk eagerly; defer an async one to a single shared promise
  // so `ready` and `connect` observe the same settled value.
  let pending: Promise<T | Partial<T>> | undefined;
  if (typeof opts.buildInfo === "function") {
    const out = (opts.buildInfo as () => T | Promise<T | Partial<T>>)();
    if (out instanceof Promise) pending = out;
    else fold(out);
  }
  const ready: Promise<void> =
    pending !== undefined
      ? pending
          .then((r) => void fold(r))
          .catch((err) => {
            // A failed boot-time axis leaves the seed in place — the skew axis
            // still works; the extra axis stays at its default. `ready` still
            // resolves (the seed IS a valid `T`, and the documented contract is
            // "settles once any async source has been applied — or fallen back"),
            // so we DON'T reject it and break every `await ready` boot path.
            // But the failure must never be silent: route it to `onError` if the
            // app gave one, else fail LOUD by default — a swallowed boot probe is
            // indistinguishable from a legitimately absent optional axis, the
            // exact silent-failure this fragment exists to prevent.
            if (opts.onError) opts.onError(err);
            else
              console.error(
                "buildInfoServer: async buildInfo source rejected; serving the seeded default. Pass `onError` to handle this.",
                err,
              );
          })
      : Promise.resolve();
  return {
    buildInfo: {
      store,
      equals,
      current: () => value,
      ready,
      connect: async (cell) => {
        await ready;
        // Republish through the cell's ctx setter (which the runtime routes to
        // the bus + the `equals` dedup gate). A sync-sourced fragment has
        // nothing late to push, but re-asserting the seeded value is harmless
        // (deduped).
        cell.set(value);
      },
    },
  };
}

/** The `identity.info` probe's server implementation, as a composable
 *  fragment: it sits in `surfaceAppServer`'s `procedures` under the `identity`
 *  namespace. Mints one `processId` per process (so a reconnect to a *different*
 *  process reads as a restart) — the restart axis's turnkey counterpart to
 *  `buildInfoServer()`. Pass `processId` to override (e.g. a stable id in
 *  tests). Pairs with the surface's `identity.info` procedure and with the
 *  provider's `probe={() => client.rpc.surface.identity.info({})}` (the scoped
 *  sibling client consumes the `surfaceApp` key). */
export function serverIdentity(opts: { processId?: string } = {}): {
  /** The id this process minted (or the injected override). This is the
   *  read-back seam for a consumer that lets `serverIdentity` MINT the id
   *  internally (no external source): it captures `const { processId } =
   *  serverIdentity()` and feeds that to `rejectStaleProcess`, so the stale-tab
   *  gate and the `identity.info` probe single-source one id. A consumer that
   *  mints its own id externally (like kolu) single-sources by INJECTING it via
   *  `opts.processId` and need not read this field back. */
  processId: string;
  identity: { info: () => Promise<{ processId: string }> };
} {
  const processId = opts.processId ?? randomUUID();
  return { processId, identity: { info: async () => ({ processId }) } };
}

/** The whole surface-app server side in one call — the `buildInfo` cell impl
 *  AND the `identity.info` probe impl, shaped as the implementation DEPS bundle
 *  a consumer drops into an `implementSurfaces` entry (`{ surface:
 *  surfaceAppSurface, deps: surfaceAppServer() }`). No `channel` here —
 *  `implementSurfaces` supplies a key-namespaced channel per sibling surface.
 *
 *  The buildInfo cell entry carries `.connect` (the async boot axis — kolu's
 *  `system.version`, the example's `bootId`; a deduped no-op for the sync
 *  `{ commit }` default), which the surface runtime now fires automatically once
 *  the cell ctx is built — so there is NO app-visible connect to call. The
 *  turnkey counterpart to `surfaceAppSurfaceWith` on the surface side. */
export function surfaceAppServer<T extends BuildInfo = BuildInfo>(
  opts: Parameters<typeof buildInfoServer<T>>[0] & { processId?: string } = {},
): {
  cells: BuildInfoServerFragment<T>;
  /** The minted (or injected) per-process id — the same one the `identity.info`
   *  probe reports. This is the read-back seam for a consumer that lets
   *  `surfaceAppServer` MINT the id internally (no external source): it captures
   *  `const { processId } = surfaceAppServer(...)` and feeds that to
   *  `rejectStaleProcess`, so the stale-tab gate and the probe single-source one
   *  id (a second mint would never match). A consumer that mints its own id
   *  externally (like kolu) single-sources by INJECTING it via `opts.processId`
   *  and need not read this field back. */
  processId: string;
  procedures: { identity: { info: () => Promise<{ processId: string }> } };
} {
  const identity = serverIdentity({ processId: opts.processId });
  return {
    cells: buildInfoServer<T>(opts),
    processId: identity.processId,
    procedures: { identity: identity.identity },
  };
}

/** A server-side WebSocket the stale-tab gate acts on — the structural subset of
 *  the `ws` package's socket both kolu (single `/rpc/ws`) and drishti (per-host
 *  dispatch) upgrade. Kept structural so surface-app needn't depend on `ws`. */
export interface GateableSocket {
  on: (event: "error", listener: (err: Error) => void) => unknown;
  close: (code: number, reason?: string) => void;
}

/** Apply the stale-tab handshake gate at the WS upgrade, in the ONE correct
 *  order — so no consumer re-derives it (and re-introduces the crash kolu#1231's
 *  review caught). The three steps the server must do BEFORE oRPC upgrades the
 *  socket, encapsulated:
 *
 *   1. **Install the `error` listener FIRST.** A socket rejected in step 3 is
 *      still a live `EventEmitter` until its close handshake settles; an
 *      unhandled `error` in that window is fatal to the process. Installing it
 *      before the early return is the ordering a hand-rolled gate gets wrong —
 *      drishti's pre-extraction upgrade handler did, and only avoided the crash
 *      by luck of timing.
 *   2. **Decide via `rejectStaleProcess`**, reading the claimed `pid` off the
 *      request URL with `SERVER_PROCESS_ID_PARAM` — the param name stays internal
 *      here, single-sourced with the client echo in `./connect`.
 *   3. **On a stale tab, `close(STALE_PROCESS_CLOSE_CODE, …)`** and report `true`
 *      so the caller returns WITHOUT upgrading; `false` means proceed.
 *
 *  `liveProcessId` MUST be the id the `identity.info` probe reports
 *  (`surfaceAppServer().processId` / an externally-minted id injected into it),
 *  or the gate compares against an id the client never saw. The `error` listener
 *  is installed for ACCEPTED sockets too (it must, to survive the reject window),
 *  so it's also this socket's standing transport-error handler. `onError` thus
 *  defaults to a LOUD `console.error` (matching `buildInfoServer`) rather than a
 *  silent no-op — a swallowed transport error on an accepted socket is the exact
 *  footgun a shared helper should not bake in; pass your own logger to override,
 *  or an explicit no-op at the call site if you genuinely want silence. `onReject`
 *  logs the rejection. */
export function gateStaleSocket(
  ws: GateableSocket,
  requestUrl: URL,
  liveProcessId: string,
  opts: {
    onError?: (err: Error) => void;
    onReject?: (claimedPid: string) => void;
  } = {},
): boolean {
  ws.on(
    "error",
    opts.onError ??
      ((err) =>
        console.error(
          "gateStaleSocket: WebSocket error (pass `onError` to handle this).",
          err,
        )),
  );
  const claimedPid = requestUrl.searchParams.get(SERVER_PROCESS_ID_PARAM);
  if (claimedPid !== null && rejectStaleProcess(claimedPid, liveProcessId)) {
    opts.onReject?.(claimedPid);
    ws.close(STALE_PROCESS_CLOSE_CODE, "stale server process");
    return true;
  }
  return false;
}

/** Default server heartbeat sweep cadence. A missed pong across one 30s window
 *  is a confident dead-signal for an idle streaming socket without being chatty. */
const DEFAULT_SERVER_HEARTBEAT_INTERVAL_MS = 30_000;

/** A server-side WebSocket the liveness heartbeat acts on — the structural subset
 *  of the `ws` package's socket the reaper pings and reaps. Kept structural (the
 *  `GateableSocket` twin) so surface-app needn't depend on `ws`. `pong` is the one
 *  inbound event; `ping`/`terminate` are the outbound actions; `readyState`/`OPEN`
 *  gate the non-OPEN skip. */
export interface HeartbeatableSocket {
  readyState: number;
  readonly OPEN: number;
  ping(): void;
  terminate(): void;
  on(event: "pong", listener: () => void): unknown;
}

/** One heartbeat sweep over the accepted clients: `terminate()` any that didn't
 *  pong since the previous sweep (absent from `alive`), then `ping()` the rest
 *  and clear their flag so the NEXT sweep can detect a miss. Sockets that aren't
 *  `OPEN` are skipped — a stale tab the gate closed (before the oRPC upgrade) is
 *  mid-close and is neither pinged nor terminated here. Pure over its injected
 *  deps (no timers, no server), so it's unit-testable without a real server. */
export function heartbeatSweep(
  clients: Iterable<HeartbeatableSocket>,
  alive: WeakSet<HeartbeatableSocket>,
): void {
  for (const ws of clients) {
    if (ws.readyState !== ws.OPEN) continue;
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}

/**
 * Start the liveness heartbeat over a server's ACCEPTED sockets — the server twin
 * of `createHeartbeat` (`@kolu/surface-app/connect`) and the liveness sibling of
 * `gateStaleSocket`.
 *
 * `ws` (and partysocket on the client) ship NO application-level ping/pong, so a
 * SILENTLY half-open socket — the TCP died with no FIN/RST (a client's laptop
 * slept, Wi-Fi roamed, or a NAT/proxy evicted the idle connection) — never fires
 * `close` on the server either. The dead socket lingers in `clients` holding its
 * per-terminal stream subscriptions open forever. This is the server half of the
 * half-open fix; the client half (`createHeartbeat`) is what un-freezes a stuck
 * tab. Here we ping accepted clients on an interval and `terminate()` any that
 * didn't pong since the last sweep, reaping the server-side zombie.
 *
 * `register(ws)` is called once per accepted connection (AFTER `gateStaleSocket`)
 * — it marks the socket alive and wires its `pong` to re-mark it. Liveness lives
 * in a `WeakSet` the caller re-adds to on every `pong`, NOT monkey-patched onto
 * the socket. The stale-tab gate runs AFTER the ws upgrade accepted the socket
 * but BEFORE the oRPC upgrade and this registration, so a rejected stale tab never
 * enrols here (it is closing) and kolu#1231's protection is untouched — the
 * non-OPEN skip in `heartbeatSweep` covers the brief window it lingers in
 * `clients` while that close settles.
 *
 * Pass the server's accepted-socket population as `{ clients }` (a `ws`
 * `WebSocketServer` IS one structurally) so surface-app keeps its no-`ws`-dependency
 * stance. The interval is `unref`'d so the heartbeat never keeps the process alive
 * on its own. Returns `stop()` to clear the interval.
 */
export function startWsHeartbeat(
  server: { clients: Iterable<HeartbeatableSocket> },
  opts: { intervalMs?: number } = {},
): { register: (ws: HeartbeatableSocket) => void; stop: () => void } {
  const alive = new WeakSet<HeartbeatableSocket>();
  /** Call exactly once per accepted socket — it attaches a `pong` listener with
   *  no removal path (the listener dies with the socket); a second call would
   *  attach a duplicate handler. */
  const register = (ws: HeartbeatableSocket): void => {
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));
  };
  const handle = setInterval(
    () => heartbeatSweep(server.clients, alive),
    opts.intervalMs ?? DEFAULT_SERVER_HEARTBEAT_INTERVAL_MS,
  );
  handle.unref?.();
  return { register, stop: () => clearInterval(handle) };
}
