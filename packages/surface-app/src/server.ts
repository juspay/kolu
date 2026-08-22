/**
 * @kolu/surface-app/server — the Effect HTTP layers that serve the shell fresh.
 *
 * `freshStaticLayer` is the freshness contract on the wire: no-store shell,
 * immutable hashed assets, 404 on an asset miss (never the HTML shell), the
 * `/sw.js` worker (self-destructing by default; the fetch-less notification
 * worker when `serviceWorker: "notify"`), and the SPA fallback. `pwaManifestLayer`
 * serves the desktop-app manifest. `surfaceAppLayer` merges both.
 * `buildInfoServer` is the buildInfo cell's server impl; `surfaceAppServer` shapes
 * it as the deps a consumer drops into an `implementSurfaces` entry — surface-app
 * is served as a SIBLING surface, not merged into the app surface. The restart
 * axis is NOT here: a process's identity is the framework's reserved
 * `system/identity` member (`@kolu/surface/identity`), which every surface answers.
 *
 * These are `HttpRouter` LAYERS, not `app.use(...)` installers: registration
 * order carries no meaning any more. `HttpRouter` ranks routes by specificity
 * (find-my-way), so a `/rpc/*` route beats the static `GET /*` catch-all no
 * matter which layer is merged first — the ordering footgun the Hono installers
 * documented is gone by construction.
 */

