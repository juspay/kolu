/**
 * `serveKoluMcp` — the kolu MCP face: `padiSurface` re-exposed to a coding
 * agent over MCP via `@kolu/surface-mcp`, curated by the ratified v1 expose
 * map ({@link KOLU_MCP_EXPOSE}) plus the face's bespoke tools.
 *
 * This package owns ZERO connect code — the composition root (kolu-cli)
 * injects `connect`, a factory producing a CONNECTED, padi-scoped client
 * (local digest-keyed socket or the ssh stdio dial). The factory is re-invoked
 * by the adapter after a drop, which is exactly the restart discipline's
 * redial hook: kolu-cli's factory re-RESOLVES the running padi's socket and
 * re-runs the hello/compat gate. The socket path is keyed by a digest of the
 * STATE-ROOT (stable across a normal restart/upgrade — a padi that respawns at
 * the same state-root listens at the same path), so the re-resolve is for
 * robustness (a moved state-root, a different running daemon) and the compat
 * gate is what proves the new generation speaks our contract — a padi restart
 * heals here without this package knowing what a socket is. The package
 * manifest is the graduation fence: padi/surface deps only, no kolu app package.
 *
 * A redial hook alone only says where a restart heals, not when the adapter
 * NOTICES one, and that gap had a cost: the adapter used to find out by spending
 * a request on the dead socket, so the first padi-backed request after every
 * restart failed (juspay/kolu#2082). The connection therefore also carries
 * `onClose` — padi ANNOUNCES its own transport dropping — and the adapter
 * discards the dead connection the moment it hears, before any request is routed
 * to it.
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
 *  teardown and before every re-dial.
 *
 *  `PadiSurfaceClient` is now the `buildSurfaceFace` shape: a streaming member
 *  hands back a lazy `Stream` and a procedure returns a `Promise`, with no
 *  `AbortSignal` option anywhere (D10/#18 — cancellation is fiber
 *  interruption). That is exactly what `@kolu/surface-mcp`'s
 *  `ClientOrConnection` now asks for, so this interface needs no adapter. */
export interface KoluMcpConnection {
  client: PadiSurfaceClient;
  dispose: () => void;
  /** Subscribe to this connection's transport dropping. Fires at most once.
   *
   *  The redial hook below says WHERE a restart heals; this says WHEN the
   *  adapter finds out. Without it the adapter learns only by failing a request
   *  against the dead socket, which is why the first padi-backed request after
   *  every padi restart used to fail (juspay/kolu#2082). Supplied by the local
   *  dial (padi's `DaemonConnection` contract carries it); absent on the ssh
   *  `--host` arm, which has no close signal to offer yet. */
  onClose?: (cb: () => void) => void;
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
