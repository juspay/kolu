import { padiSurface } from "@kolu/padi-client/surface";
import type { KoluSurfaceClients } from "./bundleClient.ts";
import {
  type OwnedSurfaceConnection,
  serveSurfaceAsMcp,
} from "@kolu/surface-mcp";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { KOLU_MCP_EXPOSE } from "./expose.ts";
import { KOLU_MCP_TOOLS } from "./tools.ts";

/** A live, padi-scoped connection the injected factory produces — the adapter's
 *  own {@link OwnedSurfaceConnection} with the client narrowed to padi's face.
 *
 *  Deliberately an EXTENSION rather than a re-declaration of the same three
 *  fields, for the reason `kolu-cli`'s alias gives one level down: a field added
 *  to the adapter's shape and forgotten here would drift in silence, because the
 *  value crosses into `serveSurfaceAsMcp` by structural width-subtyping alone.
 *  That is #2082's own failure mode — a hop that quietly fails to carry a field
 *  — one layer up from where it was fixed.
 *
 *  Field docs live on the base, including why `onClose` is optional and which
 *  arm supplies it: see {@link OwnedSurfaceConnection}. The client is kolu's
 *  ROOTED BUNDLE ({@link KoluSurfaceClients}) — padi as the unprefixed core, no
 *  siblings — whose `core` is the `buildSurfaceFace` shape (a streaming member
 *  hands back a lazy `Stream`, a procedure a `Promise`, no `AbortSignal`
 *  anywhere — D10/#18), which is exactly what the adapter asks for, so this
 *  needs no adapter of its own. */
export interface KoluMcpConnection extends OwnedSurfaceConnection {
  client: KoluSurfaceClients;
}

export interface ServeKoluMcpOptions {
  /** Produce a connected padi client. Re-invoked after a transport drop —
   *  MUST re-resolve + re-dial + re-gate, never cache a dead socket. */
  connect: () => Promise<KoluMcpConnection>;
  /** The `serverInfo` the MCP host sees. REQUIRED — the composition root
   *  passes the product version so `kolu mcp` can never diverge from
   *  `kolu --version`; a baked fallback here would silently undercut exactly
   *  that invariant (the fail-fast rule: no default masking a missing
   *  required value). Tests pass an explicit stub. */
  serverInfo: { name: string; version: string };
  /** Transport override for tests (an `InMemoryTransport` half); defaults to
   *  stdio inside the adapter. */
  transport?: Transport;
}

/** Build + connect the kolu MCP server. Returns the low-level `Server` and a
 *  `close()`; the CALLER owns process lifetime (a stdio face exits when its
 *  transport closes — kolu-cli wires that). */
export async function serveKoluMcp(
  opts: ServeKoluMcpOptions,
): Promise<{ server: Server; close: () => Promise<void> }> {
  return serveSurfaceAsMcp({
    core: { surface: padiSurface, expose: KOLU_MCP_EXPOSE },
    client: opts.connect,
    tools: KOLU_MCP_TOOLS,
    serverInfo: opts.serverInfo,
    ...(opts.transport !== undefined ? { transport: opts.transport } : {}),
  });
}