import { resolve } from "node:path";
import { rpcSerializationLayer } from "@kolu/surface/frame-limit";
import { surfaceProcessId } from "@kolu/surface/identity";
import {
  type CellConnector,
  type SurfaceHandlers,
  surfaceRpcServerLayer,
} from "@kolu/surface/server";
import { Effect, Exit, type FileSystem, Layer, type Path, Scope } from "effect";
import {
  Headers,
  type HttpPlatform,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/unstable/http";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { RpcServer } from "effect/unstable/rpc";
import { Socket, SocketServer } from "effect/unstable/socket";
import {
  assertAssetPrefix,
  ASSET_MISS_CACHE_CONTROL,
  cacheControlFor,
  DEFAULT_ASSET_PREFIX,
  DEFAULT_SHELL_PATHS,
  type FreshnessPaths,
  isImmutableAssetPath,
  NOTIFICATION_SW_SOURCE,
  PRECOMPRESSED_ENCODINGS,
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

/** Content types worth serving a precompressed sibling for. Ported VERBATIM from
 *  `@hono/node-server`'s `serve-static` (its `COMPRESSIBLE_CONTENT_TYPE_REGEX`),
 *  because it is the behaviour this layer replaces: without it an
 *  already-compressed asset (a `woff2`, a `png`) whose build wrongly emitted a
 *  `.br` sibling would start being served doubly-compressed. Paired with the
 *  "unknown or `application/octet-stream` also compresses" arm below, exactly as
 *  the original had it. */
const COMPRESSIBLE_CONTENT_TYPE =
  /^\s*(?:text\/[^;\s]+|application\/(?:javascript|json|xml|xml-dtd|ecmascript|dart|postscript|rtf|tar|toml|vnd\.dart|vnd\.ms-fontobject|vnd\.ms-opentype|wasm|x-httpd-php|x-javascript|x-ns-proxy-autoconfig|x-sh|x-tar|x-virtualbox-hdd|x-virtualbox-ova|x-virtualbox-ovf|x-virtualbox-vbox|x-virtualbox-vdi|x-virtualbox-vhd|x-virtualbox-vmdk|x-www-form-urlencoded)|font\/(?:otf|ttf)|image\/(?:bmp|vnd\.adobe\.photoshop|vnd\.microsoft\.icon|vnd\.ms-dds|x-icon|x-ms-bmp)|message\/rfc822|model\/gltf-binary|x-shader\/x-fragment|x-shader\/x-vertex|[^;\s]+?\+(?:json|text|xml|yaml))(?:[;\s]|$)/i;

/** The conditional-request headers this layer refuses to honour. The Hono
 *  `serve-static` it replaces emitted NO `ETag` and answered NO `304` — a
 *  `no-store` shell that starts answering `304` is a freshness-contract change of
 *  exactly the kolu#1319 family, and the platform's weak validator is
 *  `mtime`+`size`, which in a Nix store (every mtime pinned to the epoch)
 *  collides across two builds of a same-size shell. So the conditionals are
 *  stripped off the request before the file engine sees them: every response is a
 *  full `200`, as before. */
const CONDITIONAL_HEADERS = ["if-none-match", "if-modified-since"];

/** The request target minus query/fragment, WITHOUT decoding — the classifier
 *  input (`cacheControlFor` / `isImmutableAssetPath` read a path prefix) and the
 *  target handed back to the file engine, which owns the single decode. */
const pathnameOf = (url: string): string => {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
};

/** Serve the SPA from `root` with the freshness `Cache-Control` policy stamped
 *  on every response. Serves the `/sw.js` worker itself (no-cache); a
 *  `/assets/*` miss 404s; any other unmatched path serves the `no-store` shell so
 *  a normal reload can never replay a stale one. `serviceWorker` picks which
 *  worker `/sw.js` serves (default `"retire"`, the self-destructing one).
 *
 *  The bytes come from `HttpStaticServer` (Effect's own file engine: MIME table,
 *  byte ranges, directory→index, root containment) so this module owns ONLY the
 *  freshness policy — the part that is surface-app's, and the part four
 *  stale-client regressions were fought over. The platform services it needs
 *  (`FileSystem`, `Path`, `HttpPlatform`) are the consumer's to provide —
 *  `NodeHttpServer.layerHttpServices` on Node. */
export function freshStaticLayer(
  opts: { root: string; serviceWorker?: ServiceWorkerMode } & FreshnessPaths,
): Layer.Layer<
  never,
  never,
  | HttpRouter.HttpRouter
  | FileSystem.FileSystem
  | Path.Path
  | HttpPlatform.HttpPlatform
> {
  const root = resolve(opts.root);
  const swSource = SW_SOURCE_FOR[opts.serviceWorker ?? "retire"];
  // Precompressed siblings (`.br`/`.zst`/`.gz`) are negotiated ONLY under the
  // immutable hashed-asset prefix, never the shell. Even if a consumer's build
  // wrongly emitted an `index.html.br`, the shell can never go out compressed and
  // pin returning browsers to a stale post-build stamp (kolu#1319). The whole
  // payload win is the `/assets/*` bundle (~2.56 MB → ~571 kB), so scoping costs
  // nothing; a consumer that precompresses nothing serves byte-identical identity
  // responses either way.
  // Taking the prefix is where its shape is judged, by the same reading the
  // Bun build takes it through (`assertAssetPrefix`) — so `/assetsX` without
  // its trailing slash cannot silently pin `/assetsXtra/` immutable here while
  // no build would ever have written there.
  const assetPrefix = assertAssetPrefix(
    opts.assetPrefix ?? DEFAULT_ASSET_PREFIX,
  );
  // That guarantee holds ONLY while `assetPrefix` is disjoint from the shell — a
  // caller-supplied `assetPrefix: "/"` (or `""`) would put `/index.html` under
  // negotiation too and re-open the exact kolu#1319 stale-stamp footgun.
  // `assetPrefix` is a public, overridable input, so assert the invariant
  // fail-fast (the file's no-fallback philosophy) rather than trust its shape: if
  // any shell path is classified as an immutable asset, the prefix captures the
  // shell and this is a misconfiguration, not a degraded mode. Thrown from the
  // layer CONSTRUCTOR, not its build, so a misconfigured app dies where it is
  // composed rather than mid-boot.
  const shellPaths = opts.shellPaths ?? DEFAULT_SHELL_PATHS;
  if (shellPaths.some((p) => isImmutableAssetPath(p, opts))) {
    throw new Error(
      `freshStaticLayer: assetPrefix ${JSON.stringify(assetPrefix)} captures a shell path (${JSON.stringify(shellPaths)}); it must be a non-root sub-path disjoint from the shell, or a compressed index.html sibling could be served and pin returning browsers to a stale post-build stamp (kolu#1319).`,
    );
  }
  return HttpRouter.use((router) =>
    Effect.gen(function* () {
      // `orDie`: a file engine that cannot even be constructed for this root is a
      // misconfiguration, and a boot that limps on without static serving is the
      // silent degradation this package exists to refuse.
      const files = yield* Effect.orDie(HttpStaticServer.make({ root }));

      /** Serve one target under `root`, or `undefined` when there is no such
       *  file. Anything that is NOT a plain miss (a permission error, an unreadable
       *  root) is a defect — it must never masquerade as a 404 and fall through to
       *  the shell. */
      const serveAt = (
        request: HttpServerRequest.HttpServerRequest,
        target: string,
      ): Effect.Effect<HttpServerResponse.HttpServerResponse | undefined> =>
        files.pipe(
          Effect.provideService(
            HttpServerRequest.HttpServerRequest,
            request.modify({ url: target }),
          ),
          Effect.catch((error) =>
            error.reason._tag === "RouteNotFound"
              ? Effect.succeed(undefined)
              : Effect.die(error),
          ),
        );

      /** Swap in a build-time precompressed sibling when the client accepts one
       *  and it exists: the sibling's bytes, the ORIGINAL's `Content-Type`, the
       *  matching `Content-Encoding`, and an appended `Vary`. Identity otherwise —
       *  no sibling, a declining client, or an already-compressed media type. */
      const negotiate = (
        request: HttpServerRequest.HttpServerRequest,
        target: string,
        identity: HttpServerResponse.HttpServerResponse,
      ): Effect.Effect<HttpServerResponse.HttpServerResponse> =>
        Effect.gen(function* () {
          const contentType = identity.headers["content-type"];
          if (
            contentType !== undefined &&
            contentType !== "application/octet-stream" &&
            !COMPRESSIBLE_CONTENT_TYPE.test(contentType)
          ) {
            return identity;
          }
          // Membership in the comma-split token set, in SERVER preference order —
          // no q-value parsing, matching the `serve-static` this replaced (a
          // `br;q=0` token is simply not the string `br`, so it never matches).
          const accepted = new Set(
            (request.headers["accept-encoding"] ?? "")
              .split(",")
              .map((token) => token.trim()),
          );
          for (const [encoding, suffix] of PRECOMPRESSED_ENCODINGS) {
            if (!accepted.has(encoding)) continue;
            const sibling = yield* serveAt(request, target + suffix);
            if (sibling === undefined) continue;
            const vary = sibling.headers.vary;
            return HttpServerResponse.setHeaders(sibling, {
              // The sibling's own name would type it `application/octet-stream`;
              // the representation is still the original's.
              "content-type": contentType ?? "application/octet-stream",
              "content-encoding": encoding,
              vary:
                vary === undefined
                  ? "Accept-Encoding"
                  : `${vary}, Accept-Encoding`,
            });
          }
          return identity;
        });

      /** Stamp the freshness directive LAST, so it wins over anything the file
       *  engine set. `null` (no opinion — a root-level asset that is neither shell
       *  nor hashed) leaves the response header-free, as before. */
      const stamp = (
        path: string,
        response: HttpServerResponse.HttpServerResponse,
      ): HttpServerResponse.HttpServerResponse => {
        const directive = cacheControlFor(path, opts);
        return directive === null
          ? response
          : HttpServerResponse.setHeader(response, "cache-control", directive);
      };

      const handler = (
        request: HttpServerRequest.HttpServerRequest,
      ): Effect.Effect<HttpServerResponse.HttpServerResponse> =>
        Effect.gen(function* () {
          const path = pathnameOf(request.url);
          const plain = request.modify({
            headers: Headers.removeMany(request.headers, CONDITIONAL_HEADERS),
          });
          const hit = yield* serveAt(plain, path);
          if (isImmutableAssetPath(path, opts)) {
            // A hashed-asset miss 404s and that 404 is itself uncacheable — it must
            // NEVER fall through to the HTML shell, which under a `.js` URL is the
            // wrong MIME and would be pinned `immutable` for a year.
            if (hit === undefined) {
              return HttpServerResponse.text("not found", {
                status: 404,
                headers: { "cache-control": ASSET_MISS_CACHE_CONTROL },
              });
            }
            return stamp(path, yield* negotiate(plain, path, hit));
          }
          if (hit !== undefined) return stamp(path, hit);
          // Every other unmatched path serves the shell — including one that LOOKS
          // like a file (`/favicon.png`). The directive is spelled explicitly
          // because `cacheControlFor` has no opinion about e.g. `/t/abc`, and the
          // shell must never go out cacheable.
          const shell = yield* serveAt(plain, "/");
          return HttpServerResponse.setHeader(
            shell ?? HttpServerResponse.text("not found", { status: 404 }),
            "cache-control",
            SHELL_CACHE_CONTROL,
          );
        });

      // The `/sw.js` worker, served no-cache from the shared constant — the app
      // never hand-rolls this route, and no static file can shadow it (a literal
      // route outranks the `/*` catch-all).
      yield* router.add(
        "GET",
        "/sw.js",
        HttpServerResponse.text(swSource, {
          contentType: "text/javascript; charset=utf-8",
          headers: { "cache-control": cacheControlFor("/sw.js")! },
        }),
      );
      yield* router.add("GET", "/*", handler);
    }),
  );
}

/** Serve a dynamic web app manifest. The app supplies branding; the library
 *  owns assembly + the install-friendly defaults (start_url, display). */
export function pwaManifestLayer(
  manifest: ManifestOptions,
  path: HttpRouter.PathInput = "/manifest.webmanifest",
): Layer.Layer<never, never, HttpRouter.HttpRouter> {
  const { name, short_name, themeColor, backgroundColor, icons, ...extra } =
    manifest;
  // `text` with an explicit `contentType` (not `json`) so the spec-mandated
  // `application/manifest+json` isn't overridden back to `application/json`.
  return HttpRouter.add(
    "GET",
    path,
    HttpServerResponse.text(
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
      { contentType: "application/manifest+json" },
    ),
  );
}

/** What the shell half of a surface app is: where the built bundle is, whether
 *  the app installs, which `/sw.js` it serves, and the freshness paths. Named
 *  here — where `surfaceAppLayer` lives — so `serveSurfaceApp` can EXTEND it
 *  rather than re-spell it: a new shell option is then one edit, not three. */
export interface SurfaceAppLayerOptions extends FreshnessPaths {
  /** The built browser bundle, served fresh — ABSENT in dev, where a bundler
   *  (Vite) serves the client on its own port and proxies the app's routes here.
   *  A missing dist is NO static route, never a degraded one: an unmatched path
   *  404s through the router's own `RouteNotFound`. */
  readonly clientDist?: string;
  /** The web app manifest, if this app installs. */
  readonly manifest?: ManifestOptions;
  /** Which `/sw.js` worker to serve (default `"retire"`). */
  readonly serviceWorker?: ServiceWorkerMode;
}

/** The shell half of a surface app: the manifest (when the app installs) plus
 *  fresh static serving (incl. `/sw.js`) of the built bundle (when there is
 *  one), in one layer.
 *
 *  The two halves are mounted INDEPENDENTLY, and that is the point rather than a
 *  detail: kolu serves its manifest unconditionally (its dev proxy forwards
 *  `/manifest.webmanifest` to a server with no built client) and its statics only
 *  in production. While this layer PAIRED them, kolu had to hand-compose
 *  `pwaManifestLayer` + `freshStaticLayer` to say that — which is exactly the
 *  hand-wiring `serveSurfaceApp` exists to end. The granular layers stay exported
 *  for an app that mounts them at paths of its own. */
export function surfaceAppLayer(
  opts: SurfaceAppLayerOptions,
): Layer.Layer<
  never,
  never,
  | HttpRouter.HttpRouter
  | FileSystem.FileSystem
  | Path.Path
  | HttpPlatform.HttpPlatform
> {
  const statics =
    opts.clientDist === undefined
      ? Layer.empty
      : freshStaticLayer({
          root: opts.clientDist,
          assetPrefix: opts.assetPrefix,
          shellPaths: opts.shellPaths,
          serviceWorker: opts.serviceWorker,
        });
  return opts.manifest === undefined
    ? statics
    : Layer.merge(pwaManifestLayer(opts.manifest), statics);
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
   *  source was sync — nothing late to push.
   *
   *  The framework's {@link CellConnector}: a scoped effect the runtime owns, so
   *  a `close()` while the async source is still in flight interrupts the wait
   *  instead of publishing into a torn-down cell. */
  connect: CellConnector<T>;
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
      connect: (cell) =>
        Effect.flatMap(
          Effect.promise(() => ready),
          () =>
            Effect.sync(() => {
              // Republish through the cell's ctx setter (which the runtime routes
              // to the bus + the `equals` dedup gate). A sync-sourced fragment has
              // nothing late to push, but re-asserting the seeded value is
              // harmless (deduped).
              cell.set(value);
            }),
        ),
    },
  };
}

