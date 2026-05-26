/**
 * Agent-surface implementation — wires `agentSurface` (from
 * `kolu-common/agentSurface`) to the in-process `localBackend` so the
 * agent process serves the surface alongside its PTY orchestration.
 *
 * What lives here:
 *
 *   - The `implementSurface` deps for `agentSurface` — collection
 *     readAll/upsert/remove, stream sources, procedure handlers — all
 *     delegating to `localBackend` and the terminal registry.
 *   - A per-terminal aggregator that subscribes to the legacy
 *     `terminalChannels` (cwd, git, agent, pr, foreground,
 *     commandRun) and republishes the aggregated
 *     `AgentTerminalMetadata` projection through the surface's
 *     `terminalMetadata` collection channel. Started at terminal
 *     spawn; stopped at kill.
 *
 * `buildAgentSurface()` returns the router + a pair of
 * `{startAggregator, stopAggregator}` closures that already have
 * `ctx` captured — no module-level mutable state, no temporal
 * contract to remember.
 */

import { implement, ORPCError } from "@orpc/server";
import {
  agentSurface,
  type AgentTerminalMetadata,
} from "kolu-common/agentSurface";
import type { TerminalMetadata } from "kolu-common/surface";
import { implementSurface, inMemoryChannel } from "@kolu/surface/server";
import { localBackend } from "./backend/local.ts";
import { log } from "./log.ts";
import { terminalChannels } from "./publisher.ts";
import { getTerminal, terminalEntries } from "./terminal-registry.ts";

/** Project the full `TerminalMetadata` (which includes
 *  client-managed fields like themeName/canvasLayout/etc.) down to
 *  the agent-managed subset shipped over the wire. */
export function projectAgentMetadata(
  meta: TerminalMetadata,
): AgentTerminalMetadata {
  return {
    cwd: meta.cwd,
    git: meta.git,
    lastAgentCommand: meta.lastAgentCommand,
    lastActivityAt: meta.lastActivityAt,
    pr: meta.pr,
    agent: meta.agent,
    foreground: meta.foreground,
  };
}

/** Channels whose every publish should trigger an aggregated
 *  `terminalMetadata` republish. Note: `title` is intentionally
 *  excluded — it isn't in `AgentTerminalMetadata` (it's an in-process
 *  transient consumed by the agent's own providers, not a field the
 *  surface ships), so subscribing here would just generate no-op
 *  republishes. */
const AGGREGATED_KINDS = [
  "cwd",
  "git",
  "commandRun",
  "agent",
  "pr",
  "foreground",
] as const;

/** Build the agent's surface router fragment, ctx, and lifecycle
 *  closures for the per-terminal aggregator. The aggregator captures
 *  `ctx` directly — callers don't have to set a global. */
