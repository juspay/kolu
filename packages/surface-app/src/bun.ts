/**
 * @kolu/surface-app/bun — the client build, owned upstream (Bun path).
 *
 * The freshness contract (`index.ts` invariant #1) is only correct for
 * *content-hashed* assets pinned `immutable` behind a *no-store* shell that
 * names them. Producing that layout — hashed asset filenames under one
 * prefix, the build commit published on the shell global (`SHELL_COMMIT_GLOBAL`, via
 * `injectShellCommit` — in the `no-store` shell, NEVER a `define` into the
 * hashed bundle; kolu#1319), and the shell rewritten to point at the hashed
 * URLs — is the build half of the contract, and it was being hand-rolled per
 * consumer (drishti's `build.ts`). `buildSurfaceClient` owns it so a Bun-built
 * app *composes* the build instead of re-deriving it; the app supplies only
 * what is genuinely its own (its bundler plugins, its CSS toolchain, its
 * public assets). The Vite path's counterpart is the `surfaceApp()` plugin in
 * `./vite`; both stamp the same commit via `resolveCommit`.
 *
 * This is a Bun-runtime entry: it calls `Bun.build`/`Bun.file`/`Bun.write`/
 * `Bun.hash` (filesystem dir ops use `node:fs/promises`, which works identically
 * under Bun and keeps the surface this module depends on small). It is typechecked
 * in the kolu monorepo by Node `tsc`, so rather than depend on `bun-types` (which
 * would leak Bun globals into every surface-app file), it reaches the runtime
 * `Bun` through a single locally-typed `globalThis` accessor — the same
 * "structural shape, no upstream type dependency" stance `./vite` takes for Vite.
 *
 * ## What the dist is, and why it takes no options to be it
 *
 * The dist this writes is the one `./server`'s `freshStaticLayer` serves — the
 * whole of it, not the part every consumer remembered to finish by hand:
 *
 * - **Precompressed siblings** (`./precompress`) for the hashed assets, because
 *   the static layer has always negotiated `br`/`zstd`/`gzip` and nothing here
 *   ever wrote them. There is no `precompress?: boolean`: a sibling exists only
 *   when it BEAT identity, is scoped to the immutable dir the layer negotiates
 *   under, and is skipped for types the layer refuses — so the switch would only
 *   ever select between "the layer works" and "the layer has nothing to serve".
 * - **Code splitting**, because `splitting: false` silently INLINED a consumer's
 *   `import()` into the entry — deferred in evaluation, identical on the wire,
 *   which is not the thing anyone writes `import()` for. There is no
 *   `splitting?: boolean` either: an app already says what it wants split by
 *   writing `import()` (or not), and a flag that turns that statement into a
 *   no-op is a second, silent opinion about the app's own source. With one
 *   entrypoint and no dynamic import the output is byte-identical either way.
 * - **`<link rel="modulepreload">`** in the shell for the chunks the entry
 *   STATICALLY imports (`./modulePreload`), because splitting the entry is what
 *   creates them and nothing downstream can name them: the browser would
 *   otherwise discover a shared chunk only after fetching AND parsing the entry,
 *   one round trip into first paint. No flag here either, for the same reason as
 *   the two above — a build with no split chunks emits no tags, so the only
 *   thing a switch could select is whether that round trip gets paid.
 *
 * Both were paid upstream the way the `serveSurfaceApp` listener sequence and
 * the RPC frame cap were: by REMOVING the choice where the right answer is
 * universal, so the consumer's build script gets shorter rather than wider.
 *
 * The ONE option about the dist's shape is `assetPrefix`, and it is here
 * because the right answer is NOT universal: it is a fact about whose URL space
 * the app is serving. Every rule above is about how the dist works, and the
 * answer is the same for every app; where the hashed dir SITS is about what
 * else lives at `/`. olai serves a person's own directory of files there, so
 * `/assets/notes.md` is one of their pages, and a miss under the immutable
 * prefix 404s by design rather than reaching the shell — the bundle's default
 * home makes a whole folder of theirs unaddressable. `FreshnessPaths` has taken
 * that prefix on the SERVING side since the freshness contract was written, and
 * Vite-built clients set it through Vite's own `build.assetsDir`; this half is
 * the one that had no way to say it, which made the existing input unusable.
 * `assetDirOf` (`./index`) keeps it ONE setting: the request prefix is the
 * dist-relative directory, so there is no second place for the two to disagree.
 */

import { existsSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { assetDirOf, DEFAULT_ASSET_PREFIX, injectShellHead } from "./index";
import { type ChunkGraph, staticImportChunks } from "./modulePreload";
import {
  type AssetReport,
  precompressAssets,
  pruneAssets,
} from "./precompress";
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
  /** Present because the config below asks for it — the bundler's own record of
   *  which output imports which, and how (`./modulePreload`). */
  metafile?: ChunkGraph;
}
interface BunBuildConfig {
  entrypoints: string[];
  outdir: string;
  // The object form, so the `[hash]` that every `immutable` pin rests on covers
  // CHUNKS too — a string here would name only the entry, and a split-out chunk
  // with an unhashed name would be pinned for a year under a reusable URL.
  naming?: { entry: string; chunk: string; asset: string };
  target?: string;
  format?: string;
  splitting?: boolean;
  minify?: boolean;
  sourcemap?: string;
  // Ask the bundler to report the chunk graph, which is the only place the
  // entry's static imports are stated rather than guessed at (see the
  // modulepreload block below).
  metafile?: boolean;
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
/** The runtime `Bun`, read at CALL time and never cached at module load: this
 *  module is imported by kolu's own Node test suite (which drives it over a
 *  stand-in runtime), and a missing `Bun` must say so in one sentence rather
 *  than surface as `undefined.build is not a function` deep in a build. */
const bun = (): BunLike => {
  const runtime = (globalThis as unknown as { Bun?: BunLike }).Bun;
  if (runtime === undefined)
    throw new Error(
      "buildSurfaceClient: no `Bun` global — @kolu/surface-app/bun is the Bun-runtime build path; run it under `bun`.",
    );
  return runtime;
};
// -----------------------------------------------------------------------------

/** Re-exported so a caller can NAME what `buildSurfaceClient` reports back; the
 *  emitter itself is internal (see `./precompress`). */
export type { AssetReport } from "./precompress";

/** An extra content-hashed asset the app produces with its own toolchain (e.g.
 *  Tailwind CSS), to be emitted under `<assetPrefix><name>-<hash>.<ext>` with
 *  the same `immutable` contract as the JS bundle. The app builds the bytes; the helper
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
  /** The dist root to emit into. Hashed assets land under `<distDir>/` +
   *  `assetPrefix` (`assets/` by default); the rewritten no-store shell lands
   *  at `<distDir>/index.html`. */
  distDir: string;
  /** The HTML shell template (e.g. `<clientDir>/index.html`) — rewritten to
   *  reference the hashed asset URLs and written to `<distDir>/index.html`. The
   *  shell stays unhashed at the root (`installFreshStatic` serves it `no-store`). */
  htmlTemplate: string;
  /** The exact substring in the template that references the JS entry in dev
   *  (e.g. `src="./main.tsx"`), replaced with the hashed
   *  `<assetPrefix><entry>-<hash>.js`. */
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
   *  OUTSIDE the hashed dir, so they are referenced by stable paths and not
   *  pinned immutable. */
  publicDir?: string;
  /** Where the hashed assets are served from, and so where they are written:
   *  the same `FreshnessPaths.assetPrefix` this dist's server is given
   *  (default `/assets/`). Say it here ONLY to move the bundle out of a URL
   *  space that is not the app's to spend — an app serving somebody else's
   *  directory at `/` needs `/assets/…` back, and a miss under this prefix
   *  404s rather than reaching the shell, so a file of theirs under it has no
   *  page at all. {@link assetDirOf} derives the dist-relative directory and is
   *  the whole of the agreement between the two halves. */
  assetPrefix?: string;
  /** Minify the JS bundle (default `true`). */
  minify?: boolean;
}

/** What a built client dist is, told back to its builder. */
export interface SurfaceClientBuildResult {
  /** The hashed URL of the JS entry — the one the shell now names. */
  jsHref: string;
  /** Hashed URLs of the extra assets, keyed by their `name`. */
  assetHrefs: Record<string, string>;
  /** The prefix every href above sits under — what the SERVER for this dist has
   *  to be given as `FreshnessPaths.assetPrefix`. Reported rather than left
   *  implicit because the two halves are one setting: a caller that wires this
   *  value through cannot pin a prefix its own build did not write under. */
  assetPrefix: string;
  /** The hashed URLs this build named as `<link rel="modulepreload">` — the
   *  entry's static chunks, transitively, in load order. Empty when the entry
   *  did not split. Reported for the same reason `jsHref` is: a caller that also
   *  templates the HTML elsewhere has to be able to write the same tags, and
   *  only the build can name these files. Feed them to `injectShellHead`. */
  preloadHrefs: readonly string[];
  /** One row per COMPRESSIBLE file in the hashed-asset dir — entry, split
   *  chunks and extra assets alike — with its identity and sibling sizes. Not
   *  every file there: sourcemaps and already-compressed media are skipped and
   *  do not appear. What a build script prints to make "2.56 MB became 571 kB on
   *  the wire" a number somebody can see. */
  assets: readonly AssetReport[];
}