// `serverIdentity()` is GONE, and with it surface-app's `identity.info` member.
// It minted a SECOND per-process id beside the framework's, and every consumer
// then owed the plumbing that kept the two in step: read the id back, hand it to
// the gate, and hope the client was probing the same member the gate compared
// against. `@kolu/surface`'s reserved `system/identity` answers `processId` now
// (`surfaceProcessId()`), the client-side echo probes exactly that, and
// `gateStaleSocket` compares against exactly that. One id, one member, no plumbing
// — and an app (olai#61) that would otherwise have declared its own `identity.info`
// because the reserved member reported only a start TIME does not have to.

/** The whole surface-app server side in one call — the `buildInfo` cell impl,
 *  shaped as the implementation DEPS bundle a consumer drops into an
 *  `implementSurfaces` entry (`{ surface: surfaceAppSurface, deps:
 *  surfaceAppServer() }`). No `channel` here — `implementSurfaces` supplies a
 *  key-namespaced channel per sibling surface.
 *
 *  The buildInfo cell entry carries `.connect` (the async boot axis — kolu's
 *  `system.version`, the example's `bootId`; a deduped no-op for the sync
 *  `{ commit }` default), which the surface runtime now fires automatically once
 *  the cell ctx is built — so there is NO app-visible connect to call. The
 *  turnkey counterpart to `surfaceAppSurfaceWith` on the surface side. */
