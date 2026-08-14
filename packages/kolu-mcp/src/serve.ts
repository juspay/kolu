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
 * The connection also carries the transport's close announcement, so a restart
 * costs no request — see {@link OwnedSurfaceConnection.onClose}
 * (juspay/kolu#2082).
 */

import { padiSurface } from "@kolu/padi/surface";
import type { PadiSurfaceClient } from "@kolu/padi/dial";
import {
  type BespokeTool,
  type OwnedSurfaceConnection,
  serveSurfaceAsMcp,
} from "@kolu/surface-mcp";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createTool } from "./create.ts";
import { KOLU_MCP_EXPOSE } from "./expose.ts";
import { screenTextTool } from "./screenText.ts";
import { sendInputTool } from "./sendInput.ts";
import { waitAgentStateTool, waitOutputSettledTool } from "./wait.ts";
import { watchNextTool } from "./watchNext.ts";

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
 *  arm supplies it: see {@link OwnedSurfaceConnection}. `PadiSurfaceClient` is
 *  the `buildSurfaceFace` shape — a streaming member hands back a lazy `Stream`,
 *  a procedure a `Promise`, no `AbortSignal` anywhere (D10/#18) — which is
 *  exactly what the adapter asks for, so this needs no adapter of its own. */
export interface KoluMcpConnection extends OwnedSurfaceConnection {
  client: PadiSurfaceClient;
}

/** The face's bespoke tools, named once so the serve call and the tests read
 *  one registry: the worktree-capable create, the named-key send, the
 *  tail-mode snapshot, the two composite wait done-signals, and the
 *  standing-subscription drain. */
export const KOLU_MCP_TOOLS: Record<string, BespokeTool> = {
  lifecycle_create: createTool,
  lifecycle_sendInput: sendInputTool,
  screen_text: screenTextTool,
  wait_outputSettled: waitOutputSettledTool,
  wait_agentState: waitAgentStateTool,
  watch_next: watchNextTool,
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
