/**
 * @kolu/surface-app/server — the Hono glue that serves the shell fresh.
 *
 * `installFreshStatic` is the freshness contract on the wire: no-store shell,
 * immutable hashed assets, 404 on an asset miss (never the HTML shell), SPA
 * fallback for everything else. `installPwaManifest` serves the desktop-app
 * manifest. `installSurfaceApp` wires both in the common order. Register your
 * `/rpc/*` (surface) routes BEFORE calling these — the static catch-all is last.
 */

import { resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import {
  ASSET_MISS_CACHE_CONTROL,
  cacheControlFor,
  type FreshnessPaths,
  isImmutableAssetPath,
  SHELL_CACHE_CONTROL,
} from "./index.ts";

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
 *  from `root`. A `/assets/*` miss 404s; any other unmatched path serves the
 *  `no-store` shell so a normal reload can never replay a stale one. */
export function installFreshStatic(
  app: Hono,
  opts: { root: string } & FreshnessPaths,
): void {
  const root = resolve(opts.root);
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

/** The greenfield convenience: manifest (if given) + fresh static serving,
 *  wired in the right order. Granular pieces are exported for apps that want
 *  to compose them by hand. */
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
