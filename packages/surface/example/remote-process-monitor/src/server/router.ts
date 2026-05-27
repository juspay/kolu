/**
 * Parent-side router — bridges browser ↔ remote agent.
 *
 * The browser subscribes to the same `surface` as the agent serves. The
 * parent doesn't re-define a different surface; it implements the agent
 * surface locally by *forwarding* every read to the remote stdio client.
 * On a fresh subscriber, the parent:
 *
 *   1. Synchronously yields the parent's connection-state-aware
 *      `system` snapshot (state = "copying" / "connecting" / etc.).
 *   2. Once the agent's link is up, mirrors the agent's `system` and
 *      `processes` updates into the parent's local store/collection.
 *   3. Per-key process upserts/removes from the agent flow through to
 *      the framework's channels and on to the browser.
 *
 * `kill` forwards directly to the agent — the parent has no business
 * keeping its own state for an imperative mutation.
 */

import { implement } from "@orpc/server";
import {
  type CellStore,
  type Channel,
  implementSurface,
  inMemoryChannel,
  inMemoryStore,
} from "@kolu/surface/server";
import {
  type ConnectionInfo,
  DEFAULT_CONNECTION,
  DEFAULT_SYSTEM,
  type Pid,
  type Process,
  type SystemInfo,
  surface,
} from "../common/surface";
import type { AgentClient, HostSession } from "./hostSession";

export interface BuildRouterOptions {
  session: HostSession;
}

/** Build the parent's oRPC router. The session's connection state
 *  drives the `system.state` field exposed to the browser; agent data
 *  flows through once the link is live. */
export function buildRouter(opts: BuildRouterOptions) {
  const session = opts.session;
  const systemStore: CellStore<SystemInfo> = inMemoryStore({
    ...DEFAULT_SYSTEM,
  });
  const connectionStore: CellStore<ConnectionInfo> = inMemoryStore({
    ...DEFAULT_CONNECTION,
  });
  const processCache = new Map<Pid, Process>();

  const fragment = implementSurface(surface, {
    channel: <T>(_name: string): Channel<T> => inMemoryChannel<T>(),
    cells: {
      system: { store: systemStore },
      connection: { store: connectionStore },
    },
    collections: {
      processes: {
        readAll: () => processCache,
        // The framework's wrapped upsert/remove call these deps first
        // and only then publish through the keyed channels. If we throw
        // here (to "guard against browser writes"), the framework's own
        // bridging path — `ctx.collections.processes.upsert(...)` from
        // `reconcileProcesses` — also throws and the publish never fires.
        // Browser-vs-server isn't a write-vs-read distinction inside the
        // process; it's a wire-protocol distinction (the browser-facing
        // contract simply doesn't expose `upsert` / `remove`). So these
        // deps stay as the single in-process write seam.
        upsert: (key, value) => {
          processCache.set(key, value);
        },
        remove: (key) => {
          processCache.delete(key);
        },
      },
    },
    procedures: {
      process: {
        kill: async ({ input }) => {
          const client = await session.acquire();
          try {
            return await client.surface.process.kill(input);
          } finally {
            session.release();
          }
        },
      },
    },
  });

  // ── Mirror session connection state → parent's `connection` cell ──
  session.onState((s) => {
    fragment.ctx.cells.connection.set({ state: s.connection });
  });

  // ── Bridge remote agent surface → parent's local surface ──────────
  // Start a background pump that acquires the session, subscribes to
  // the remote system/processes streams, and mirrors deltas into the
  // local fragment ctx. Reconnects ride on top because the framework's
  // `ClientRetryPlugin` re-issues the subscription with snapshot-then-
  // delta semantics on each transport blip.
  void bridgeAgentToParent(session, fragment, processCache);

  // `implementSurface` returns a router *fragment* — `{ surface: ... }`
  // wrapping the per-key namespaces. Passing it directly to RPCHandler
  // produces a `surface/surface/...` double-prefix in the matcher tree
  // (no procedure matches what the client sends). Wrap once via
  // `implement(contract).router({...fragment})` to flatten the prefix
  // — this is the same pattern Kolu's own server uses when spreading
  // the surface fragment alongside raw oRPC procedures.
  const router = implement(surface.contract).router({ ...fragment.router });
  return { router, session };
}

