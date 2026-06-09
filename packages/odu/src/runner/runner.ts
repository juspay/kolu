/**
 * The odu lane runner — owns one platform's slice of the pipeline: the task
 * DAG, each node's child process, and each node's log tail, served as a
 * `@kolu/surface` over stdio. Grown from the mini-ci example runner (which
 * stays untouched as the reference substrate); the deltas that make it CI:
 *
 *   - **Spawns idle.** HostSession's argv is fixed (`odu-runner --stdio`), so
 *     per-run config arrives over the surface: `run.configure` validates,
 *     seeds the DAG, acks immediately, and reports workspace prep through the
 *     synthetic `_ci-setup` node (never a multi-minute blocking RPC).
 *   - **`_ci-setup` is a builtin node** every recipe depends on — the skip
 *     cascade, log stream, and dashboard rows treat setup like any node,
 *     mirroring justci's `_ci-setup@<platform>` bookkeeping context.
 *   - **Process-group kills.** A recipe node is `just --no-deps <namepath>`
 *     wrapping `nix develop -c …` wrapping the real work; killing only the
 *     direct child would orphan grandchildren that keep writing into the
 *     workspace. Nodes spawn `detached` and die as a group.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  type Channel,
  implementSurface,
  inMemoryChannel,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import { implement } from "@orpc/server";
import { validatePipeline } from "../common/spec";
import {
  clampLog,
  type ConfigureInput,
  type ConfigureOutput,
  EMPTY_STATE,
  laneSurface,
  type NodeLogMessage,
  type NodeState,
  type NodeStatus,
  type PipelineState,
} from "../common/surface";
import { prepareWorkspace } from "./workspace";

export const SETUP_NODE_ID = "_ci-setup";

export interface LaneRunner {
  /** Top-level router, already wrapped via `implement(contract).router(...)`
   *  — ready for `serveOverStdio({ router })`. */
  // biome-ignore lint/suspicious/noExplicitAny: implementSurface's Lazy<Router> spread isn't accepted by oRPC's Router<any, T> input type; the runtime shape is valid (same as the mini-ci example runner).
  router: any;
  /** Kill running process groups and stop scheduling; cleans up this run's
   *  worktree when the pipeline settled green. */
  dispose(): void;
}