export function surfaceAppServer<T extends BuildInfo = BuildInfo>(
  opts: Parameters<typeof buildInfoServer<T>>[0] = {},
): {
  cells: BuildInfoServerFragment<T>;
} {
  return { cells: buildInfoServer<T>(opts) };
}

/** A server-side WebSocket the stale-tab gate acts on — the structural subset of
 *  the `ws` package's socket both kolu (single `/rpc/ws`) and drishti (per-host
 *  dispatch) upgrade.
 *
 *  **Why structural, now that the package DOES depend on `ws`.** `./serve` needs
 *  a real `WebSocketServer` — it owns the upgrade — so `ws` is a dependency of
 *  the package. It is not a dependency of this module or of any browser-facing
 *  entry point (`.`, `./solid`, `./connect`, `./client`, `./lifecycle`), and a
 *  nominal `ws` type here would put it in their import graph. Structural also
 *  keeps the seam open to a server socket that is not `ws`'s at all (Bun's,
 *  Deno's), which is a real axis for a package two runtimes consume. The same
 *  reason holds for {@link HeartbeatableSocket} and {@link ServableSocket}. */
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
 *   2. **Decide**, reading the claimed `pid` off the request URL with
 *      `SERVER_PROCESS_ID_PARAM` — the param name stays internal here,
 *      single-sourced with the client echo in `./connect` — and comparing it
 *      against {@link surfaceProcessId}. An absent `pid` (the first-ever connect,
 *      before the client observed an identity) always passes.
 *   3. **On a stale tab, `close(STALE_PROCESS_CLOSE_CODE, …)`** and report `true`
 *      so the caller returns WITHOUT upgrading; `false` means proceed.
 *
 *  There is no `liveProcessId` parameter. There used to be, and it was the gate's
 *  one real hazard: the id it compared against was whatever a consumer passed, so a
 *  consumer that minted a second id — or passed the one its logs used — built a
 *  gate that rejected every reconnect, or none, with nothing to notice it by. The
 *  live id is this process's `surfaceProcessId()`, which is also exactly what the
 *  reserved `system/identity` member answers and therefore exactly what the client
 *  echoes back. The two sides cannot be pointed at different strings.
 *
 *  The `error` listener is installed for ACCEPTED sockets too (it must, to survive
 *  the reject window), so it's also this socket's standing transport-error handler.
 *  `onError` thus defaults to a LOUD `console.error` (matching `buildInfoServer`)
 *  rather than a silent no-op — a swallowed transport error on an accepted socket
 *  is the exact footgun a shared helper should not bake in; pass your own logger to
 *  override, or an explicit no-op at the call site if you genuinely want silence.
 *  `onReject` logs the rejection. */
