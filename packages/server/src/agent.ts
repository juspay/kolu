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
 * procedures arrive in slices 2d/2e and plug into the same router.
 */

import { implement } from "@orpc/server";
import { serveOverStdio } from "@kolu/surface/peer-server";
import { implementSurface, inMemoryChannelByName } from "@kolu/surface/server";
import {
  agentSurface,
  type AgentTerminalMetadata,
} from "kolu-common/agentSurface";
import type { TerminalId } from "kolu-common/surface";
import { log } from "./log.ts";

export async function runAgent(): Promise<void> {
  log.info({ pid: process.pid }, "agent starting");

  // Empty store for `terminalMetadata` — slice 2d populates this from
  // the agent's `LocalTerminalBackend` once that wiring lands. The
  // collection is declared now so the parent's `RemoteTerminalBackend`
  // can already subscribe via `mirrorRemoteCollection` (which yields
  // an empty snapshot then waits for upserts).
  const terminalMetadataSnapshot = new Map<TerminalId, AgentTerminalMetadata>();

  const fragment = implementSurface(agentSurface, {
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
  });

  // `implementSurface` returns a fragment shaped `{ surface: ... }`;
  // wrap once via `implement(contract).router(...)` so the path
  // doesn't double-prefix (every request would 404 otherwise — same
  // footgun the remote-process-monitor demo documents).
  const router = implement(agentSurface.contract).router({
    ...fragment.router,
  });

  log.info("serving agent surface over stdio");
  await serveOverStdio({
    // biome-ignore lint/suspicious/noExplicitAny: implementSurface's Lazy<Router> spread isn't accepted by oRPC's Router<any, T> input type; runtime shape is valid (same pattern as kolu's main server.ts and the remote-process-monitor demo).
    router: router as any,
    onFirstRequest: () => log.info("first RPC received — link is live"),
  });
  log.info("stdin closed — agent exiting");
}