/** Build a surface-app client bundle that satisfies the freshness contract:
 *  content-hashed assets under `assetPrefix` (the prerequisite for
 *  `immutable` caching), the build commit published on the shell global (`window.__SURFACE_APP_COMMIT__`
 *  in the `no-store` `index.html` — never inside a hashed asset; kolu#1319),
 *  the shell rewritten to name the hashed assets, and a `modulepreload` link for
 *  each chunk the entry statically imports. The hashed dir it leaves
 *  behind is exactly this build's output plus the precompressed siblings
 *  `freshStaticLayer` negotiates — see the module header for why neither of
 *  those is an option. Returns every hashed href the shell now names — the JS
 *  entry, one per extra asset keyed by `name`, and the entry's static chunks in
 *  load order — plus a size report per asset. The first two came from
 *  placeholders the caller wrote and the third from the build graph, but a
 *  caller that also templates the HTML elsewhere needs all of them to write the
 *  same head (`injectShellHead` takes exactly that shape). */
export async function buildSurfaceClient(
  opts: SurfaceClientBuildOptions,
): Promise<SurfaceClientBuildResult> {
  const Bun = bun();
  const distDir = resolve(opts.distDir);
  const assetPrefix = opts.assetPrefix ?? DEFAULT_ASSET_PREFIX;
  // The prefix IS the directory (`assetDirOf`), which is what keeps a moved
  // bundle one setting rather than two: there is no second place to say where
  // the files went, so the shell's hrefs and the bytes on disk cannot part.
  const assetsDir = resolve(distDir, assetDirOf(assetPrefix));
  /** A file in the hashed dir, as the shell must name it — for the entry, the
   *  preloaded chunks and the extra assets alike, off the same prefix the
   *  server pins `immutable` (`isImmutableAssetPath`), so an href this build
   *  writes cannot land outside the prefix that build's own server caches it
   *  under. */
  const assetHref = (file: string) => `${assetPrefix}${file}`;
  await mkdir(assetsDir, { recursive: true });
  const commit = opts.commit ?? resolveCommit(opts.commitEnvVar);

  // JS bundle. `naming` carries a `[hash]` token so the entry lands at
  // `<assetPrefix><name>-<hash>.js` — a content hash is the prerequisite for
  // the server's `immutable` pin: the byte-identical bundle keeps its URL across
  // rebuilds, a changed one gets a new URL, so an installed client pins assets
  // for a year yet always converges after a deploy. NO commit define: the
  // bundle must stay commit-independent (same name ⇒ same bytes), or a
  // stamp-only rebuild silently changes an `immutable` file's content and
  // strands returning browsers on the old stamp (kolu#1319). The commit rides
  // the shell instead — `injectShellCommit` below.
  //
  // `splitting` is on and is not an option (module header): a dynamic `import()`
  // in the app's source is what asks for a chunk, and the same `[hash]` naming
  // covers chunks, so a split-out chunk lands in the same immutable hashed
  // dir and is referenced from the entry by a relative URL that resolves inside
  // it. An app with no dynamic import gets the single file it always got.
  const jsResult = await Bun.build({
    entrypoints: [resolve(opts.entrypoint)],
    outdir: assetsDir,
    naming: {
      entry: "[name]-[hash].[ext]",
      chunk: "[name]-[hash].[ext]",
      asset: "[name]-[hash].[ext]",
    },
    target: "browser",
    format: "esm",
    splitting: true,
    minify: opts.minify ?? true,
    sourcemap: "linked",
    metafile: true,
    plugins: opts.plugins,
  });
  if (!jsResult.success) {
    const detail = jsResult.logs.map((l) => l.message).join("\n");
    throw new Error(
      `buildSurfaceClient: Bun.build failed for client\n${detail}`,
    );
  }
  // The entrypoint output is the one `.js` whose kind isn't a chunk — found by
  // `kind`, which is what keeps this correct now that splitting is on and the
  // outputs alongside it are chunks and sourcemaps.
  const jsEntry = jsResult.outputs.find(
    (o) => o.kind === "entry-point" && o.path.endsWith(".js"),
  );
  if (!jsEntry)
    throw new Error(
      "buildSurfaceClient: Bun.build produced no JS entry output",
    );
  const entryFile = basename(jsEntry.path);
  const jsHref = assetHref(entryFile);

  // The chunks the entry STATICALLY imports, to be preloaded from the shell —
  // `./modulePreload` is where that list is decided and why. Asked for here
  // because this is the only place that HAS the graph: no metafile means no
  // graph, and a shell that silently drops back to costing the round trip is
  // exactly what this must not ship, so say it instead.
  if (jsResult.metafile === undefined)
    throw new Error(
      "buildSurfaceClient: Bun.build reported no metafile — the entry's chunk graph, and so its modulepreloads, cannot be read",
    );
  const preloadHrefs = staticImportChunks(jsResult.metafile, entryFile).map(
    assetHref,
  );

  // Extra assets (e.g. Tailwind CSS): the app builds the bytes; we hash them on
  // their own content, write `<assetPrefix><name>-<hash>.<ext>`, and key the
  // href by `name` so the shell rewrite and the return value agree. Same immutable
  // contract as the JS bundle — identical bytes keep their URL.
  const assetHrefs: Record<string, string> = {};
  // Every file this build put in the hashed dir, by name — the entry, the split
  // chunks, the sourcemaps, and the extra assets below. It is what `pruneAssets`
  // measures the dir against at the end: anything else there is a previous
  // build's, named by no shell that can still be loaded.
  const produced = new Set(jsResult.outputs.map((o) => basename(o.path)));
  for (const asset of opts.extraAssets ?? []) {
    const bytes = await asset.build();
    const hash = Bun.hash(bytes).toString(16).slice(0, 8);
    const fileName = `${asset.name}-${hash}.${asset.ext}`;
    await Bun.write(resolve(assetsDir, fileName), bytes);
    produced.add(fileName);
    assetHrefs[asset.name] = assetHref(fileName);
  }

  // index.html is the no-store SPA shell — it stays UNHASHED at the root and is
  // rewritten to reference the hashed asset URLs. The shell is always
  // re-fetched; the assets it names are pinned immutable — the whole contract.
  // Each placeholder MUST be present: a `replaceAll` that matches nothing is a
  // silent no-op, so a typo'd or stale template would build "successfully" yet
  // ship a shell that still points at dev assets (or omits a hashed one) —
  // exactly the staleness #1 exists to make impossible. Assert, then rewrite.
  let html = await Bun.file(resolve(opts.htmlTemplate)).text();
  if (!html.includes(opts.entryHtmlPlaceholder))
    throw new Error(
      `buildSurfaceClient: entryHtmlPlaceholder ${JSON.stringify(
        opts.entryHtmlPlaceholder,
      )} not found in htmlTemplate (${opts.htmlTemplate}) — the shell would still point at dev assets.`,
    );
  html = html.replaceAll(opts.entryHtmlPlaceholder, `src="${jsHref}"`);
  for (const asset of opts.extraAssets ?? []) {
    if (!html.includes(asset.htmlPlaceholder))
      throw new Error(
        `buildSurfaceClient: htmlPlaceholder ${JSON.stringify(
          asset.htmlPlaceholder,
        )} for extra asset ${JSON.stringify(asset.name)} not found in htmlTemplate (${opts.htmlTemplate}) — the hashed asset would never be referenced.`,
      );
    html = html.replaceAll(
      asset.htmlPlaceholder,
      `href="${assetHrefs[asset.name]}"`,
    );
  }
  // The head prelude, in one splice: the preload links and the commit script,
  // written in the order `./index`'s `injectShellHead` states (the tags first — their whole job
  // is to start those fetches at the earliest byte the parser reaches). The
  // commit is published on the shell global rather than defined into the bundle
  // because the `no-store` shell is re-fetched on every load, so the identity a
  // client reports is always the deployed one (kolu#1319; `shellCommit()` is the
  // page-side reader). A build with nothing split adds no preload tags at all.
  html = injectShellHead(html, { preloadHrefs, commit });
  await Bun.write(resolve(distDir, "index.html"), html);

  // Static public assets (icons, etc.) shipped verbatim to the dist root, OUTSIDE
  // the hashed dir (referenced by stable paths, not pinned immutable).
  if (opts.publicDir) {
    const publicDir = resolve(opts.publicDir);
    if (!existsSync(publicDir))
      throw new Error(
        `buildSurfaceClient: publicDir does not exist: ${publicDir}`,
      );
    await cp(publicDir, distDir, { recursive: true });
  }

  // Finish the dist the server is built to serve. Prune FIRST — an earlier
  // build's assets are unreachable the moment the shell above stopped naming
  // them, and compressing them would be a growing bill for bytes nobody can
  // request. Then write the siblings `freshStaticLayer` negotiates, skipping any
  // that already sit beside an unchanged (so identically hashed) asset, which is
  // what keeps a rebuild's brotli bill proportional to what actually changed.
  await pruneAssets(assetsDir, produced);
  const assets = await precompressAssets(assetsDir);

  return { jsHref, assetHrefs, assetPrefix, preloadHrefs, assets };
}
