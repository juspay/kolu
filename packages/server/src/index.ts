/**
 * Entry-point dispatcher. Two modes:
 *
 *   - `kolu --stdio`  → agent mode (`./agent.ts` → `serveOverStdio`).
 *                       No HTTP server, no Conf stores, no terminal
 *                       registry — the agent is a pure protocol peer.
 *   - otherwise       → HTTP+WS server (`./httpServer.ts`).
 *
 * Dynamic imports keep agent mode from paying the cost of loading
 * surface.ts / router.ts / terminal-registry — those modules have
 * top-level side effects (`confStore` disk I/O, `getTerminalBackendFor`
 * creating the local backend singleton) that agent mode neither needs
 * nor wants.
 */

import { isStdioAgent } from "./log.ts";

if (isStdioAgent) {
  const { runAgent } = await import("./agent.ts");
  await runAgent();
  process.exit(0);
} else {
  await import("./httpServer.ts");
}
