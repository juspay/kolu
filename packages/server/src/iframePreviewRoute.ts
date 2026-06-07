/** Kolu glue for the iframe-preview file surface
 *  (`FsReadFileOutput.kind === "binary"`): the per-terminal preview URL shape.
 *  The actual file serving (range, content-type, lexical guard) is the agnostic
 *  `createDirServer` in `serveDir.ts`; this module owns only the kolu-specific
 *  URL contract — the `?v=<mtime>` cache key and the route-shape constants —
 *  shared with the client (which builds the same URLs to resolve repo-relative
 *  Markdown image srcs). */

import { buildTerminalFileUrl } from "kolu-common/preview";

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
