/**
 * WHAT kolu's two projected faces dial, and how a bespoke verb reaches padi
 * through it.
 *
 * Both faces (`@kolu/surface-mcp`, `@kolu/surface-cli`) compose on a ROOTED
 * BUNDLE — an unprefixed core beside a keyed set of siblings. kolu's bundle is
 * the degenerate one: padi is the CORE, and there are no siblings today, which is
 * what keeps every tool name and every `surface://` URI exactly what it was.
 *
 * A bespoke verb declared at the BUNDLE ROOT is handed the bundle rather than one
 * surface's client (the rule both faces share: a verb receives the client of the
 * thing it is declared on), so each of kolu's tools reaches padi through
 * {@link padiOf}. That is one named hop replacing the bare `client as
 * PadiSurfaceClient` each of them used to spell — and it is the line that would
 * have to change, once, if kolu ever grew a sibling.
 *
 * SDK-FREE, like `tools.ts` beside it: the tool modules import from here and are
 * read by a command tree every `kolu` invocation builds, so nothing here may
 * reach the MCP server classes.
 */

import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type { RootedSurfaceClients } from "@kolu/surface/client";

/** kolu's bundle, client side: padi as the core, no siblings. */
export interface KoluSurfaceClients extends RootedSurfaceClients {
  readonly core: PadiSurfaceClient;
}

/** The padi client inside the bundle a bundle-root verb is handed.
 *
 *  The cast is this package's own idiom, unchanged in kind from the one it
 *  replaces: `SurfaceVerb.handler` types its client `any` (the face holds a
 *  consumer's client opaquely — D2), so the shape is asserted at exactly one
 *  place per face instead of at every handler. */
export function padiOf(client: unknown): PadiSurfaceClient {
  return (client as KoluSurfaceClients).core;
}