export function gateStaleSocket(
  ws: GateableSocket,
  requestUrl: URL,
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
  if (claimedPid !== null && claimedPid !== surfaceProcessId()) {
    // Close FIRST (the critical operation), then fire the observational
    // `onReject` — a throwing reporter must never leave the stale tab connected.
    ws.close(STALE_PROCESS_CLOSE_CODE, "stale server process");
    opts.onReject?.(claimedPid);
    return true;
  }
  return false;
}

/** Default server heartbeat sweep cadence. A missed pong across one 30s window
 *  is a confident dead-signal for an idle streaming socket without being chatty.
 *  Must comfortably exceed the client's worst-case recovery (createHeartbeat's
 *  intervalMs + timeoutMs, ~25s) so the client's reconnect wins the race and this
 *  reaper never terminates a socket the client is about to revive. */
export const DEFAULT_SERVER_HEARTBEAT_INTERVAL_MS = 30_000;

/** A server-side WebSocket the liveness heartbeat acts on — the structural subset
 *  of the `ws` package's socket the reaper pings and reaps. Structural for the
 *  reason spelled out on {@link GateableSocket}, its twin. `pong` is the one
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
 * `ws` (and the browser leg's own socket) ship NO application-level ping/pong, so a
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

/** The single seam an accepted WS passes through: stale-tab gate → enrol in the
 *  liveness reaper → dispatch — in the one correct order, sequenced so an app
 *  CANNOT do any one without the others. `acceptSurfaceSocket` returns this. */
export interface SurfaceSocketAcceptor {
  /** Gate (stale-tab), then enrol the socket in the liveness reaper, then run
   *  `onAccepted` (the app's dispatch — `handler.upgrade(ws)`, possibly per-host).
   *  A stale tab is closed and `onAccepted` NEVER runs (a closing socket is never
   *  enrolled or dispatched). Call exactly once per socket the WS server accepts,
   *  inside the `handleUpgrade` callback. */
  accept(
    ws: GateableSocket & HeartbeatableSocket,
    requestUrl: URL,
    onAccepted: () => void,
  ): void;
  /** Stop the liveness heartbeat — call on server shutdown. */
  stop(): void;
}

