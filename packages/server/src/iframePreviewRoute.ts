/** Kolu glue for the iframe-preview file ROUTE (`/api/terminals/:id/file/*`,
 *  served to a `kind: "binary"` preview). The actual file serving (range,
 *  content-type, lexical guard) is the agnostic `@kolu/serve-dir`; this module
 *  owns the kolu-specific bits the consumer injects into it:
 *    - the realpath/symlink-escape guard kolu wires into `createDirServer`
 *      (`previewRealpathGuard`), defined once here so `index.ts` and its test
 *      use the SAME shipped adapter rather than each re-deriving it;
 *    - the raw-request-target selection + prefix slice the guard depends on
 *      (`rawTargetFromContext` / `previewTailFromRawUrl`).
 *  The preview URL SHAPE (`buildIframePreviewUrl`, the `?v=<mtime>` cache key)
 *  is now browser-safe in `kolu-common/preview` — the CLIENT mints it (the Code
 *  tab does the binary-preview orchestration the `fsReadFile` stream used to). */

import type { HttpBindings } from "@hono/node-server";
import { rawPathname, type RealpathGuard } from "@kolu/serve-dir";
import type { Context } from "hono";
import {
  TERMINAL_FILE_ROUTE_BASE,
  TERMINAL_FILE_ROUTE_FILE_SEGMENT,
} from "kolu-common/preview";
import { assertRealpathUnder } from "kolu-git";

/** The RAW, un-normalized request target `previewTailFromRawUrl` must slice —
 *  resolved here so the selection lives in ONE place the route and its test both
 *  call (sibling to `previewRealpathGuard`'s rule: one shipped adapter, not two
 *  copies that drift). Returns the Node `IncomingMessage.url`
 *  (`c.env.incoming.url`), the origin-form target @hono/node-server receives
 *  before any normalization.
 *
 *  Returns `undefined` (a no-match sentinel) when `incoming` is absent. We do
 *  NOT fall back to `c.req.raw.url`: that value is built via `new URL(...).href`
 *  and HAS run WHATWG path normalization (collapsing `foo/../secret`), so it
 *  can't defend the `..` guard this module exists to enforce. Falling back would
 *  fail OPEN — silently serving the exact normalized target the guard rejects.
 *  Kolu's only production adapter is @hono/node-server, which always supplies
 *  `incoming`; the absent case is a fail-closed error the route maps to a 500,
 *  not a quiet downgrade to an unsafe serve.
 *
 *  `c.env` is read as `Partial<HttpBindings>` so this works whether or not the
 *  caller's app typed the node binding into its env. */
export function rawTargetFromContext(c: Context): string | undefined {
  return (c.env as Partial<HttpBindings>).incoming?.url;
}

/** Extract the still-encoded path tail for a terminal's preview route from a
 *  RAW request URL. Slices off `${BASE}/{terminalId}/${FILE}/`, returning the
 *  remaining percent-encoded segments (or `""` when the URL doesn't match the
 *  prefix — the route registration guarantees it does, but the guard keeps this
 *  pure and total).
 *
 *  The un-normalized pathname comes from serve-dir's `rawPathname`, NOT
 *  `new URL(rawUrl).pathname` / Hono's `c.req.path` / `c.req.param("*")` — see
 *  `rawPathname`'s doc comment for why every pre-normalizing/pre-decoding source
 *  defeats a guard serve-dir is supposed to enforce. Here we only add the
 *  kolu-specific prefix slice on top of that raw pathname. */
export function previewTailFromRawUrl(
  rawUrl: string,
  terminalId: string,
): string {
  const prefix = `${TERMINAL_FILE_ROUTE_BASE}/${terminalId}/${TERMINAL_FILE_ROUTE_FILE_SEGMENT}/`;
  const pathname = rawPathname(rawUrl);
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