type FragmentCtx = {
  ctx: {
    cells: { system: { set: (v: SystemInfo) => void } };
    collections: {
      processes: {
        upsert: (k: Pid, v: Process) => void;
        remove: (k: Pid) => void;
      };
    };
  };
};

/** Acquire the agent client and pump remote system+processes deltas into
 *  the parent's local fragment ctx. Each stream loop runs fire-and-forget;
 *  errors at stream end (transport blip, abort) are expected end-of-life
 *  noise — the session's reconnect loop drives the next subscribe. */
async function bridgeAgentToParent(
  session: HostSession,
  fragment: FragmentCtx,
  processCache: Map<Pid, Process>,
): Promise<void> {
  let client: AgentClient;
  try {
    client = await session.acquire();
  } catch {
    // session.spawn surfaces failure through state; bail out and
    // let the session's reconnect loop drive subsequent attempts.
    return;
  }
  // Don't release on background termination — the session is the
  // long-lived parent-side singleton and we want it kept warm.
  void pumpSystemCell(client, session, fragment);
  void pumpProcessesCollection(client, processCache, fragment);
}

/** Mirror the agent's system cell into the parent's local cell. */
async function pumpSystemCell(
  client: AgentClient,
  session: HostSession,
  fragment: FragmentCtx,
): Promise<void> {
  try {
    for await (const remoteSystem of await client.surface.system.get({})) {
      session.markConnected();
      fragment.ctx.cells.system.set(remoteSystem);
    }
  } catch {
    // Stream end / abort — session reconnect logic takes over.
  }
}

/** Mirror the agent's processes collection into the parent's cache. */
async function pumpProcessesCollection(
  client: AgentClient,
  processCache: Map<Pid, Process>,
  fragment: FragmentCtx,
): Promise<void> {
  try {
    for await (const keys of await client.surface.processes.keys({})) {
      await reconcileProcesses(client, keys, processCache, fragment);
    }
  } catch {
    /* stream end — session reconnect drives the next subscribe */
  }
}

/** Diff the agent's current key set against the parent's process
 *  cache, fetching new pids and removing departed ones. Per-pid value
 *  refresh isn't covered here (the parent only sees keys deltas);
 *  values flow through `system.get` poll cadence at 2s intervals
 *  alongside the system snapshot. For a richer per-pid stream, R-2
 *  would generate per-key channels through the framework. */
async function reconcileProcesses(
  client: AgentClient,
  keys: readonly Pid[],
  cache: Map<Pid, Process>,
  fragment: FragmentCtx,
): Promise<void> {
  const next = new Set(keys);
  // Remove departed — the framework's wrapped remove updates `cache`
  // for us (via the `remove` dep we provided to `implementSurface`)
  // and publishes through the keyed channels.
  for (const pid of cache.keys()) {
    if (!next.has(pid)) fragment.ctx.collections.processes.remove(pid);
  }
  // Fetch new
  for (const pid of next) {
    if (cache.has(pid)) continue;
    try {
      const stream = await client.surface.processes.get({ key: pid });
      // Take the first yield only — current value snapshot.
      const iter = stream[Symbol.asyncIterator]();
      const result = await iter.next();
      if (!result.done && result.value !== undefined) {
        // The wrapped upsert writes through to `cache` and publishes.
        fragment.ctx.collections.processes.upsert(pid, result.value);
      }
      // Eagerly close the iterator after the snapshot — value
      // refreshes ride the system poll cadence.
      await iter.return?.(undefined);
    } catch {
      /* pid vanished between keys yield and get — ignore */
    }
  }
}