/**
 * The server-side acceptance seam: own the liveness heartbeat for a WS server
 * AND bundle the per-socket `gateStaleSocket` → `register` → dispatch into one
 * sequenced `accept(...)` call — the server twin of the client's `connectSurface`
 * / `createServerLifecycle` default-on heartbeat.
 *
 * Why this exists: a server used to hand-wire THREE separable, order-sensitive
 * steps — `startWsHeartbeat(wss)`, then per accepted socket `gateStaleSocket(...)`
 * and `heartbeat.register(ws)` in the right order before `handler.upgrade(ws)`.
 * Forgetting `register` leaks a half-open browser as a server-side zombie holding
 * stream subscriptions open forever; doing the steps out of order reintroduces
 * kolu#1231's crash. This collapses the heartbeat lifecycle (owned internally —
 * no `startWsHeartbeat` call to forget) and the per-socket gate+enrol into one
 * call, so a socket cannot be dispatched without first being gated and enrolled.
 *
 * Structural, like `gateStaleSocket`/`startWsHeartbeat` (see {@link GateableSocket}
 * for why this module stays off `ws` even though `./serve` does not):
 * `accept`'s socket is `GateableSocket & HeartbeatableSocket`, which every real
 * `ws` socket satisfies. The pieces that stay at the call site are the genuinely
 * app-specific ones the seam can't generically own: the **origin gate**
 * (`gateWsOrigin`, which acts on the raw pre-upgrade socket/request — a different
 * phase) and the **dispatch** itself (`?host=` routing, an `__admin__` sentinel)
 * — supplied as the `onAccepted` closure. The stale-tab gate needs no id from the
 * caller: it compares against this process's own `surfaceProcessId()`.
 */
export function acceptSurfaceSocket(opts: {
  /** The WS server whose accepted-socket population the reaper sweeps (a `ws`
   *  `WebSocketServer` IS this structurally). */
  server: { clients: Iterable<HeartbeatableSocket> };
  /** Heartbeat sweep cadence (defaults to `startWsHeartbeat`'s 30s). */
  intervalMs?: number;
  /** Standing transport-error handler installed on every accepted socket by the
   *  stale gate (defaults to a loud `console.error`, like `gateStaleSocket`). The
   *  socket's upgrade `requestUrl` is passed alongside the error so a multi-host
   *  server can re-derive its `?host=` for the log line (a single-socket consumer
   *  ignores it). */
  onError?: (err: Error, requestUrl: URL) => void;
  /** Report a rejected stale tab (the claimed `pid` no longer matches). The
   *  upgrade `requestUrl` is passed alongside for the same per-host log context. */
  onReject?: (claimedPid: string, requestUrl: URL) => void;
}): SurfaceSocketAcceptor {
  const heartbeat = startWsHeartbeat(opts.server, {
    intervalMs: opts.intervalMs,
  });
  return {
    accept(ws, requestUrl, onAccepted) {
      // Stale-tab gate FIRST (installs the `error` listener, closes a stale tab).
      // A rejected socket is closing — never enrol or dispatch it. The per-socket
      // callbacks carry `requestUrl` so a fleet server keeps its per-host context.
      if (
        gateStaleSocket(ws, requestUrl, {
          onError: opts.onError && ((err) => opts.onError?.(err, requestUrl)),
          onReject:
            opts.onReject && ((pid) => opts.onReject?.(pid, requestUrl)),
        })
      ) {
        return;
      }
      // Enrol in the liveness reaper, THEN dispatch — sequenced so a socket can't
      // be dispatched without first being gated and enrolled. The DISPATCH is
      // `serveSurfaceSocket(...)` (below) in the app's closure: the seam keeps the
      // order, the app keeps the routing (`?host=`, an `__admin__` sentinel) and
      // the per-connection services.
      heartbeat.register(ws);
      onAccepted();
    },
    stop: heartbeat.stop,
  };
}

// ── The RPC serving seam (PLAN D5 / review #6) ─────────────────────────────

/** An ACCEPTED server-side WebSocket the RPC serving seam drives — the structural
 *  subset of the `ws` package's socket (and of the browser `WebSocket`) that
 *  Effect's `Socket.fromWebSocket` touches. Structural, like {@link GateableSocket}
 *  and {@link HeartbeatableSocket}, and for the same reason. */
