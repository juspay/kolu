/**
 * `serveKoluMcp` — the kolu MCP face: `padiSurface` re-exposed to a coding
 * agent over MCP via `@kolu/surface-mcp`, curated by the ratified v1 expose
 * map ({@link KOLU_MCP_EXPOSE}) plus the face's bespoke tools.
 *
 * This package owns ZERO connect code — the composition root (kolu-cli)
 * injects `connect`, a factory producing a CONNECTED, padi-scoped client
 * (local digest-keyed socket or the ssh stdio dial). The factory is re-invoked
 * by the adapter after a drop, which is exactly the restart discipline's
 * redial hook: kolu-cli's factory re-RESOLVES the digest-keyed socket (an
 * upgraded padi listens at a different path), re-dials, and re-runs the
 * hello/compat gate — so a padi restart heals here without this package
 * knowing what a socket is. The package manifest is the graduation fence:
 * padi/surface deps only, no kolu app package.
 */

import { padiSurface } from "@kolu/padi/surface";
import type { PadiSurfaceClient } from "@kolu/padi/dial";
import { type BespokeTool, serveSurfaceAsMcp } from "@kolu/surface-mcp";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { KOLU_MCP_EXPOSE } from "./expose.ts";
import { screenTextTool } from "./screenText.ts";
import { sendInputTool } from "./sendInput.ts";
import { waitAgentStateTool, waitOutputSettledTool } from "./wait.ts";

/** A live, padi-scoped connection the injected factory produces. `dispose`
 *  closes the socket/pipe the factory opened — the adapter calls it on
 *  teardown and before every re-dial. */
export interface KoluMcpConnection {
  client: PadiSurfaceClient;
  dispose: () => void;
}

/** The face's bespoke tools, named once so the serve call and the tests read
 *  one registry: the named-key send, the tail-mode snapshot, and the two
 *  composite wait done-signals. */
export const KOLU_MCP_TOOLS: Record<string, BespokeTool> = {
  lifecycle_sendInput: sendInputTool,
  screen_text: screenTextTool,
  wait_outputSettled: waitOutputSettledTool,
  wait_agentState: waitAgentStateTool,
};

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
    surface: padiSurface,
    client: opts.connect,
    expose: KOLU_MCP_EXPOSE,
    tools: KOLU_MCP_TOOLS,
    serverInfo: opts.serverInfo,
    ...(opts.transport !== undefined ? { transport: opts.transport } : {}),
  });
}
