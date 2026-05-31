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

import {
  type CellStore,
  type Channel,
  implementSurface,
  inMemoryChannel,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import {
  type AgentClient,
  type HostSession,
  makeClientCursor,
  mirrorRemoteCollection,
} from "@kolu/surface-nix-host";
import { implement } from "@orpc/server";
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

type ProcessMonitorAgent = AgentClient<typeof surface.contract>;

export interface BuildRouterOptions {
  session: HostSession<typeof surface.contract>;
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
  // Start a background pump that pins the session, then loops over each
  // successive AgentClient the session produces — each time the agent
  // process is respawned (after a transport drop), the bridge fetches
  // the new client and restarts all pumps against it. The framework's
  // `ClientRetryPlugin` is NOT load-bearing here: stdio links don't
  // recover mid-stream (the underlying streams die with the process), so
  // the only reliable recovery is to re-issue the subscriptions on the
  // *new* client. The outer loop is what implements "reconnect → state
  // reconciles" (row 12 of the falsifiability checklist). This loop relies
  // on each pump *settling* when the link drops: a pump's RPC against a
  // dead `StdioRPCLink` rejects synchronously (the link fails fast once
  // its inbound stream ends — it does not hang), so `Promise.allSettled`
  // returns and the loop advances to the respawned client.
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

/** Pin the session, then loop: fetch the current AgentClient, run all
 *  three pumps against it concurrently, wait for them to end (which
 *  happens when the link errors — stdio process death), then wait for
 *  the session to provide a fresh client (post-reconnect) and repeat.
 *
 *  The reconnect-loop primitive itself (`makeClientCursor`) lives in
 *  `@kolu/surface-nix-host`; this function is the demo-specific
 *  composition (which pumps to run on each cycle). */
async function bridgeAgentToParent(
  session: HostSession<typeof surface.contract>,
  fragment: FragmentCtx,
  browserSnapshotBus: Channel<ProcessesSnapshotMsg>,
): Promise<void> {
  log("pinning HostSession (parent-lifetime ref)…");
  // Pin once. Swallow the initial promise — we'll fetch a fresh client
  // (possibly a re-spawned one) in the loop below regardless of whether
  // this first spawn succeeded.
  session.pin().catch(() => {
    /* logged via state cell; loop handles recovery */
  });

  // A cursor over the session's spawn lifecycle — `next()` blocks until a
  // genuinely new spawn appears. It owns the spawn-identity token internally,
  // so this loop can't re-introduce the busy-spin by mis-threading it (the
  // client proxy is thenable, so comparing *it* spins once the link fails
  // fast; the cursor compares the stable clientPromise for us).
  const cursor = makeClientCursor(session);
  while (!session.isDestroyed()) {
    let client: ProcessMonitorAgent;
    try {
      client = await cursor.next();
    } catch (err) {
      log(`bridge: waiting for next client failed: ${(err as Error).message}`);
      break;
    }
    log("agent client ready; starting pumps");
    await Promise.allSettled([
      pumpSystemCell(client, session, fragment),
      pumpProcessesSnapshot(client, fragment, browserSnapshotBus),
      pumpCpuCores(client, fragment),
    ]);
    log("bridge: pumps ended (link likely died) — awaiting next client");
  }
  log("bridge: session destroyed — exiting reconnect loop");
}

/** Mirror the agent's `cpuCores` collection — small-N showcase of
 *  `mirrorRemoteCollection`. */
function pumpCpuCores(
  client: ProcessMonitorAgent,
  fragment: FragmentCtx,
): Promise<void> {
  return mirrorRemoteCollection<CoreId, CpuCore>({
    label: "cpuCores",
    log,
    keys: client.surface.cpuCores.keys({}) as Promise<
      AsyncIterable<readonly CoreId[]>
    >,
    get: (key, signal) =>
      client.surface.cpuCores.get({ key }, { signal }) as Promise<
        AsyncIterable<CpuCore>
      >,
    onUpsert: (key, value) =>
      fragment.ctx.collections.cpuCores.upsert(key, value),
    onRemove: (key) => fragment.ctx.collections.cpuCores.remove(key),
  });
}

/** Mirror the agent's system cell into the parent's local cell. */
async function pumpSystemCell(
  client: ProcessMonitorAgent,
  session: HostSession<typeof surface.contract>,
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
  client: ProcessMonitorAgent,
  fragment: FragmentCtx,
  browserSnapshotBus: Channel<ProcessesSnapshotMsg>,
): Promise<void> {
  const seenPids = new Set<Pid>();
  let frames = 0;
  try {
    for await (const msg of await client.surface.processesSnapshot.get({})) {
      frames += 1;
      applySnapshotMessage(msg, seenPids, fragment, frames);
      // Independent activity: re-publish to browser subscribers via
      // the parent's local bus. Verbatim forward — no inspection of
      // frame contents here; the mirror logic above is the only
      // place that knows the discriminated-union shape.
      browserSnapshotBus.publish(msg);
    }
    log(`processes: snapshot stream closed (${frames} frames total)`);
  } catch (err) {
    log(`processes: snapshot stream error: ${(err as Error).message}`);
  }
}

/** Apply one `processesSnapshot` frame to the parent's local
 *  collection — full reset on `snapshot`, incremental delta on
 *  `delta`. Mutates `seenPids` so subsequent snapshots can drop
 *  PIDs that disappeared between yields. */
function applySnapshotMessage(
  msg: ProcessesSnapshotMsg,
  seenPids: Set<Pid>,
  fragment: FragmentCtx,
  frameNumber: number,
): void {
  if (msg.kind === "snapshot") {
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
      `processes: snapshot frame #${frameNumber} — ${msg.entries.length} PIDs (cold-start or reconnect)`,
    );
    return;
  }
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
      `processes: delta frame #${frameNumber} — upsert=${msg.upserts.length} remove=${msg.removes.length} total=${seenPids.size}`,
    );
  }
}
