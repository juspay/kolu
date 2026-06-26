/**
 * Parent-side router — bridges browser ↔ remote agent.
 *
 * The agent serves the connection-free base `surface`. The parent re-serves the
 * MIRRORED surface — `monitorSurface = mirroredSurface(surface)`, i.e. the base
 * plus the get-only `connection` cell — and the browser subscribes to THAT. The
 * parent doesn't re-define a different base; it implements the base primitives
 * locally by *forwarding* every read to the remote stdio client, and owns the
 * extra `connection` cell itself. On a fresh subscriber, the parent:
 *
 *   1. Synchronously yields the seeded, gate-closed `connection` cell — link
 *      health (state = "copying" / "connecting" / etc.) lives in its OWN cell,
 *      not folded into the `system` snapshot.
 *   2. Once the agent's link is up, mirrors the agent's `system` and
 *      `processes` updates into the parent's local store/collection, and the
 *      session pump writes link health into the `connection` cell.
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
import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import {
  type AgentClient,
  type HostSession,
  makeClientCursor,
  pipeSessionStateToCell,
  seedConnectionCell,
} from "@kolu/surface-nix-host";
import { implement } from "@orpc/server";
import {
  type CoreId,
  type CpuCore,
  DEFAULT_SYSTEM,
  monitorSurface,
  type Pid,
  type Process,
  type ProcessesSnapshotMsg,
  surface,
  type SystemInfo,
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
  // The seeded, gate-closed connection cell — the shared `seedConnectionCell()`,
  // not a hand-rolled store. Written below by `pipeSessionStateToCell` off the
  // session's `onState`, exactly as pulam-web's re-serve does.
  const connection = seedConnectionCell();
  const processCache = new Map<Pid, Process>();
  const coreCache = new Map<CoreId, CpuCore>();
  // Local snapshot bus — every msg the parent receives from the
  // agent's snapshot stream is also re-published here so the parent's
  // own `processesSnapshot` source (consumed by the browser) can
  // forward the same data without re-subscribing to the agent.
  const browserSnapshotBus: Channel<ProcessesSnapshotMsg> =
    inMemoryChannel<ProcessesSnapshotMsg>();

  // Implements the MIRRORED surface (base + the get-only `connection` cell). The
  // base primitives are forwarded/folded from the agent; `connection` is the
  // seeded local store the session pump writes — the agent's surface stays
  // connection-free.
  const fragment = implementSurface(monitorSurface, {
    // Name-keyed in-memory channel factory — publish/subscribe sites
    // land on the same `Channel<T>` instance per name.
    channel: inMemoryChannelByName(),
    cells: {
      system: { store: systemStore },
      connection,
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
      // `kill` forwards browser → agent. R7 made `mirrorRemoteSurface` a *total*
      // dual, so the bridge's `mirrorRemoteSurface(...)` below now also returns a
      // `procedures.process.kill` forwarder — but those stubs are bound to ONE
      // spawn's client, and `stdio` links don't recover mid-stream (the bridge
      // re-mirrors per respawn). A kill can be invoked any time, including across a
      // respawn, so it forwards through `session.acquire()` (always the *current*
      // live client) rather than a per-spawn mirror stub. R8's long-lived
      // `HostSession` client is durable across reconnects, so it can hand its
      // forwarders straight off the mirror.
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
  // The shared `pipeSessionStateToCell` (projects every `onState` frame onto the
  // cell), not a hand-rolled `onState` → `{ state }` mapping — so the full
  // `ConnectionInfo` (lastError / failureCause / progress) reaches the browser,
  // single-sourced with pulam-web. This is the MANUAL form of the production
  // wiring: a re-serve that drives the parent surface via `pumpRemoteSurface`
  // passes `connection: { set }` and the pump calls this for you (the default-on
  // path pulam-web uses). This example runs its own `bridgeAgentToParent` pump,
  // so it wires the same mapping by hand here.
  pipeSessionStateToCell(session, (info) =>
    fragment.ctx.cells.connection.set(info),
  );

  // ── Bridge remote agent surface → parent's local surface ──────────
  // Start a background pump that pins the session, then loops over each
  // successive AgentClient the session produces — each time the agent
  // process is respawned (after a transport drop), the bridge fetches
  // the new client and re-issues ONE `mirrorRemoteSurface` against it. The
  // framework's `ClientRetryPlugin` is NOT load-bearing here: stdio links
  // don't recover mid-stream (the underlying streams die with the
  // process), so the only reliable recovery is to re-mirror on the *new*
  // client. The outer loop is what implements "reconnect → state
  // reconciles" (row 12 of the falsifiability checklist). It relies on the
  // mirror *settling* when the link drops: each subscription's RPC against
  // a dead `StdioRPCLink` rejects once its inbound stream ends (the link
  // fails fast — it does not hang), so `mirrorRemoteSurface` resolves and
  // the loop advances to the respawned client.
  void bridgeAgentToParent(session, fragment, browserSnapshotBus);

  // `implementSurface` returns a router *fragment* — `{ surface: ... }`
  // wrapping the per-key namespaces. Passing it directly to RPCHandler
  // produces a `surface/surface/...` double-prefix in the matcher tree
  // (no procedure matches what the client sends). Wrap once via
  // `implement(contract).router({...fragment})` to flatten the prefix
  // — this is the same pattern Kolu's own server uses when spreading
  // the surface fragment alongside raw oRPC procedures.
  const router = implement(monitorSurface.contract).router({
    ...fragment.router,
  });
  return { router, session };
}

/** The `{ ctx }` the bridge pumps mutate — derived from the framework's own
 *  `implementSurface` return so it can't drift from the surface's
 *  cells/collections. A typo or missing-write in a pump now fails to compile
 *  against the real `ctx` (the whole point), with no hand-maintained shadow to
 *  keep in sync. */
