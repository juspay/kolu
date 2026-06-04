/**
 * @kolu/surface-app/server — the Hono glue that serves the shell fresh.
 *
 * `installFreshStatic` is the freshness contract on the wire: no-store shell,
 * immutable hashed assets, 404 on an asset miss (never the HTML shell), the
 * self-destructing `/sw.js`, and the SPA fallback. `installPwaManifest` serves
 * the desktop-app manifest. `installSurfaceApp` wires both in the common order.
 * `buildInfoServer` is the buildInfo cell's server impl, composed into your
 * surface router. Register your `/rpc/*` (surface) routes BEFORE the static
 * installers — the static catch-all is last.
 */

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Surface, SurfaceSpec } from "@kolu/surface/define";
import {
  type ImplementSurfaceDeps,
  implementSurface,
} from "@kolu/surface/server";
import type { Hono } from "hono";
import { resolveCommit } from "./vite";
import {
  ASSET_MISS_CACHE_CONTROL,
  cacheControlFor,
  type FreshnessPaths,
  isImmutableAssetPath,
  SHELL_CACHE_CONTROL,
  SW_SOURCE,
} from "./index";
import type { BuildInfo } from "./surface";

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
 *  from `root`. Serves the self-destructing `/sw.js` itself (no-cache); a
 *  `/assets/*` miss 404s; any other unmatched path serves the `no-store` shell
 *  so a normal reload can never replay a stale one. */
export function installFreshStatic(
  app: Hono,
  opts: { root: string } & FreshnessPaths,
): void {
  const root = resolve(opts.root);
  // The retirement worker, served no-cache — registered first so the static
  // catch-all never shadows it, and so the app never hand-rolls this route.
  app.get("/sw.js", (c) => {
    c.header("Cache-Control", cacheControlFor("/sw.js")!);
    return c.body(SW_SOURCE, 200, {
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
  opts: { clientDist: string; manifest?: ManifestOptions } & FreshnessPaths,
): void {
  if (opts.manifest) installPwaManifest(app, opts.manifest);
  installFreshStatic(app, {
    root: opts.clientDist,
    assetPrefix: opts.assetPrefix,
    shellPaths: opts.shellPaths,
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
   *  reaches subscribers — `await frag.buildInfo.connect(ctx.cells.buildInfo)`
   *  once at boot. The fragment owns the seed→resolve→set composition; the app
   *  never hand-writes the `{ commit }` seed and a second `ctx.set`. A no-op
   *  (deduped) when the source was sync — nothing late to push. */
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
            // still works; the extra axis stays at its default. Surface the
            // failure (don't swallow it silently) so a broken boot-time probe
            // is distinguishable from a legitimately absent optional axis.
            opts.onError?.(err);
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

/** The `surface.surfaceApp.info` identity procedure's server implementation, as
 *  a composable fragment: `implementSurface(surface, { …, procedures: { ...serverIdentity() } })`.
 *  Mints one `processId` per process (so a reconnect to a *different* process
 *  reads as a restart) — the restart axis's turnkey counterpart to
 *  `buildInfoServer()`. Pass `processId` to override (e.g. a stable id in
 *  tests). Pairs with `serverIdentity.procedures` (now `surfaceApp.info`) on the
 *  surface and with the provider's `probe={() => client.rpc.surface.surfaceApp.info({})}`. */
export function serverIdentity(opts: { processId?: string } = {}): {
  surfaceApp: { info: () => Promise<{ processId: string }> };
} {
  const processId = opts.processId ?? randomUUID();
  return { surfaceApp: { info: async () => ({ processId }) } };
}

/** The whole surface-app server fragment in one call — the `buildInfo` cell impl
 *  AND the `surfaceApp.info` probe impl, so a consumer spreads `cells` and
 *  `procedures` once each into `implementSurface`. The buildInfo connect handle
 *  is `result.cells.buildInfo.connect(ctx.cells.buildInfo)`. The turnkey
 *  counterpart to `surfaceAppSurfaceWith` on the surface side. */
export function surfaceAppServer<T extends BuildInfo = BuildInfo>(
  opts: Parameters<typeof buildInfoServer<T>>[0] & { processId?: string } = {},
): {
  cells: BuildInfoServerFragment<T>;
  procedures: { surfaceApp: { info: () => Promise<{ processId: string }> } };
} {
  return {
    cells: buildInfoServer<T>(opts),
    procedures: serverIdentity({ processId: opts.processId }),
  };
}

/** Implement the whole surface-app server side in ONE call — the counterpart to
 *  `composeSurfaces` on the surface side. It merges the surface-app fragment's
 *  `buildInfo` cell + `surfaceApp.info` probe impls into your own
 *  `implementSurface` deps, runs `implementSurface`, AND flows the buildInfo
 *  cell's `connect` (the async boot axis — kolu's `system.version`, the example's
 *  `bootId`; a deduped no-op for the sync `{ commit }` default). So the app passes
 *  ONLY its own `cells`/`procedures` and never hand-spreads the surface-app halves
 *  or writes the seed→connect dance. Returns `implementSurface`'s `{ router, ctx }`.
 *
 *  ```ts
 *  const { router, ctx } = implementSurfaceApp(surface, surfaceAppServer<T>(opts), {
 *    channel,
 *    cells: { serverStats: { store } },   // your own only — buildInfo is the fragment's
 *    procedures: { hosts: { … } },        // your own only — surfaceApp.info is the fragment's
 *  });
 *  ``` */
export function implementSurfaceApp<
  const S extends SurfaceSpec,
  T extends BuildInfo = BuildInfo,
>(
  surface: Surface<S>,
  server: ReturnType<typeof surfaceAppServer<T>>,
  appDeps: Omit<ImplementSurfaceDeps<S>, "cells" | "procedures"> & {
    cells?: Partial<NonNullable<ImplementSurfaceDeps<S>["cells"]>>;
    procedures?: Partial<NonNullable<ImplementSurfaceDeps<S>["procedures"]>>;
  },
) {
  const result = implementSurface(surface, {
    ...appDeps,
    cells: { ...server.cells, ...(appDeps.cells ?? {}) },
    procedures: { ...server.procedures, ...(appDeps.procedures ?? {}) },
  } as ImplementSurfaceDeps<S>);
  // Flow the buildInfo cell's late (async) axis through the same fragment — and
  // re-assert the sync seed harmlessly (deduped by the fragment's `equals`). The
  // app never writes a hand-rolled `ctx.cells.buildInfo.set`. The generic `S`
  // doesn't statically prove the `buildInfo` cell, but the fragment we just
  // spread into `cells` guarantees it at runtime — hence the narrow ctx cast.
  const ctxCells = result.ctx.cells as {
    buildInfo: { set: (value: T) => void };
  };
  void server.cells.buildInfo.connect(ctxCells.buildInfo);
  return result;
}
