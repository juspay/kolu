/**
 * @kolu/surface-app/bun — the client build, owned upstream (Bun path).
 *
 * The freshness contract (`index.ts` invariant #1) is only correct for
 * *content-hashed* assets pinned `immutable` behind a *no-store* shell that
 * names them. Producing that layout — hashed `/assets/*` filenames, the
 * `__SURFACE_APP_COMMIT__` define stamped from the one resolver, and the shell
 * rewritten to point at the hashed URLs — is the build half of the contract, and
 * it was being hand-rolled per consumer (drishti's `build.ts`). `buildSurfaceClient`
 * owns it so a Bun-built app *composes* the build instead of re-deriving it; the
 * app supplies only what is genuinely its own (its bundler plugins, its CSS
 * toolchain, its public assets). The Vite path's counterpart is the `surfaceApp()`
 * plugin in `./vite`; both stamp the same commit via `resolveCommit`.
 *
 * This is a Bun-runtime entry: it calls `Bun.build`/`Bun.file`/`Bun.write`/
 * `Bun.hash` (filesystem dir ops use `node:fs/promises`, which works identically
 * under Bun and keeps the surface this module depends on small). It is typechecked
 * in the kolu monorepo by Node `tsc`, so rather than depend on `bun-types` (which
 * would leak Bun globals into every surface-app file), it reaches the runtime
 * `Bun` through a single locally-typed `globalThis` accessor — the same
 * "structural shape, no upstream type dependency" stance `./vite` takes for Vite.
 */

import { existsSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { ASSET_DIR } from "./index";
import { resolveCommit } from "./vite";

// --- minimal structural view of the Bun runtime (see module header) ----------
interface BunBuildArtifact {
  path: string;
  kind: string;
}
interface BunBuildResult {
  success: boolean;
  logs: { message: string }[];
  outputs: BunBuildArtifact[];
}
interface BunBuildConfig {
  entrypoints: string[];
  outdir: string;
  naming?: string;
  target?: string;
  format?: string;
  splitting?: boolean;
  minify?: boolean;
  sourcemap?: string;
  define?: Record<string, string>;
  // App bundler plugins (e.g. the Solid JSX transform) — opaque here; passed
  // straight through to `Bun.build`, so this module needs no `bun` plugin types.
  plugins?: unknown[];
}
interface BunFile {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  exists(): Promise<boolean>;
}
interface BunLike {
  build(config: BunBuildConfig): Promise<BunBuildResult>;
  file(path: string): BunFile;
  write(path: string, data: string | ArrayBuffer | Uint8Array): Promise<number>;
  hash(data: string | ArrayBuffer | Uint8Array): bigint;
}
const Bun = (globalThis as unknown as { Bun: BunLike }).Bun;
// -----------------------------------------------------------------------------

/** An extra content-hashed asset the app produces with its own toolchain (e.g.
 *  Tailwind CSS), to be emitted under `/assets/<name>-<hash>.<ext>` with the same
 *  `immutable` contract as the JS bundle. The app builds the bytes; the helper
 *  hashes, names, writes, and rewrites the shell to point at the hashed URL. */
export interface SurfaceClientExtraAsset {
  /** Base name without the hash, e.g. `styles`. */
  name: string;
  /** Extension without the dot, e.g. `css`. */
  ext: string;
  /** Produce the asset's bytes — invoked during the build (e.g. shell out to the
   *  Tailwind CLI and read the result). */
  build: () => Promise<ArrayBuffer | Uint8Array> | ArrayBuffer | Uint8Array;
  /** The exact substring in the HTML template to replace with this asset's hashed
   *  href, e.g. `href="./styles.css"`. */
  htmlPlaceholder: string;
}

export interface SurfaceClientBuildOptions {
  /** The client entrypoint, e.g. `<clientDir>/main.tsx`. */
  entrypoint: string;
  /** The dist root to emit into. Hashed assets land under `<distDir>/assets/`;
   *  the rewritten no-store shell lands at `<distDir>/index.html`. */
  distDir: string;
  /** The HTML shell template (e.g. `<clientDir>/index.html`) — rewritten to
   *  reference the hashed asset URLs and written to `<distDir>/index.html`. The
   *  shell stays unhashed at the root (`installFreshStatic` serves it `no-store`). */
  htmlTemplate: string;
  /** The exact substring in the template that references the JS entry in dev
   *  (e.g. `src="./main.tsx"`), replaced with the hashed `/assets/<entry>-<hash>.js`. */
  entryHtmlPlaceholder: string;
  /** The app's Bun bundler plugins (e.g. the Solid JSX transform). */
  plugins?: unknown[];
  /** Override the resolved commit; defaults to `resolveCommit(commitEnvVar)`
   *  (env → git → `"dev"`) — the same value `buildInfoServer()` reads server-side,
   *  which is what makes skew a real comparison. */
  commit?: string;
  /** The env var the commit is read from (default `SURFACE_APP_COMMIT`). */
  commitEnvVar?: string;
  /** Extra content-hashed assets (e.g. the Tailwind CSS bundle). */
  extraAssets?: SurfaceClientExtraAsset[];
  /** A directory copied verbatim into the dist root (icons, etc.). These sit
   *  OUTSIDE `/assets/`, so they are referenced by stable paths and not pinned
   *  immutable. */
  publicDir?: string;
  /** Minify the JS bundle (default `true`). */
  minify?: boolean;
}

/** Build a surface-app client bundle that satisfies the freshness contract:
 *  content-hashed `/assets/*` (the prerequisite for `immutable` caching), the
 *  build commit stamped into `__SURFACE_APP_COMMIT__`, and a `no-store` shell
 *  rewritten to name the hashed assets. Returns the hashed hrefs (the JS entry
 *  plus one per extra asset, keyed by `name`) — the same URLs written into the
 *  shell, exposed for callers that also template the HTML elsewhere. */
export async function buildSurfaceClient(
  opts: SurfaceClientBuildOptions,
): Promise<{ jsHref: string; assetHrefs: Record<string, string> }> {
  const distDir = resolve(opts.distDir);
  const assetsDir = resolve(distDir, ASSET_DIR);
  await mkdir(assetsDir, { recursive: true });
  const commit = opts.commit ?? resolveCommit(opts.commitEnvVar);

  // JS bundle. `naming` carries a `[hash]` token so the entry lands at
  // `/assets/<name>-<hash>.js` — a content hash is the prerequisite for the
  // server's `immutable` pin: the byte-identical bundle keeps its URL across
  // rebuilds, a changed one gets a new URL, so an installed client pins assets
  // for a year yet always converges after a deploy. The define stamps the build
  // commit into the client, the same value `buildInfoServer()` reads server-side.
  const jsResult = await Bun.build({
    entrypoints: [resolve(opts.entrypoint)],
    outdir: assetsDir,
    naming: "[name]-[hash].[ext]",
    target: "browser",
    format: "esm",
    splitting: false,
    minify: opts.minify ?? true,
    sourcemap: "linked",
    define: { __SURFACE_APP_COMMIT__: JSON.stringify(commit) },
    plugins: opts.plugins,
  });
  if (!jsResult.success) {
    const detail = jsResult.logs.map((l) => l.message).join("\n");
    throw new Error(`buildSurfaceClient: Bun.build failed for client\n${detail}`);
  }
  // The entrypoint output is the one `.js` whose kind isn't a chunk; find it by
  // `kind` to stay correct even if splitting is later enabled.
  const jsEntry = jsResult.outputs.find(
    (o) => o.kind === "entry-point" && o.path.endsWith(".js"),
  );
  if (!jsEntry)
    throw new Error("buildSurfaceClient: Bun.build produced no JS entry output");
  const jsHref = `/${ASSET_DIR}/${basename(jsEntry.path)}`;

  // Extra assets (e.g. Tailwind CSS): the app builds the bytes; we hash them on
  // their own content, write `/assets/<name>-<hash>.<ext>`, and key the href by
  // `name` so the shell rewrite and the return value agree. Same immutable
  // contract as the JS bundle — identical bytes keep their URL.
  const assetHrefs: Record<string, string> = {};
  for (const asset of opts.extraAssets ?? []) {
    const bytes = await asset.build();
    const hash = Bun.hash(bytes).toString(16).slice(0, 8);
    const fileName = `${asset.name}-${hash}.${asset.ext}`;
    await Bun.write(resolve(assetsDir, fileName), bytes);
    assetHrefs[asset.name] = `/${ASSET_DIR}/${fileName}`;
  }

  // index.html is the no-store SPA shell — it stays UNHASHED at the root and is
  // rewritten to reference the hashed `/assets/*` URLs. The shell is always
  // re-fetched; the assets it names are pinned immutable — the whole contract.
  let html = await Bun.file(resolve(opts.htmlTemplate)).text();
  html = html.replaceAll(opts.entryHtmlPlaceholder, `src="${jsHref}"`);
  for (const asset of opts.extraAssets ?? []) {
    html = html.replaceAll(
      asset.htmlPlaceholder,
      `href="${assetHrefs[asset.name]}"`,
    );
  }
  await Bun.write(resolve(distDir, "index.html"), html);

  // Static public assets (icons, etc.) shipped verbatim to the dist root, OUTSIDE
  // `/assets/` (referenced by stable paths, not pinned immutable).
  if (opts.publicDir) {
    const publicDir = resolve(opts.publicDir);
    if (!existsSync(publicDir))
      throw new Error(`buildSurfaceClient: publicDir does not exist: ${publicDir}`);
    await cp(publicDir, distDir, { recursive: true });
  }

  return { jsHref, assetHrefs };
}
