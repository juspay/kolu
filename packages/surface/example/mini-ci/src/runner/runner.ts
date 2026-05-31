/**
 * mini-ci runner — owns the task DAG, each node's child process, and each
 * node's log buffer, and serves it all as a `@kolu/surface` over stdio.
 *
 * The shape mirrors what `kolu-server`'s in-process pty-host does for
 * `kolu-tui`: a long-lived process holding live state (there: PTYs; here:
 * pipeline nodes) that streams snapshot-then-delta to ephemeral clients.
 *
 *   - the `nodes` cell holds the whole pipeline state; every transition is
 *     one `ctx.cells.nodes.set(next)` (snapshot + delta in one call).
 *   - each node has a log buffer (the snapshot) and a per-node channel (the
 *     deltas); the `nodeLog` stream yields the buffer then forwards the
 *     channel.
 *   - `node.rerun` resets a node and its transitive dependents to pending
 *     and reschedules — the input mutation.
 *
 * `createRunner` returns the wrapped router plus `start`/`dispose`, so the
 * same engine is driven by `main.ts` over real stdio *and* by the unit test
 * over an in-process loopback pair — identical code, only the transport
 * differs.
 */

import { type ChildProcess, spawn } from "node:child_process";
import {
  type Channel,
  implementSurface,
  inMemoryChannel,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import { implement } from "@orpc/server";
import { type PipelineSpec, validatePipeline } from "../common/pipeline";
import {
  type NodeLogMessage,
  type NodeState,
  type NodeStatus,
  type PipelineState,
  surface,
} from "../common/surface";

export interface Runner {
  /** Top-level router, already wrapped via `implement(contract).router(...)`
   *  — ready to pass to `serveOverStdio({ router })`. */
  // biome-ignore lint/suspicious/noExplicitAny: implementSurface's Lazy<Router> spread isn't accepted by oRPC's Router<any, T> input type; the runtime shape is valid (the remote-process-monitor agent uses the same `as any`).
  router: any;
  /** Kick the scheduler — runs every task whose deps are already `ok`. */
  start(): void;
  /** Kill any running children and stop scheduling. */
  dispose(): void;
}

export function createRunner(rawSpec: PipelineSpec): Runner {
  const spec = validatePipeline(rawSpec);
  const order = spec.tasks.map((t) => t.id);

  const initialNodes: Record<string, NodeState> = {};
  for (const task of spec.tasks) {
    initialNodes[task.id] = {
      id: task.id,
      name: task.name ?? task.id,
      command: task.command,
      needs: task.needs,
      status: "pending",
      exitCode: null,
      startedAt: null,
      durationMs: null,
    };
  }

  const stateStore = inMemoryStore<PipelineState>({
    name: spec.name,
    order,
    nodes: initialNodes,
  });

  // Per-node log: a string buffer (the snapshot a late subscriber catches
  // up on) + a channel (the deltas a live subscriber follows). Lazily
  // created so publish-site and subscribe-site share one channel per id.
  const logBuffers = new Map<string, string>();
  const logBuses = new Map<string, Channel<NodeLogMessage>>();
  const logBusFor = (id: string): Channel<NodeLogMessage> => {
    let bus = logBuses.get(id);
    if (bus === undefined) {
      bus = inMemoryChannel<NodeLogMessage>();
      logBuses.set(id, bus);
    }
    return bus;
  };

  const fragment = implementSurface(surface, {
    channel: inMemoryChannelByName(),
    cells: {
      nodes: { store: stateStore },
    },
    streams: {
      nodeLog: {
        source: async function* ({ id }, signal) {
          yield {
            kind: "snapshot",
            text: logBuffers.get(id) ?? "",
          } satisfies NodeLogMessage;
          for await (const msg of logBusFor(id).subscribe(signal)) yield msg;
        },
      },
    },
    procedures: {
      node: {
        rerun: async ({ input }) => ({ ok: rerun(input.id) }),
      },
    },
  });

  const ctx = fragment.ctx;
  const children = new Map<string, ChildProcess>();
  let disposed = false;

  // ── state helpers (the `nodes` cell is the single source of truth) ──
  const getState = (): PipelineState => stateStore.get();
  const statusOf = (id: string): NodeStatus | undefined =>
    getState().nodes[id]?.status;
  const setNode = (id: string, patch: Partial<NodeState>): void => {
    const cur = getState();
    const prev = cur.nodes[id];
    if (prev === undefined) return;
    ctx.cells.nodes.set({
      ...cur,
      nodes: { ...cur.nodes, [id]: { ...prev, ...patch } },
    });
  };

  // ── log helpers ──
  const appendLog = (id: string, text: string): void => {
    logBuffers.set(id, (logBuffers.get(id) ?? "") + text);
    logBusFor(id).publish({ kind: "append", text });
  };
  const resetLog = (id: string): void => {
    logBuffers.set(id, "");
    logBusFor(id).publish({ kind: "snapshot", text: "" });
  };

  // ── scheduling ──
  const runnable = (node: NodeState): boolean =>
    node.status === "pending" &&
    node.needs.every((dep) => statusOf(dep) === "ok");
  const blocked = (node: NodeState): boolean =>
    node.status === "pending" &&
    node.needs.some((dep) => {
      const s = statusOf(dep);
      return s === "failed" || s === "skipped";
    });

  const tick = (): void => {
    if (disposed) return;
    // A pass may unblock later rows (a skip cascades), so loop until the
    // pass makes no further change.
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of order) {
        const node = getState().nodes[id];
        if (node === undefined || node.status !== "pending") continue;
        if (blocked(node)) {
          setNode(id, { status: "skipped" });
          changed = true;
        } else if (runnable(node) && !children.has(id)) {
          spawnNode(node);
          changed = true;
        }
      }
    }
  };

  const spawnNode = (node: NodeState): void => {
    const startedAt = Date.now();
    setNode(node.id, { status: "running", startedAt });
    const child = spawn(node.command, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.set(node.id, child);
    child.stdout?.setEncoding("utf-8");
    child.stderr?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => appendLog(node.id, chunk));
    child.stderr?.on("data", (chunk: string) => appendLog(node.id, chunk));
    const finish = (status: NodeStatus, exitCode: number | null): void => {
      // Ignore exits from a child that's been superseded by a rerun or a
      // dispose (we delete it from `children` before killing it, so a stale
      // SIGTERM exit can't clobber the fresh `pending`/`running` state).
      if (children.get(node.id) !== child) return;
      children.delete(node.id);
      setNode(node.id, {
        status,
        exitCode,
        durationMs: Date.now() - startedAt,
      });
      tick();
    };
    child.on("error", (err) => {
      appendLog(node.id, `\n[mini-ci] spawn failed: ${err.message}\n`);
      finish("failed", null);
    });
    child.on("exit", (code) => finish(code === 0 ? "ok" : "failed", code));
  };

  // ── rerun: reset target + transitive dependents, then reschedule ──
  const rerun = (id: string): boolean => {
    if (disposed || getState().nodes[id] === undefined) return false;
    const toReset = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const candidate of order) {
        if (toReset.has(candidate)) continue;
        const needs = getState().nodes[candidate]?.needs ?? [];
        if (needs.some((dep) => toReset.has(dep))) {
          toReset.add(candidate);
          grew = true;
        }
      }
    }
    for (const rid of toReset) {
      const child = children.get(rid);
      if (child !== undefined) {
        children.delete(rid);
        child.kill("SIGTERM");
      }
      resetLog(rid);
      setNode(rid, {
        status: "pending",
        exitCode: null,
        startedAt: null,
        durationMs: null,
      });
    }
    tick();
    return true;
  };

  const router = implement(surface.contract).router({ ...fragment.router });

  return {
    router,
    start: () => tick(),
    dispose: () => {
      disposed = true;
      for (const child of children.values()) child.kill("SIGKILL");
      children.clear();
    },
  };
}
