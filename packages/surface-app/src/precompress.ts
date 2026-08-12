/**
 * The EMIT half of the encoding negotiation — internal to this package.
 *
 * There is no `./precompress` entrypoint on purpose: a consumer gets this by
 * calling `buildSurfaceClient`, not by remembering to compose a second step
 * after it. That "remembering" is the entire defect being fixed here.
 *
 * `./server`'s `freshStaticLayer` has always negotiated `br`/`zstd`/`gzip`
 * siblings under the hashed-asset prefix: offer an encoding, and if a same-named
 * `.br`/`.zst`/`.gz` file sits beside the identity bytes the response goes out
 * with that `Content-Encoding`, the ORIGINAL `Content-Type` and an appended
 * `Vary` — identity otherwise. What no half of this package did was WRITE those
 * siblings, so every consumer re-derived a post-build step by hand, and each one
 * got the table slightly wrong: the server has preferred `zstd` since it replaced
 * Hono's `serve-static`, yet no consumer ever emitted a `.zst`, so the preferred
 * encoding silently never existed. `PRECOMPRESSED_ENCODINGS` (in `./index`) is
 * now the one table both halves read, and `buildSurfaceClient` calls this module
 * — a dist the builder produced is a dist the server can fully serve, by
 * construction rather than by each app remembering.
 *
 * Node-only, not Bun-only: `node:zlib` + `node:fs/promises` behave identically
 * under both, which is what lets kolu's own vitest suite build a dist and serve
 * it through the real `freshStaticLayer` (`dist.test.ts`) on a machine with no
 * Bun.
 *
 * Two properties keep a rebuild cheap, and both fall out of content hashing:
 *
 * - **Skip.** A sibling that already sits beside `main-a1b2c3d4.js` was
 *   compressed FROM those bytes — the name is the hash of the content, so it
 *   cannot be stale. It is never recompressed.
 * - **Prune.** Everything under the hashed-asset dir that this build did not
 *   produce is a previous build's, named by no shell anyone can still load. It
 *   is deleted, which is what stops the dir (and so the brotli-q11 bill) from
 *   growing without bound across a day of dev rebuilds.
 */

import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  brotliCompressSync,
  constants as zlibConstants,
  gzipSync,
  zstdCompressSync,
} from "node:zlib";
import { PRECOMPRESSED_ENCODINGS } from "./index";

/** Extensions worth compressing. The server decides by `Content-Type`; a build
 *  only has a filename, so this is the file-name shadow of that guard — kept
 *  DELIBERATELY narrower than the regex, because writing a sibling the server
 *  will refuse (a `.png.br`) is pure waste, while missing one is only a missed
 *  win. `dist.test.ts` pins the two together by serving what this emits.
 *
 *  `.map` is out on purpose: a sourcemap is never on the first-paint path, and
 *  brotli-q11 over a multi-megabyte map would dominate the build for bytes only
 *  an open DevTools ever asks for. */
const COMPRESSIBLE_EXT: ReadonlySet<string> = new Set([
  ".css",
  ".ico",
  ".js",
  ".json",
  ".mjs",
  ".svg",
  ".txt",
  ".wasm",
  ".xml",
]);

/** Below this, the wire and filesystem overhead swamps any saving — the same
 *  threshold kolu's own Vite build has used for its `/assets/*` siblings. */
const MIN_BYTES = 1024;

/** Sizes of what sits beside one asset, keyed by `Content-Encoding` token
 *  (`br` / `zstd` / `gzip`) — the very tokens a client offers. */
export type SiblingSizes = Readonly<Record<string, number>>;

/** One row per asset the hashed-asset dir holds after a build: what the
 *  identity bytes cost, and what each sibling costs. An asset that was skipped
 *  (too small, not a compressible type) or whose every encoding lost to identity
 *  reports no siblings — so a consumer logging this prints the truth about what
 *  is on disk, including on a rebuild that compressed nothing. */
