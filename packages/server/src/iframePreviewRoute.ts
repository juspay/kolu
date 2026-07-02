/** Kolu glue for the iframe-preview file route
 *  (`FsReadFileOutput.kind === "binary"`). The byte read itself (range,
 *  content-type, lexical + realpath guard) is now padi's `readPreview` — the
 *  SAME impl `padiSurface.procedures.preview.read` serves, which the Hono route
 *  in `index.ts` re-backs onto (one impl, two callers). What remains here are
 *  the two PURE web-shell URL helpers the route needs to hand `readPreview` a
 *  correct, un-normalized file tail:
 *    - `rawTargetFromContext` selects the RAW request target
 *      (`c.env.incoming.url`), the origin-form URL before WHATWG normalization;
 *    - `previewTailFromRawUrl` slices the terminal-scoped file path out of it,
 *      keeping `%`-encoding intact so serve-dir's single decode recovers the
 *      real name and the per-segment `..`/`%2f` traversal guard still fires.
 *  Both are unit-tested in `iframePreviewRoute.test.ts`; the realpath/symlink
 *  guard's 403 coverage now lives against padi's `readPreview`. */

import type { HttpBindings } from "@hono/node-server";
import { rawPathname } from "@kolu/serve-dir";
import type { Context } from "hono";
import {
  TERMINAL_FILE_ROUTE_BASE,
  TERMINAL_FILE_ROUTE_FILE_SEGMENT,
} from "kolu-common/preview";

/** The RAW, un-normalized request target `previewTailFromRawUrl` must slice —
 *  resolved here so the selection lives in ONE place the route and its test both
 *  call. Returns the Node `IncomingMessage.url` (`c.env.incoming.url`), the
 *  origin-form target @hono/node-server receives before any normalization.
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
