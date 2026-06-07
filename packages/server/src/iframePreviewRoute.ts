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

import type { HttpBindings } from "@hono/node-server";
import type { RealpathGuard } from "@kolu/serve-dir";
import type { Context } from "hono";
import {
  buildTerminalFileUrl,
  TERMINAL_FILE_ROUTE_BASE,
  TERMINAL_FILE_ROUTE_FILE_SEGMENT,
} from "kolu-common/preview";
import { assertRealpathUnder } from "kolu-git";

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

/** The RAW, un-normalized request target `previewTailFromRawUrl` must slice —
 *  resolved here so the unsafe fallback lives in ONE place the route and its
 *  test both call (sibling to `previewRealpathGuard`'s rule: one shipped adapter,
 *  not two copies that drift). Prefer the Node `IncomingMessage.url`
 *  (`c.env.incoming.url`), the origin-form target @hono/node-server receives
 *  before any normalization. Fall back to `c.req.raw.url` only when `incoming`
 *  is absent (a non-node adapter / test harness) to keep the route total —
 *  note that fallback is built via `new URL(...).href` and HAS run WHATWG path
 *  normalization, so it can't defend the `..` guard; it exists purely so the
 *  handler never throws on a missing binding. `c.env` is read as
 *  `Partial<HttpBindings>` so this works whether or not the caller's app typed
 *  the node binding into its env. */
export function rawTargetFromContext(c: Context): string {
  return (c.env as Partial<HttpBindings>).incoming?.url ?? c.req.raw.url;
}

/** Extract the still-encoded path tail for a terminal's preview route from a
 *  RAW request URL. Slices off `${BASE}/{terminalId}/${FILE}/`, returning the
 *  remaining percent-encoded segments (or `""` when the URL doesn't match the
 *  prefix — the route registration guarantees it does, but the guard keeps this
 *  pure and total).
 *
 *  Must yield the RAW, byte-for-byte pathname — NOT `new URL(rawUrl).pathname`,
 *  Hono's `c.req.path` (`decodeURI`d), or `c.req.param("*")`
 *  (`decodeURIComponent`d). All three pre-process the tail before
 *  `@kolu/serve-dir` does its single decode-then-split, and each pre-process
 *  defeats a guard serve-dir is supposed to enforce:
 *    - `URL.pathname` runs WHATWG path normalization, which COLLAPSES dot
 *      segments before we ever slice: `…/file/foo/%2e%2e/secret.html` (and the
 *      literal `…/file/foo/../secret.html`) both normalize to
 *      `…/file/secret.html`, so serve-dir never sees the `..` its per-segment
 *      check rejects with 400 — it would serve the sibling instead. Slicing the
 *      raw URL string keeps the `..` segment intact for that check.
 *    - decoding (`decodeURI`/`decodeURIComponent`) double-decodes: a real file
 *      `100% done.mp4` is built as `100%25%20done.mp4`; pre-decoding to
 *      `100% done.mp4` makes serve-dir's `decodeURIComponent` throw on the bare
 *      `% ` → a spurious 400; and pre-decoding `%2f` → `/` erases segment
 *      boundaries, letting `foo%2f..%2fpasswd` traverse out.
 *  Slicing the raw string keeps `%`-bearing names round-tripping, a literal
 *  `%2f` as one segment, AND any `..` segment visible — so serve-dir's single
 *  decode-then-split is the sole, authoritative normalization. */
export function previewTailFromRawUrl(
  rawUrl: string,
  terminalId: string,
): string {
  const prefix = `${TERMINAL_FILE_ROUTE_BASE}/${terminalId}/${TERMINAL_FILE_ROUTE_FILE_SEGMENT}/`;
  const pathname = rawPathname(rawUrl);
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
}

/** The path portion of a request URL WITHOUT WHATWG normalization. `URL`
 *  canonicalizes dot segments, so we slice the raw string instead: drop the
 *  `scheme://authority` prefix, then cut at the first `?` or `#`. Node's HTTP
 *  request URL is origin-form (`/path?query`) or absolute-form
 *  (`scheme://host/path`); both are handled. */
function rawPathname(rawUrl: string): string {
  // Strip `scheme://authority` if present (absolute-form); origin-form already
  // starts with `/`.
  const afterAuthority = rawUrl.replace(/^[a-zA-Z][\w+.-]*:\/\/[^/]*/, "");
  // Path ends at the first `?` (query) or `#` (fragment). `search` is -1 when
  // neither is present, so `slice(0, -1)` would be wrong — guard it explicitly.
  const search = afterAuthority.search(/[?#]/);
  return search === -1 ? afterAuthority : afterAuthority.slice(0, search);
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