export function createLaneRunner(): LaneRunner {
  const stateStore = inMemoryStore<PipelineState>(EMPTY_STATE);

  interface NodeLog {
    buffer: string;
    bus: Channel<NodeLogMessage>;
  }
  const logs = new Map<string, NodeLog>();
  const logFor = (id: string): NodeLog => {
    let log = logs.get(id);
    if (log === undefined) {
      log = { buffer: "", bus: inMemoryChannel<NodeLogMessage>() };
      logs.set(id, log);
    }
    return log;
  };

  const fragment = implementSurface(laneSurface, {
    channel: inMemoryChannelByName(),
    cells: {
      nodes: { store: stateStore },
    },
    streams: {
      nodeLog: {
        source: async function* ({ id }, signal) {
          const log = logFor(id);
          yield { kind: "snapshot", text: log.buffer } satisfies NodeLogMessage;
          for await (const msg of log.bus.subscribe(signal)) yield msg;
        },
      },
    },
    procedures: {
      node: {
        rerun: async ({ input }) => ({ ok: rerun(input.id) }),
      },
      run: {
        configure: async ({ input }) => configure(input),
      },
    },
  });

  const ctx = fragment.ctx;
  const children = new Map<string, ChildProcess>();
  /** Monotonic token per builtin-setup invocation — the async prep analogue
   *  of the child-identity guard on process nodes. */
  let setupGeneration = 0;
  let disposed = false;
  let config: ConfigureInput | undefined;
  let workspace: string | undefined;
  let cleanupWorkspace: (() => void) | undefined;

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

  const appendLog = (id: string, text: string): void => {
    const log = logFor(id);
    log.buffer = clampLog(log.buffer + text);
    log.bus.publish({ kind: "append", text });
  };
  const resetLog = (id: string): void => {
    const log = logFor(id);
    log.buffer = "";
    log.bus.publish({ kind: "snapshot", text: "" });
  };

  // ── configure: seed the DAG, ack, let the scheduler take it ──
  const configure = (input: ConfigureInput): ConfigureOutput => {
    if (disposed) return { ok: false, error: "runner is disposed" };
    if (config !== undefined) {
      return {
        ok: false,
        error: "runner is already configured (one run per lane process)",
      };
    }
    if (
      input.workspace === null &&
      (input.origin === null || input.sha === null)
    ) {
      return {
        ok: false,
        error: "configure needs either workspace or origin+sha",
      };
    }
    try {
      validatePipeline({ name: input.name, tasks: input.tasks });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    config = input;
    const nodes: Record<string, NodeState> = {
      [SETUP_NODE_ID]: {
        id: SETUP_NODE_ID,
        name: SETUP_NODE_ID,
        command:
          input.workspace !== null
            ? `(workspace: ${input.workspace})`
            : `(fetch ${input.origin} @ ${input.sha?.slice(0, 7)})`,
        needs: [],
        status: "pending",
        exitCode: null,
        startedAt: null,
        durationMs: null,
      },
    };
    for (const task of input.tasks) {
      nodes[task.id] = {
        id: task.id,
        name: task.name ?? task.id,
        command: task.command,
        needs: [...task.needs, SETUP_NODE_ID],
        status: "pending",
        exitCode: null,
        startedAt: null,
        durationMs: null,
      };
    }
    ctx.cells.nodes.set({
      name: input.name,
      order: [SETUP_NODE_ID, ...input.tasks.map((t) => t.id)],
      nodes,
    });
    tick();
    return { ok: true, error: null };
  };

  // ── scheduling (mini-ci semantics: fixed-point pass, skip cascade) ──
  const runnable = (node: NodeState): boolean =>
    node.status === "pending" &&
    node.needs.every((dep) => statusOf(dep) === "ok");
  const blocked = (node: NodeState): boolean =>
    node.status === "pending" &&
    node.needs.some((dep) => {
      const s = statusOf(dep);
      return s === "failed" || s === "skipped" || s === "errored";
    });

  const tick = (): void => {
    if (disposed) return;
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of getState().order) {
        const node = getState().nodes[id];
        if (node === undefined || node.status !== "pending") continue;
        if (blocked(node)) {
          setNode(id, { status: "skipped" });
          changed = true;
        } else if (runnable(node) && !children.has(id)) {
          if (id === SETUP_NODE_ID) runSetup();
          else spawnNode(node);
          changed = true;
        }
      }
    }
  };

  // ── the builtin setup node: workspace prep as a node, not an RPC ──
  const runSetup = (): void => {
    const cfg = config;
    if (cfg === undefined) return;
    const generation = ++setupGeneration;
    const startedAt = Date.now();
    setNode(SETUP_NODE_ID, { status: "running", startedAt });
    const live = (): boolean => !disposed && generation === setupGeneration;
    const finish = (ok: boolean): void => {
      if (!live()) return;
      setNode(SETUP_NODE_ID, {
        status: ok ? "ok" : "failed",
        exitCode: ok ? 0 : 1,
        durationMs: Date.now() - startedAt,
      });
      tick();
    };

    if (cfg.workspace !== null) {
      const exists = existsSync(cfg.workspace);
      appendLog(
        SETUP_NODE_ID,
        exists
          ? `[odu] using provided workspace ${cfg.workspace}\n`
          : `[odu] provided workspace ${cfg.workspace} does not exist\n`,
      );
      if (exists) workspace = cfg.workspace;
      finish(exists);
      return;
    }

    void prepareWorkspace(
      // configure() validated origin+sha when workspace is null
      { origin: cfg.origin as string, sha: cfg.sha as string },
      (line) => {
        if (live()) appendLog(SETUP_NODE_ID, `${line}\n`);
      },
    ).then((result) => {
      if (!live()) {
        result.cleanup();
        return;
      }
      if (result.ok && result.workspace !== null) {
        workspace = result.workspace;
        cleanupWorkspace = result.cleanup;
      }
      finish(result.ok);
    });
  };

  // ── recipe nodes: own process group, merged output ──
  const spawnNode = (node: NodeState): void => {
    const startedAt = Date.now();
    setNode(node.id, { status: "running", startedAt });
    const child = spawn(node.command, {
      shell: true,
      cwd: workspace,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    children.set(node.id, child);
    child.stdout?.setEncoding("utf-8");
    child.stderr?.setEncoding("utf-8");
    const onOutput = (chunk: string): void => {
      if (children.get(node.id) !== child) return;
      appendLog(node.id, chunk);
    };
    child.stdout?.on("data", onOutput);
    child.stderr?.on("data", onOutput);
    const finish = (status: NodeStatus, exitCode: number | null): void => {
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
      if (children.get(node.id) === child) {
        appendLog(node.id, `\n[odu] spawn failed: ${err.message}\n`);
      }
      finish("failed", null);
    });
    child.on("exit", (code) => finish(code === 0 ? "ok" : "failed", code));
  };

  const killGroup = (child: ChildProcess, signal: NodeJS.Signals): void => {
    if (child.pid === undefined) return;
    try {
      // Negative pid ⇒ the whole detached process group (just → nix develop
      // → pnpm → browsers), not only the shell at the top.
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  };

  // ── rerun: reset target + transitive dependents, then reschedule ──
  const rerun = (id: string): boolean => {
    if (disposed || getState().nodes[id] === undefined) return false;
    const toReset = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const candidate of getState().order) {
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
        killGroup(child, "SIGTERM");
      }
      if (rid === SETUP_NODE_ID) setupGeneration += 1;
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

  const router = implement(laneSurface.contract).router({ ...fragment.router });

  return {
    router,
    dispose: () => {
      disposed = true;
      for (const child of children.values()) killGroup(child, "SIGKILL");
      children.clear();
      // Keep the worktree when anything failed — it is the debugging trail;
      // the host tmpdir reaper owns the long tail.
      const state = getState();
      const settledGreen =
        state.order.length > 0 &&
        state.order.every((id) => state.nodes[id]?.status === "ok");
      if (settledGreen) cleanupWorkspace?.();
    },
  };
}