export function buildAgentSurface() {
  const surface = implementSurface(agentSurface, {
    // biome-ignore lint/suspicious/noExplicitAny: per-call typed via the framework's generic helper
    channel: <T>(_name: string): any => inMemoryChannel<T>(),

    collections: {
      terminalMetadata: {
        readAll: () => {
          const map = new Map<string, AgentTerminalMetadata>();
          for (const [id, entry] of terminalEntries()) {
            map.set(id, projectAgentMetadata(entry.meta));
          }
          return map;
        },
        // The terminal registry IS the persistence layer — these are
        // no-ops because the framework's wrapped upsert/remove still
        // fires `perKeyBus.publish` after the no-op, which is what
        // subscribers see. The aggregator below uses
        // `ctx.collections.terminalMetadata.upsert(...)` to drive that
        // publish.
        upsert: (_id, _value) => {},
        remove: (_id) => {},
      },
    },

    streams: {
      terminalData: {
        source: (input, signal) =>
          localBackend.terminalChannel(input.id, "data", signal),
      },
      terminalCommandRun: {
        source: (input, signal) =>
          localBackend.terminalChannel(input.id, "commandRun", signal),
      },
      terminalTitle: {
        source: (input, signal) =>
          localBackend.terminalChannel(input.id, "title", signal),
      },
      fsRepoChange: {
        source: (input, signal) =>
          localBackend.fs.subscribeRepoChange(input.repoPath, signal),
      },
      fsFileChange: {
        source: (input, signal) =>
          localBackend.fs.subscribeFileChange(
            input.repoPath,
            input.filePath,
            signal,
          ),
      },
    },

    procedures: {
      system: {
        heartbeat: async () => ({ ok: true as const }),
      },
      terminal: {
        spawn: async ({ input }) => {
          const handle = await localBackend.spawnPty({
            id: input.id,
            cwd: input.cwd,
            initialMetadata: input.initialMetadata,
          });
          startAggregator(handle.id);
          return { id: handle.id };
        },
        kill: async ({ input }) => {
          stopAggregator(input.id);
          return localBackend.killTerminal(input.id);
        },
        write: async ({ input }) => {
          const entry = getTerminal(input.id);
          if (!entry) {
            throw new ORPCError("NOT_FOUND", {
              message: `terminal ${input.id} not found on agent`,
            });
          }
          entry.handle.write(input.data);
        },
        resize: async ({ input }) => {
          const entry = getTerminal(input.id);
          if (!entry) {
            throw new ORPCError("NOT_FOUND", {
              message: `terminal ${input.id} not found on agent`,
            });
          }
          entry.handle.resize(input.cols, input.rows);
        },
        uploadFile: async ({ input }) => ({
          path: await localBackend.uploadFile(
            input.id,
            input.name,
            input.base64Data,
          ),
        }),
      },
      fs: {
        listAll: async ({ input }) => ({
          paths: await localBackend.fs.listAll(input.repoPath),
        }),
        readFile: async ({ input }) => {
          const result = await localBackend.fs.readFile(
            input.repoPath,
            input.filePath,
          );
          return { kind: "text" as const, ...result };
        },
      },
      git: {
        getDiff: async ({ input }) =>
          localBackend.git.getDiff(
            input.repoPath,
            input.filePath,
            input.mode,
            input.oldPath,
          ),
        getStatus: async ({ input }) =>
          localBackend.git.getStatus(input.repoPath, input.mode),
      },
    },
  });

  const { router, ctx } = surface;

  // ── Per-terminal aggregator (ctx captured by closure) ───────────────
  //
  // One `() => void` per terminal: collects all `consume()` cleanup
  // fns into a single composed teardown so `stopAggregator(id)`
  // actually unsubscribes (no more leaked subscribers until process
  // exit). The previous AbortController-based shape was a teardown
  // contract the implementation didn't honor — the consume() return
  // values were discarded.
  const active = new Map<string, () => void>();

  const publishFor = (id: string): void => {
    const entry = getTerminal(id);
    if (!entry) return;
    ctx.collections.terminalMetadata.upsert(
      id,
      projectAgentMetadata(entry.meta),
    );
  };

  function startAggregator(id: string): void {
    if (active.has(id)) return;
    // Initial publish — seeds the collection with the current
    // projection so subscribers' first snapshot reflects state at
    // aggregator-start time.
    publishFor(id);

    const cleanups: Array<() => void> = [];
    for (const kind of AGGREGATED_KINDS) {
      cleanups.push(
        terminalChannels[kind](id).consume({
          onEvent: () => publishFor(id),
          onError: (err) =>
            log.warn(
              { id, kind, err },
              "agent-surface: aggregator consume error",
            ),
        }),
      );
    }
    active.set(id, () => {
      for (const fn of cleanups) fn();
    });
    log.info({ id }, "agent-surface: aggregator started");
  }

  function stopAggregator(id: string): void {
    const cleanup = active.get(id);
    if (!cleanup) return;
    cleanup();
    active.delete(id);
    ctx.collections.terminalMetadata.remove(id);
    log.info({ id }, "agent-surface: aggregator stopped");
  }

  return { router, ctx, startAggregator, stopAggregator };
}
