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
import { buildTerminalFileUrl } from "kolu-common/preview";
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

/** The filesystem-authority guard kolu injects into `@kolu/serve-dir` for a
 *  given root: resolve symlinks and reject anything whose real path escapes the
 *  root (a repo-local `leak.html -> /etc/passwd` an agent could plant). Wraps
 *  kolu-git's `assertRealpathUnder` into the `RealpathGuard` shape. Defined here
 *  — not inlined at the route — so the route and its test exercise one shipped
 *  adapter, not two copies that can drift. */
export function previewRealpathGuard(root: string): RealpathGuard {
  return async (abs) => (await assertRealpathUnder(root, abs)).ok;
}
