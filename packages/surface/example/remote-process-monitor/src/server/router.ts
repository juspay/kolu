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
  // Start a background pump that pins the session, then loops over each
  // successive AgentClient the session produces — each time the agent
  // process is respawned (after a transport drop), the bridge fetches
  // the new client and restarts all pumps against it. The framework's
  // `ClientRetryPlugin` is NOT load-bearing here: stdio links don't
  // recover mid-stream (the underlying streams die with the process), so
  // the only reliable recovery is to re-issue the subscriptions on the
  // *new* client. The outer loop is what implements "reconnect → state
  // reconciles" (row 12 of the falsifiability checklist).
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
 *  Why a loop, not just `ClientRetryPlugin`: the retry plugin re-issues
 *  RPCs on the same `RPCLink`, which is bound to one pair of stdio
 *  streams. When the agent process exits, those streams are dead — no
 *  amount of re-issuing recovers them. Recovery requires a *new* client
 *  bound to a *new* spawn's streams, which is exactly what the session's
 *  `scheduleReconnect` produces. The bridge has to walk that succession. */
async function bridgeAgentToParent(
  session: HostSession,
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

  let lastClient: AgentClient | null = null;
  while (!session.isDestroyed()) {
    let client: AgentClient;
    try {
      client = await waitForNextClient(session, lastClient);
    } catch (err) {
      log(`bridge: waiting for next client failed: ${(err as Error).message}`);
      break;
    }
    lastClient = client;
    log("agent client ready; starting pumps");
    // Race all three pumps; when any settles (typically because the
    // stdio link died), let the other two finish too. `allSettled`
    // would also work but `race` lets us tear out faster — the dead
    // link will surface in the others on their next await anyway.
    await Promise.allSettled([
      pumpSystemCell(client, session, fragment),
      pumpProcessesSnapshot(client, fragment, browserSnapshotBus),
      pumpCpuCores(client, fragment),
    ]);
    log("bridge: pumps ended (link likely died) — awaiting next client");
  }
  log("bridge: session destroyed — exiting reconnect loop");
}

/** Block until the session exposes a NEW `clientPromise` instance
 *  (i.e. one whose identity differs from the previous iteration's
 *  client). Resolves with the awaited client. Throws if the session is
 *  destroyed before a fresh client appears.
 *
 *  Identity-comparison is the trick that avoids spinning: when pumps
 *  end because the link errored, the child's `exit` handler clears
 *  `clientPromise` to null and `scheduleReconnect` later sets it to a
 *  new promise. Until that new promise exists, `currentClient()`
 *  returns either null or the same dead-handle the pumps just
 *  abandoned — we wait through both. */
function waitForNextClient(
  session: HostSession,
  previous: AgentClient | null,
): Promise<AgentClient> {
  return new Promise((resolve, reject) => {
    const tryResolve = async (): Promise<boolean> => {
      if (session.isDestroyed()) {
        reject(new Error("session destroyed"));
        return true;
      }
      const cp = session.currentClient();
      if (cp === null) return false;
      try {
        const c = await cp;
        if (c !== previous) {
          resolve(c);
          return true;
        }
      } catch {
        // Spawn rejected — stay in the loop; the next state change
        // (scheduleReconnect's timer firing) will surface a fresh
        // clientPromise.
      }
      return false;
    };
    void tryResolve().then((done) => {
      if (done) return;
      const unsub = session.onState(() => {
        void tryResolve().then((doneNow) => {
          if (doneNow) unsub();
        });
      });
    });
  });
}

/** Generic mirror: subscribe to the agent's `Collection<K,V>` (via
 *  its framework-derived `keys` + `get(key)` streams) and pump every
 *  observed value into the parent's local collection in real time.
 *
 *  The per-key model is the right fit when N is small (4-32 keys) —
 *  R-2's `RemoteTerminalBackend` will use this exact shape for its
 *  `terminalMetadata` collection. Extracted ahead of R-2 so the
 *  per-key bridge isn't copy-pasted with subtle finally-block
 *  differences later.
 *
 *  Each per-key stream stays open for the key's lifetime so deltas
 *  flow without re-subscribing. Departed keys see their stream
 *  aborted and the entry removed from the parent's collection. */
async function mirrorRemoteCollection<K, V>(opts: {
  label: string;
  /** Eager-or-lazy: a Promise of the keys stream (matches the shape
   *  the framework's typed client returns for `<coll>.keys(...)`). */
  keys: Promise<AsyncIterable<readonly K[]>>;
  get: (key: K, signal: AbortSignal) => Promise<AsyncIterable<V>>;
  onUpsert: (key: K, value: V) => void;
  onRemove: (key: K) => void;
}): Promise<void> {
  const open = new Map<K, AbortController>();
  try {
    for await (const keys of await opts.keys) {
      const next = new Set(keys);
      for (const key of next) {
        if (open.has(key)) continue;
        const ctl = new AbortController();
        open.set(key, ctl);
        void (async () => {
          try {
            const stream = await opts.get(key, ctl.signal);
            for await (const value of stream) {
              if (ctl.signal.aborted) break;
              opts.onUpsert(key, value);
            }
          } catch (err) {
            // AbortError is expected (key departed — orchestrator removes
            // it below). Any other error means the per-key stream died
            // unexpectedly; log so it's visible without crashing the pump.
            if ((err as Error).name !== "AbortError") {
              log(
                `${opts.label}: per-key stream error for ${String(key)}: ${(err as Error).message}`,
              );
            }
          }
        })();
      }
      for (const [key, ctl] of [...open]) {
        if (next.has(key)) continue;
        ctl.abort();
        open.delete(key);
        opts.onRemove(key);
      }
    }
    log(`${opts.label}: keys stream closed`);
  } catch (err) {
    log(`${opts.label}: keys stream error: ${(err as Error).message}`);
  } finally {
    for (const ctl of open.values()) ctl.abort();
  }
}

/** Mirror the agent's `cpuCores` collection — small-N showcase of
 *  `mirrorRemoteCollection`. */
function pumpCpuCores(
  client: AgentClient,
  fragment: FragmentCtx,
): Promise<void> {
  return mirrorRemoteCollection<CoreId, CpuCore>({
    label: "cpuCores",
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
