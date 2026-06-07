/** Kolu glue for the iframe-preview file surface
 *  (`FsReadFileOutput.kind === "binary"`). The actual file serving (range,
 *  content-type, lexical guard) is the agnostic `@kolu/serve-dir`; this module
 *  owns the kolu-specific bits the consumer injects into it:
 *    - the per-terminal preview URL shape (the `?v=<mtime>` cache key +
 *      route-shape constants), shared with the client (which builds the same
 *      URLs to resolve repo-relative Markdown image srcs);
 *    - the realpath/symlink-escape guard kolu wires into `createDirServer`
 *      (`previewRealpathGuard`), defined once here so `index.ts` and its test
 *      use the SAME shipped adapter rather than each re-deriving it. */

import type { RealpathGuard } from "@kolu/serve-dir";
import {
  buildTerminalFileUrl,
  TERMINAL_FILE_ROUTE_BASE,
  TERMINAL_FILE_ROUTE_FILE_SEGMENT,
} from "kolu-common/preview";
import { assertRealpathUnder } from "kolu-git";

// The route-shape contract (`TERMINAL_FILE_ROUTE_BASE`,
// `TERMINAL_FILE_ROUTE_FILE_SEGMENT`, `buildTerminalFileUrl`) lives in
// `kolu-common/preview` so the client can build the same URLs. Re-exported here
// so the Hono route registration in `index.ts` keeps importing them from this
// module.
export {
  TERMINAL_FILE_ROUTE_BASE,
  TERMINAL_FILE_ROUTE_FILE_SEGMENT,
} from "kolu-common/preview";

/** Canonical URL shape for the iframe-served file route, used in
 *  `FsReadFileOutput.kind === "binary"` and matched by the Hono route in
 *  `index.ts`. `mtimeMs` is rounded down so a stable file always produces the
 *  same URL (the browser caches the iframe content per URL; an mtime bump mints
 *  a fresh URL → fresh fetch). */
export function buildIframePreviewUrl(
  terminalId: string,
  filePath: string,
  mtimeMs: number,
): string {
  return `${buildTerminalFileUrl(terminalId, filePath)}?v=${Math.floor(mtimeMs)}`;
}

/** Extract the still-encoded path tail for a terminal's preview route from a
 *  RAW request URL. Slices off `${BASE}/{terminalId}/${FILE}/`, returning the
 *  remaining percent-encoded segments (or `""` when the URL doesn't match the
 *  prefix — the route registration guarantees it does, but the guard keeps this
 *  pure and total).
 *
 *  Must be fed the RAW, undecoded pathname (`new URL(req.url).pathname`), NOT
 *  Hono's `c.req.path` (`decodeURI`d) or `c.req.param("*")` (`decodeURIComponent`d):
 *  `@kolu/serve-dir` decodes the tail exactly once (decode-then-split), so any
 *  pre-decoded source double-decodes. That breaks both correctness and security:
 *    - a real file `100% done.mp4` is URL-built as `100%25%20done.mp4`; pre-
 *      decoding to `100% done.mp4` then makes serve-dir's `decodeURIComponent`
 *      throw on the bare `% ` → a spurious 400 for a legitimate file;
 *    - pre-decoding `%2f` → `/` erases segment boundaries before serve-dir's
 *      per-segment `..` check runs, letting `foo%2f..%2fpasswd` traverse out.
 *  The raw tail keeps `%`-bearing names round-tripping AND a literal `%2f` as
 *  one segment, while an attacker's encoded `%2f` becomes a real boundary the
 *  per-segment check rejects. */
export function previewTailFromRawUrl(
  rawUrl: string,
  terminalId: string,
): string {
  const prefix = `${TERMINAL_FILE_ROUTE_BASE}/${terminalId}/${TERMINAL_FILE_ROUTE_FILE_SEGMENT}/`;
  const pathname = new URL(rawUrl).pathname;
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
}

/** The filesystem-authority guard kolu injects into `@kolu/serve-dir` for a
 *  given root: resolve symlinks and reject anything whose real path escapes the
 *  root (a repo-local `leak.html -> /etc/passwd` an agent could plant). Wraps
 *  kolu-git's `assertRealpathUnder` into the `RealpathGuard` shape. Defined here
 *  — not inlined at the route — so the route and its test exercise one shipped
 *  adapter, not two copies that can drift. */
export function previewRealpathGuard(root: string): RealpathGuard {
  return async (abs) => (await assertRealpathUnder(root, abs)).ok;
}
