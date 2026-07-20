/**
 * kolu-mcp — the kolu binary's MCP face (`kolu mcp`), a pure `padiSurface`
 * client re-exposed to coding agents via `@kolu/surface-mcp`.
 *
 * The manifest is the graduation fence: this package depends on padi/surface
 * packages ONLY — no kolu app package — so `kolu mcp` provably serves agents
 * with no kolu-server behind it (the second-frontend proof, headless leg).
 * kolu-cli (the composition root) owns the connect layer and injects the
 * connected client.
 */

export { KOLU_MCP_DENIED, KOLU_MCP_EXPOSE } from "./expose.ts";
export {
  type KoluMcpConnection,
  KOLU_MCP_TOOLS,
  type ServeKoluMcpOptions,
  serveKoluMcp,
} from "./serve.ts";
