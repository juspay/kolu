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
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import {
  type ConnectionInfo,
  type CoreId,
  type CpuCore,
  DEFAULT_CONNECTION,
  DEFAULT_SYSTEM,
  type Pid,
  type Process,
  type ProcessesSnapshotMsg,
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
  const coreCache = new Map<CoreId, CpuCore>();
  // Local snapshot bus — every msg the parent receives from the
  // agent's snapshot stream is also re-published here so the parent's
  // own `processesSnapshot` source (consumed by the browser) can
  // forward the same data without re-subscribing to the agent.
  const browserSnapshotBus: Channel<ProcessesSnapshotMsg> =
    inMemoryChannel<ProcessesSnapshotMsg>();

  const fragment = implementSurface(surface, {
    // Name-keyed in-memory channel factory — publish/subscribe sites
    // land on the same `Channel<T>` instance per name.
    channel: inMemoryChannelByName(),
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
      cpuCores: {
        readAll: () => coreCache,
        upsert: (key, value) => {
          coreCache.set(key, value);
        },
        remove: (key) => {
          coreCache.delete(key);
        },
      },
    },
    streams: {
      // Browser-facing snapshot stream — yields the parent's current
      // process cache on subscribe (synchronous snapshot from local
      // state, no agent round-trip needed) then forwards every delta
      // / snapshot the agent publishes via the parent's local bus.
      processesSnapshot: {
        source: async function* (_input, signal) {
          yield {
            kind: "snapshot",
            entries: [...processCache.entries()],
          } satisfies ProcessesSnapshotMsg;
          for await (const msg of browserSnapshotBus.subscribe(signal)) {
            yield msg;
          }
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
  void bridgeAgentToParent(session, fragment, browserSnapshotBus);

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

/** The subset of `implementSurface(...).ctx` the bridge pumps actually
 *  call. Keep this in sync with the surface's cells/collections —
 *  every cell/collection actually written from a pump must appear
 *  here, otherwise the pumps compile against a narrower-than-real
 *  type and a typo / missing-write goes undetected. */
type FragmentCtx = {
  ctx: {
    cells: {
      system: { set: (v: SystemInfo) => void };
      connection: { set: (v: ConnectionInfo) => void };
    };
    collections: {
      processes: {
        upsert: (k: Pid, v: Process) => void;
        remove: (k: Pid) => void;
      };
      cpuCores: {
        upsert: (k: CoreId, v: CpuCore) => void;
        remove: (k: CoreId) => void;
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
  browserSnapshotBus: Channel<ProcessesSnapshotMsg>,
): Promise<void> {
  log("pinning HostSession (parent-lifetime ref)…");
  let client: AgentClient;
  try {
    client = await session.pin();
  } catch (err) {
    log(
      `pin failed: ${(err as Error).message} — session reconnect drives next attempt`,
    );
    return;
  }
  log("agent client ready; starting pumps");
  // Don't release on background termination — the session is the
  // long-lived parent-side singleton and we want it kept warm.
  void pumpSystemCell(client, session, fragment);
  void pumpProcessesSnapshot(client, fragment, browserSnapshotBus);
  void pumpCpuCores(client, fragment);
}

/** Mirror the agent's `cpuCores` collection via the framework's
 *  per-key Collection<K,T> model — the SMALL-N use case the primitive
 *  is designed for. ~4-32 cores → ~4-32 per-key subscribes; trivial
 *  to fan out. Contrast with `processes` (600+), which over-stresses
 *  the per-key model and gets the bulk `processesSnapshot` stream
 *  treatment instead. */
async function pumpCpuCores(
  client: AgentClient,
  fragment: FragmentCtx,
): Promise<void> {
  const open = new Map<CoreId, AbortController>();
  try {
    for await (const keys of await client.surface.cpuCores.keys({})) {
      const next = new Set(keys);
      for (const core of next) {
        if (open.has(core)) continue;
        const ctl = new AbortController();
        open.set(core, ctl);
        void (async () => {
          try {
            const stream = await client.surface.cpuCores.get(
              { key: core },
              { signal: ctl.signal },
            );
            for await (const value of stream) {
              if (ctl.signal.aborted) break;
              fragment.ctx.collections.cpuCores.upsert(core, value);
            }
          } catch {
            /* aborted / core vanished — orchestrator cleans up */
          }
        })();
      }
      for (const [core, ctl] of [...open]) {
        if (next.has(core)) continue;
        ctl.abort();
        open.delete(core);
        fragment.ctx.collections.cpuCores.remove(core);
      }
    }
    log("cpuCores: keys stream closed");
  } catch (err) {
    log(`cpuCores: keys stream error: ${(err as Error).message}`);
  } finally {
    for (const ctl of open.values()) ctl.abort();
  }
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

/** Mirror the agent's processes via the BULK `processesSnapshot`
 *  stream — ONE long-lived stream, regardless of process count. Each
 *  yield is either a full keyed-snapshot (first frame on subscribe,
 *  or on every reconnect via `ClientRetryPlugin`) or a per-tick delta.
 *  Both shapes apply to the parent's local collection in a single
 *  batch.
 *
 *  This replaces the older "keys-stream + N per-key subscribes"
 *  bridge — fine over local stdio but a noticeable drip over a
 *  high-latency `ssh` link (600 PIDs × ~10ms RTT ≈ 6 seconds of
 *  one-row-at-a-time fill). With the bulk stream, cold-start is O(1)
 *  RPCs regardless of process count. */
async function pumpProcessesSnapshot(
  client: AgentClient,
  fragment: FragmentCtx,
  browserSnapshotBus: Channel<ProcessesSnapshotMsg>,
): Promise<void> {
  const seenPids = new Set<Pid>();
  let frames = 0;
  try {
    for await (const msg of await client.surface.processesSnapshot.get({})) {
      frames += 1;
      if (msg.kind === "snapshot") {
        // Full reset — drop any PIDs we'd seen previously that aren't
        // in the new snapshot, then upsert everything in the snapshot.
        const next = new Set(msg.entries.map(([pid]) => pid));
        for (const pid of [...seenPids]) {
          if (!next.has(pid)) {
            fragment.ctx.collections.processes.remove(pid);
            seenPids.delete(pid);
          }
        }
        for (const [pid, value] of msg.entries) {
          fragment.ctx.collections.processes.upsert(pid, value);
          seenPids.add(pid);
        }
        log(
          `processes: snapshot frame #${frames} — ${msg.entries.length} PIDs (cold-start or reconnect)`,
        );
      } else {
        for (const [pid, value] of msg.upserts) {
          fragment.ctx.collections.processes.upsert(pid, value);
          seenPids.add(pid);
        }
        for (const pid of msg.removes) {
          fragment.ctx.collections.processes.remove(pid);
          seenPids.delete(pid);
        }
        if (msg.upserts.length > 0 || msg.removes.length > 0) {
          log(
            `processes: delta frame #${frames} — upsert=${msg.upserts.length} remove=${msg.removes.length} total=${seenPids.size}`,
          );
        }
      }
      // Re-publish to browser subscribers. The parent's own
      // `processesSnapshot.source` consumes this bus.
      browserSnapshotBus.publish(msg);
    }
    log(`processes: snapshot stream closed (${frames} frames total)`);
  } catch (err) {
    log(`processes: snapshot stream error: ${(err as Error).message}`);
  }
}
