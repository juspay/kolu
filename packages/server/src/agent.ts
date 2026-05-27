/**
 * Agent entry point — booted when the kolu binary is invoked with
 * `--stdio` (typically `ssh $host kolu --stdio` after the parent's
 * `HostSession` has copied + realised the .drv on the remote).
 *
 * The agent serves `agentSurface` over stdin/stdout via
 * `@kolu/surface/peer-server`. **Stdout is the protocol channel** — all
 * logging goes to fd 2, forced in `./log.ts` at module load when
 * `--stdio` is detected (lesson #4).
 *
 * Slice 2b ships `system.heartbeat` only; the terminal/fs/git
 * procedures arrive in slices 2d/2e and plug into the same router
 * via `serveAgent(deps, opts)`.
 */

import { implement } from "@orpc/server";
import {
  serveOverStdio,
  type ServeOverStdioOptions,
} from "@kolu/surface/peer-server";
import {
  implementSurface,
  type ImplementSurfaceDeps,
  inMemoryChannelByName,
} from "@kolu/surface/server";
import {
  agentSurface,
  type AgentTerminalMetadata,
} from "kolu-common/agentSurface";
import type { TerminalId } from "kolu-common/surface";
import { log } from "./log.ts";

export type AgentImplDeps = ImplementSurfaceDeps<typeof agentSurface.spec>;

/** Wrap an agent-surface implementation in `serveOverStdio`. Centralises
 *  the load-bearing `implement(contract).router({...fragment.router})`
 *  re-wrap (which flattens the `surface.` prefix so requests don't 404)
 *  and the `router as any` cast that oRPC's `Router<any, T>` input type
 *  forces on `implementSurface`'s `Lazy<Router>` spread. Both the real
 *  agent (this module's `runAgent`) and the loopback test
 *  (`agent.test.ts`) route through this — the wire-wrap chunk stays
 *  identical across slice 2d's backend swap, so factoring it out keeps
 *  the cast + biome-ignore in exactly one place. */
export function serveAgent(
  deps: AgentImplDeps,
  opts: Omit<ServeOverStdioOptions<object>, "router"> = {},
): Promise<void> {
  const fragment = implementSurface(agentSurface, deps);
  const router = implement(agentSurface.contract).router({
    ...fragment.router,
  });
  return serveOverStdio({
    // biome-ignore lint/suspicious/noExplicitAny: implementSurface's Lazy<Router> spread isn't accepted by oRPC's Router<any, T> input type; runtime shape is valid (same pattern as kolu's main server.ts and the remote-process-monitor demo).
    router: router as any,
    ...opts,
  });
}

export async function runAgent(): Promise<void> {
  log.info({ pid: process.pid }, "agent starting");

  // Empty store for `terminalMetadata` — slice 2d populates this from
  // the agent's `LocalTerminalBackend` once that wiring lands. The
  // collection is declared now so the parent's `RemoteTerminalBackend`
  // can already subscribe via `mirrorRemoteCollection` (which yields
  // an empty snapshot then waits for upserts).
  const terminalMetadataSnapshot = new Map<TerminalId, AgentTerminalMetadata>();

  log.info("serving agent surface over stdio");
  await serveAgent(
    {
      channel: inMemoryChannelByName(),
      collections: {
        terminalMetadata: {
          readAll: () => terminalMetadataSnapshot,
          upsert: (key, value) => {
            terminalMetadataSnapshot.set(key, value);
          },
          remove: (key) => {
            terminalMetadataSnapshot.delete(key);
          },
        },
      },
      procedures: {
        system: {
          heartbeat: async () => ({ ok: true, pid: process.pid }),
        },
      },
    },
    { onFirstRequest: () => log.info("first RPC received — link is live") },
  );
  log.info("stdin closed — agent exiting");
}