type FragmentCtx = Pick<
  ReturnType<typeof implementSurface<typeof surface.spec>>,
  "ctx"
>;

/** Demo-side logging — every interesting bridge event goes to stderr
 *  so `just dev` / `nix run` users see the full data flow. */
function log(line: string): void {
  process.stderr.write(`[bridge] ${line}\n`);
}

/** Pin the session, then loop: fetch the current AgentClient, mirror the WHOLE
 *  agent surface into the parent with one `mirrorRemoteSurface` call, wait for it
 *  to settle (which happens when the link errors — stdio process death), then
 *  wait for the session to provide a fresh client (post-reconnect) and repeat.
 *
 *  This is the headline of the surface-mirror graduation: the three hand-rolled
 *  pumps (system cell, cpuCores collection, processesSnapshot stream) collapse
 *  into one declarative sink — the consume-side dual of the `implementSurface`
 *  call that built the parent's own surface above. The reconnect-loop primitive
 *  (`makeClientCursor`) and the per-client re-mirror stay the demo's job, because
 *  stdio links don't recover mid-stream. */
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
    log("agent client ready; starting mirror");
    // Per-client mirror state — a fresh snapshot leads each (re)connect, so the
    // seen-PID set and frame counter reset with the client.
    const seenPids = new Set<Pid>();
    let frames = 0;
    let firstSystemFrame = true;
    await mirrorRemoteSurface(surface, client, {
      cells: {
        // The agent's `system` cell → the parent's. First frame = first data,
        // so flip the session to connected (idempotent thereafter).
        system: (remoteSystem) => {
          if (firstSystemFrame) {
            firstSystemFrame = false;
            log("system: first snapshot → marking connected");
            session.markConnected();
          }
          fragment.ctx.cells.system.set(remoteSystem);
        },
      },
      collections: {
        // Small-N per-key collection — the path the private `mirrorCollection`
        // engine drives (keys stream + per-key value streams).
        cpuCores: {
          upsert: (key, value) =>
            fragment.ctx.collections.cpuCores.upsert(key, value),
          remove: (key) => fragment.ctx.collections.cpuCores.remove(key),
        },
      },
      streams: {
        // Bulk discriminated-union stream — one long-lived stream regardless of
        // process count. Each frame is a full keyed-snapshot (first, or on
        // reconnect) or a per-tick delta; `applySnapshotMessage` applies both,
        // and the parent re-publishes the frame verbatim to its browser bus.
        processesSnapshot: {
          input: {},
          onFrame: (msg) => {
            frames += 1;
            applySnapshotMessage(msg, seenPids, fragment, frames);
            browserSnapshotBus.publish(msg);
          },
        },
      },
    }).done;
    log("bridge: mirror ended (link likely died) — awaiting next client");
  }
  log("bridge: session destroyed — exiting reconnect loop");
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
