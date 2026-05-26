/**
 * `kolu agent --stdio` — runs `LocalBackend` behind oRPC over
 * stdin/stdout via the `agentSurface` (kolu-common/agentSurface).
 *
 * Plan B Surface-subsumption Phase 2: the agent serves the typed
 * reactive surface declared by `defineSurface`, paired with the
 * `serveOverStdio` runtime from `@kolu/surface/peer-server`. Zero
 * remote-specific business logic — the agent is the same kolu binary
 * running with a different transport.
 *
 * Lifecycle: on `--stdio`, the dispatcher in `index.ts` calls
 * `runAgent()`. It builds the agent's surface fragment, wraps it as a
 * top-level router with `implement(agentSurface.contract).router(...)`,
 * and hands it to `serveOverStdio` which pumps `process.stdin` /
 * `process.stdout` through `ServerPeer`. Stdin close triggers
 * `killAllTerminals` + `process.exit(0)`.
 *
 * **The agent's stdout is the protocol channel.** All log output
 * MUST go to stderr — see `log.ts` for the agent-mode redirect.
 */

import { implement } from "@orpc/server";
import { serveOverStdio } from "@kolu/surface/peer-server";
import { agentSurface } from "kolu-common/agentSurface";
import { buildAgentSurface } from "./agent-surface.ts";
import { log } from "./log.ts";

/**
 * Entry point for `kolu agent --stdio`.
 *
 * Constructs the surface router from `buildAgentSurface` (which wires
 * `agentSurface`'s deps to `localBackend`), re-wraps the fragment as
 * a proper top-level router via `implement(...).router(...)` so the
 * stdio `StandardRPCHandler` walks paths from the root correctly,
 * then serves over the process's stdin/stdout.
 */
export async function runAgent(): Promise<void> {
  const { router: surfaceFragment } = buildAgentSurface();

  const t = implement(agentSurface.contract);
  // biome-ignore lint/suspicious/noExplicitAny: see comment.
  const router = t.router(surfaceFragment as any);
  // The router fragment from implementSurface is `{ surface: <inner> }`
  // — a plain-object wrapper. Re-wrapping with `t.router(...)` produces
  // a properly-built top-level router so oRPC's StandardRPCHandler
  // descends through `surface.*` paths correctly. Documented in
  // peerServer.ts JSDoc.

  log.info("kolu agent --stdio: serving on stdin/stdout via agentSurface");

  await serveOverStdio({
    router,
    onError: (err) => {
      log.error({ err }, "kolu agent: message handler error");
    },
    onClose: () => {
      log.info("kolu agent: stdin closed, shutting down");
      // Clean up any spawned terminals before exiting.
      void import("./terminals.ts").then(({ killAllTerminals }) => {
        killAllTerminals();
        process.exit(0);
      });
    },
  });
}