export interface AssetReport {
  /** File name inside the hashed-asset dir, e.g. `main-a1b2c3d4.js`. */
  readonly file: string;
  /** Identity size in bytes. */
  readonly bytes: number;
  /** Sibling sizes by encoding; empty when there are none. */
  readonly siblings: SiblingSizes;
}

const extOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
};

const SIBLING_SUFFIXES = PRECOMPRESSED_ENCODINGS.map(([, suffix]) => suffix);

/** Compress once per encoding, at build-time settings — the cost is paid here so
 *  no request ever pays it. `null` for an encoding that did not BEAT identity:
 *  writing it would make the server ship a larger body than the file it sits
 *  beside. */
const encode = (encoding: string, raw: Buffer): Buffer | null => {
  const out =
    encoding === "br"
      ? brotliCompressSync(raw, {
          params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
            [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.byteLength,
          },
        })
      : encoding === "zstd"
        ? zstdCompressSync(raw, {
            params: { [zlibConstants.ZSTD_c_compressionLevel]: 19 },
          })
        : gzipSync(raw, { level: 9 });
  return out.byteLength < raw.byteLength ? out : null;
};

/** Size of `path`, or `null` when it does not exist. Any other error is a real
 *  filesystem fault and surfaces. */
const sizeOf = async (path: string): Promise<number | null> => {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

/**
 * Delete everything under `assetsDir` that this build did not produce.
 *
 * `keep` is the file NAMES the build just wrote (bundle entry, chunks,
 * sourcemaps, extra hashed assets). Their precompressed siblings and linked
 * `.map`s are kept with them — the siblings so the skip above stays worth
 * having, the maps because a linked sourcemap belongs to its asset.
 *
 * The hashed-asset dir is this package's to own: everything in it is named by
 * content and referenced only from the shell the same build wrote, so a file
 * from an earlier build is unreachable by definition. An app's own stable-URL
 * files (icons, fonts, a manifest) live at the dist ROOT, outside this dir, and
 * are never touched.
 *
 * Returns the names removed.
 */
export async function pruneAssets(
  assetsDir: string,
  keep: Iterable<string>,
): Promise<readonly string[]> {
  const live = new Set<string>();
  for (const name of keep) {
    live.add(name);
    live.add(`${name}.map`);
    for (const suffix of SIBLING_SUFFIXES) {
      live.add(`${name}${suffix}`);
      live.add(`${name}.map${suffix}`);
    }
  }
  const removed: string[] = [];
  for (const name of await readdir(assetsDir)) {
    if (live.has(name)) continue;
    await rm(join(assetsDir, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

/**
 * Write the `br`/`zstd`/`gzip` siblings `freshStaticLayer` negotiates, for every
 * compressible asset in `assetsDir`.
 *
 * Siblings are never inputs (a `.br` is not itself compressible), an existing
 * sibling is left alone (content hashing makes it current by construction), and
 * an encoding that lost to identity is not written at all.
 *
 * Returns one row per asset considered — including the ones nothing was written
 * for — so a build can report the win without walking the tree again.
 */
export async function precompressAssets(
  assetsDir: string,
): Promise<readonly AssetReport[]> {
  const reports: AssetReport[] = [];
  for (const name of (await readdir(assetsDir)).sort()) {
    if (!COMPRESSIBLE_EXT.has(extOf(name))) continue;
    const path = join(assetsDir, name);
    const siblings: Record<string, number> = {};
    const raw = await readFile(path);
    for (const [encoding, suffix] of PRECOMPRESSED_ENCODINGS) {
      const existing = await sizeOf(path + suffix);
      if (existing !== null) {
        siblings[encoding] = existing;
        continue;
      }
      if (raw.byteLength < MIN_BYTES) continue;
      const compressed = encode(encoding, raw);
      if (compressed === null) continue;
      await writeFile(path + suffix, compressed);
      siblings[encoding] = compressed.byteLength;
    }
    reports.push({ file: name, bytes: raw.byteLength, siblings });
  }
  return reports;
}
