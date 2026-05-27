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
  implementSurface,
  inMemoryPublisher,
  inMemoryStore,
  publisherChannel,
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

  // `inMemoryPublisher` dedupes channels by name so the framework's
  // publish-site and subscribe-site land on the same `Channel<T>`.
  const publisher = inMemoryPublisher();
  const fragment = implementSurface(surface, {
    channel: <T>(name: string) => publisherChannel<T>(publisher, name),
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
  void bridgeAgentToParent(session, fragment);

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

/** Demo-side logging — every interesting bridge event goes to stderr
 *  so `just dev` / `nix run` users see the full data flow. */
function log(line: string): void {
  process.stderr.write(`[bridge] ${line}\n`);
}

/** Acquire the agent client and pump remote system+processes deltas into
 *  the parent's local fragment ctx. Each stream loop runs fire-and-forget;
 *  errors at stream end (transport blip, abort) are expected end-of-life
 *  noise — the session's reconnect loop drives the next subscribe. */
async function bridgeAgentToParent(
  session: HostSession,
  fragment: FragmentCtx,
): Promise<void> {
  log("acquiring HostSession…");
  let client: AgentClient;
  try {
    client = await session.acquire();
  } catch (err) {
    log(
      `acquire failed: ${(err as Error).message} — session reconnect drives next attempt`,
    );
    return;
  }
  log("agent client ready; starting pumps");
  // Don't release on background termination — the session is the
  // long-lived parent-side singleton and we want it kept warm.
  void pumpSystemCell(client, session, fragment);
  void pumpProcessesCollection(client, fragment);
}

/** Mirror the agent's system cell into the parent's local cell. */
async function pumpSystemCell(
  client: AgentClient,
  session: HostSession,
  fragment: FragmentCtx,
): Promise<void> {
  let n = 0;
  try {
    for await (const remoteSystem of await client.surface.system.get({})) {
      n += 1;
      if (n === 1) log("system: first snapshot → marking connected");
      session.markConnected();
      fragment.ctx.cells.system.set(remoteSystem);
    }
    log(`system: stream closed cleanly after ${n} yields`);
  } catch (err) {
    log(`system: stream error after ${n} yields: ${(err as Error).message}`);
  }
}

/** Mirror the agent's processes collection into the parent's cache by
 *  keeping ONE long-lived per-key stream open per PID. Each per-key
 *  stream yields the initial value (snapshot) then every subsequent
 *  upsert (delta) — `pumpProcessValue` forwards each yield to the
 *  parent's collection ctx. New PIDs spawn streams in parallel as the
 *  agent's `keys` stream notifies us; departed PIDs abort their stream
 *  and `remove()` from the parent's collection. */
async function pumpProcessesCollection(
  client: AgentClient,
  fragment: FragmentCtx,
): Promise<void> {
  const open = new Map<Pid, AbortController>();
  let keysYields = 0;
  try {
    for await (const keys of await client.surface.processes.keys({})) {
      keysYields += 1;
      const next = new Set(keys);
      let opened = 0;
      let removed = 0;
      // Open per-key streams for new PIDs — fire-and-forget; the loop
      // runs in parallel so cold-start fills as fast as the link can
      // carry the subscribes.
      for (const pid of next) {
        if (open.has(pid)) continue;
        const ctl = new AbortController();
        open.set(pid, ctl);
        opened += 1;
        void pumpProcessValue(client, pid, fragment, ctl.signal);
      }
      // Close streams for departed PIDs and drop them from the parent's
      // collection. (The wrapped remove publishes the absence through
      // the framework's keyed channels — browser sees the deletion.)
      for (const [pid, ctl] of [...open]) {
        if (next.has(pid)) continue;
        ctl.abort();
        open.delete(pid);
        fragment.ctx.collections.processes.remove(pid);
        removed += 1;
      }
      // Only log when the key set actually moves — the framework
      // re-emits the same key array on every value-only delta.
      if (opened > 0 || removed > 0) {
        log(
          `processes: keys-yield #${keysYields} — opened=${opened} closed=${removed} total=${open.size}`,
        );
      }
    }
    log(`processes: keys stream closed (${keysYields} yields total)`);
  } catch (err) {
    log(`processes: keys stream error: ${(err as Error).message}`);
  } finally {
    // Abort every still-open per-key stream so the agent can release
    // its subscriber slots cleanly.
    for (const ctl of open.values()) ctl.abort();
  }
}

/** Long-lived per-PID stream: first yield = snapshot, subsequent yields
 *  = deltas from the agent's poll loop. Aborts cleanly on signal (PID
 *  departure) or stream error (transport blip / `processes.get` says
 *  "key not found" because the PID vanished between `keys` and `get`). */
async function pumpProcessValue(
  client: AgentClient,
  pid: Pid,
  fragment: FragmentCtx,
  signal: AbortSignal,
): Promise<void> {
  try {
    const stream = await client.surface.processes.get({ key: pid }, { signal });
    for await (const value of stream) {
      if (signal.aborted) break;
      fragment.ctx.collections.processes.upsert(pid, value);
    }
  } catch {
    // PID vanished / aborted — the orchestrator handles cleanup.
  }
}