export interface ServableSocket {
  readonly readyState: number;
  addEventListener(
    type: string,
    listener: (event: Event) => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

/** The address a `SocketServer` must declare. Nothing in Effect's socket-server
 *  protocol reads it (it only calls `run`), and neither `TcpAddress` nor
 *  `UnixAddress` describes an already-upgraded websocket — so this is a
 *  placeholder, spelled once here rather than invented per call site. */
const WEBSOCKET_ADDRESS = {
  _tag: "TcpAddress",
  hostname: "websocket",
  port: 0,
} as const;

/** A view of an accepted socket that BUFFERS inbound frames until the RPC server
 *  attaches its own `message` listener, then replays them in order.
 *
 *  This exists because the two sides are not in the same tick. `ws` starts
 *  emitting the moment the upgrade completes, while `Socket.fromWebSocket`
 *  attaches its listener inside an Effect run — so a client that sends its first
 *  request in the same tick as the upgrade (every reconnecting client does: the
 *  link re-issues its subscriptions immediately on open) would have that frame
 *  dropped on the floor, and the subscription would hang forever with no error
 *  anywhere. The oRPC handler attached synchronously and so never had the window.
 *  Subscribing HERE, synchronously inside `serveSurfaceSocket`, closes it. */
function bufferedSocketView(socket: ServableSocket): {
  view: ServableSocket;
  detach: () => void;
} {
  const pending: Event[] = [];
  let downstream: ((event: Event) => void) | undefined;
  const onMessage = (event: Event): void => {
    if (downstream === undefined) pending.push(event);
    else downstream(event);
  };
  socket.addEventListener("message", onMessage);
  const view: ServableSocket = {
    get readyState() {
      return socket.readyState;
    },
    addEventListener: (type, listener, options) => {
      if (type !== "message") {
        socket.addEventListener(type, listener, options);
        return;
      }
      downstream = listener;
      // Replay in arrival order, on the same turn the listener attaches, so the
      // decoder sees the frames exactly as they came off the wire.
      const replay = pending.splice(0, pending.length);
      for (const event of replay) listener(event);
    },
    removeEventListener: (type, listener) => {
      if (type === "message") {
        if (downstream === listener) downstream = undefined;
        return;
      }
      socket.removeEventListener(type, listener);
    },
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
  };
  return {
    view,
    detach: () => {
      socket.removeEventListener("message", onMessage);
      downstream = undefined;
      pending.length = 0;
    },
  };
}

/** A `SocketServer` whose whole population is ONE already-accepted websocket.
 *
 *  Effect's server-side socket protocol is written against `SocketServer` (it
 *  wants to accept), while an app's WS server accepts for itself — it must, since
 *  the stale-tab gate and the liveness reaper run in front of RPC dispatch
 *  (kolu#1231, review #6). Rather than reimplement either half, the accepted
 *  socket is handed to the protocol as a one-connection server: `run` serves it
 *  and then parks, exactly as `SocketServer.run`'s `Effect<never, …>` contract
 *  demands. This is the websocket twin of `@kolu/surface/unix-socket`'s
 *  one-connection server, and it is why `RpcServer.layerHttp` /
 *  `layerProtocolWebsocket` (which would own the upgrade, and so own the ordering)
 *  are not used. */
function oneConnectionSocketServer(
  socket: ServableSocket,
): Layer.Layer<SocketServer.SocketServer> {
  return Layer.effect(SocketServer.SocketServer)(
    Effect.map(
      Socket.fromWebSocket(
        Effect.acquireRelease(
          // The socket is ALREADY open (the app accepted it), so
          // `fromWebSocket`'s open-wait short-circuits.
          // The cast is structural: `ServableSocket` is exactly the slice of
          // `WebSocket` this consumes, and a `ws` server socket is not nominally
          // a DOM `WebSocket` anyway.
          Effect.succeed(socket as unknown as WebSocket),
          (ws) =>
            Effect.sync(() => {
              // 0 CONNECTING / 1 OPEN — anything else is already closing.
              if (ws.readyState <= 1) ws.close();
            }),
        ),
      ),
      (accepted) =>
        SocketServer.SocketServer.of({
          address: WEBSOCKET_ADDRESS,
          // `run`'s declared shape is `Effect<never, SocketServerError, R>`:
          // never returning, failing only the way an ACCEPTING server can. This
          // one cannot fail that way at all (there is nothing left to accept), so
          // the cast erases an error channel that is uninhabited here — the
          // handler's own failures stay in the handler's fiber. Same constraint,
          // same shape, as `@kolu/surface/unix-socket`'s one-connection server.
          run: (handler) =>
            Effect.flatMap(
              handler(accepted),
              () => Effect.never,
            ) as unknown as Effect.Effect<
              never,
              SocketServer.SocketServerError,
              never
            >,
        }),
    ),
  );
}

/** A socket being served: the teardown handle and the fault channel. */
export interface SurfaceSocketServing {
  /** Stop serving this socket and release everything the serve owns (the RPC
   *  server's fibers, every in-flight subscription, the buffered-view listener)
   *  and close the socket. Idempotent. */
  close(): void;
  /** Rejects if the serving stack itself failed; resolves when serving ended
   *  cleanly (the peer closed, or `close()` was called). A serving site MUST
   *  observe it — same contract as `SurfaceRuntime.done`: an ignored rejection is
   *  an unhandled one, which is the loud channel a silently dead connection
   *  deserves. */
  done: Promise<void>;
}

/** Serve one ACCEPTED websocket with the surface's Effect RPC server — the
 *  dispatch step of `acceptSurfaceSocket`'s gate → enrol → dispatch order.
 *
 *  Call it from the `onAccepted` closure, never before: the stale-tab gate must
 *  close a tab bound to a previous instance BEFORE any RPC dispatch (kolu#1231),
 *  and the reaper must hold every socket it will later sweep. Keeping the call at
 *  the app's site is also what lets a multi-host server pick WHICH runtime serves
 *  this socket (`?host=` routing) — the one thing a generic seam cannot decide.
 *
 *  Per-connection by design: each socket gets its own `RpcServer` over the SHARED
 *  handlers (the same shape `@kolu/surface/unix-socket` serves each accepted
 *  connection with), so one peer's teardown cannot touch another's — and so
 *  per-connection SERVICES can be provided, which is how a per-viewer fact
 *  (`viewerAddress`, the forwarded-for header) reaches a handler now that the
 *  socket protocol carries no request headers. */
export function serveSurfaceSocket<Svc = never>(opts: {
  /** The served surface's flat `RpcGroup` — `runtime.group`. */
  group: RpcGroup.RpcGroup<Rpc.Any>;
  /** Every bound member handler keyed by wire tag — `runtime.handlers`, or the
   *  record `restrictHandlers` returned. No `expose` option here: a hand-built
   *  serve path gates itself once, alongside its runtime (see
   *  `@kolu/surface/expose`, which owns that rule). */
  handlers: SurfaceHandlers;
  /** The accepted socket (gated and enrolled — see above). */
  socket: ServableSocket;
  /** Services this ONE connection's handlers may require — the seam a
   *  per-viewer fact rides (kolu's `viewerAddress` / `forwardedFor`, which the
   *  connection's `req.socket.remoteAddress` and headers supply). A layer, not a
   *  header map: Effect's socket-server protocol has no per-request header
   *  channel, and a per-connection serving stack can simply provide the service. */
  services?: Layer.Layer<Svc>;
}): SurfaceSocketServing {
  const buffered = bufferedSocketView(opts.socket);
  const base = surfaceRpcServerLayer(opts.group, opts.handlers).pipe(
    Layer.provide(RpcServer.layerProtocolSocketServer),
    Layer.provide(rpcSerializationLayer),
    Layer.provide(oneConnectionSocketServer(buffered.view)),
  );
  const serving =
    opts.services === undefined
      ? base
      : base.pipe(Layer.provide(opts.services));

  let settle!: (err?: unknown) => void;
  const done = new Promise<void>((resolvePromise, rejectPromise) => {
    settle = (err) => {
      if (err === undefined) resolvePromise();
      else rejectPromise(err);
    };
  });

  const scope = Scope.makeUnsafe();
  let ended = false;
  const teardown = (err?: unknown): void => {
    if (ended) return;
    ended = true;
    buffered.detach();
    // Releasing the scope interrupts the RPC server's fibers, which finalizes
    // every in-flight subscription this connection opened — the server-side
    // zombie the reaper's `terminate()` exists to prevent, closed from the other
    // end. The socket's own release (the acquire above) closes it.
    void Effect.runPromise(Scope.close(scope, Exit.void)).then(
      () => settle(err),
      // A teardown fault must not replace the reason we are tearing down.
      (closeErr) => settle(err ?? closeErr),
    );
  };
  // The peer hanging up ends the serve. Registered on the REAL socket (not the
  // buffered view, whose `message` channel is the RPC server's) so it fires
  // whether the close came from the client, the reaper's `terminate()`, or us.
  opts.socket.addEventListener("close", () => teardown(), { once: true });
  Effect.runPromise(Scope.provide(Layer.build(serving), scope)).then(
    // The build resolves once the serving stack is up; the connection then lives
    // in the scope until a close. Nothing to do here — `done` settles at
    // teardown, which is what a caller wants to log.
    () => {},
    // A per-connection build failure kills THIS connection and reaches the
    // caller through `done`; it never touches another peer or the listener.
    (err) => teardown(err),
  );
  return { close: () => teardown(), done };
}
