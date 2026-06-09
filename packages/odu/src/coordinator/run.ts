/**
 * `odu run` — the coordinator. One process owns the whole run, mirroring the
 * lease wrapper's constraint (the flock lives in `ci/pu/run.sh`, which
 * parents exactly one coordinator):
 *
 *   strict gate → HEAD snapshot → `just` DAG ingest → fan lanes out per
 *   platform (HostSession each) → merge lane state into one fan-in surface
 *   served on `.ci/odu.sock` → write per-SHA logs + post commit statuses on
 *   transitions → verdict.
 *
 * Status posting and `--progress json` are both *diff-driven off the fan-in
 * state*, so every observer derives from the same source of truth the
 * dashboards attach to.
 */

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type Channel,
  implementSurface,
  inMemoryChannel,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import { isLocalHost } from "@kolu/surface-nix-host";
import { implement } from "@orpc/server";
import { formatGoDuration } from "../common/duration";
import type { TaskSpec } from "../common/spec";
import {
  clampLog,
  type NodeLogMessage,
  type NodeState,
  type NodeStatus,
  oduSurface,
  type PipelineState,
} from "../common/surface";
import { laneTasks, loadJustPipeline, parseSelector } from "../just/ingest";
import { destroyAllSessions, type Lane, startLane } from "./lane";
import { loadHosts, resolveLanes } from "./hosts";
import { serveSocket, SOCKET_PATH } from "./socket";
import {
  fetchUrlFor,
  logPathFor,
  parseGithubRemote,
  StatusPoster,
  statusFor,
} from "./statuses";

const SETUP = "_ci-setup";

export interface RunArgs {
  selectors: string[];
  platforms: string[];
  hostPins: string[];
  root?: string;
  noDeps: boolean;
  noStrict: boolean;
  noSnapshot: boolean;
  noPost: boolean;
  progressJson: boolean;
}

interface ProgressEvent {
  node: string;
  recipe: string;
  platform: string;
  status: "running" | "success" | "failed" | "skipped" | "errored";
  exit_code?: number;
  log: string;
}

const PROGRESS_STATUS: Record<NodeStatus, ProgressEvent["status"] | null> = {
  pending: null,
  running: "running",
  ok: "success",
  failed: "failed",
  skipped: "skipped",
  errored: "errored",
};

function git(repo: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(`odu: git ${args.join(" ")} failed:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function tryGit(repo: string, args: string[]): string | null {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf-8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

export async function runCommand(args: RunArgs): Promise<number> {
  const repoRoot = git(process.cwd(), ["rev-parse", "--show-toplevel"]);

  // ── modes (the justci flag table: strict by default) ──
  const snapshotMode = !args.noStrict && !args.noSnapshot;
  const posting = snapshotMode && !args.noPost;
  if (snapshotMode) {
    const dirty = git(repoRoot, ["status", "--porcelain"]);
    if (dirty !== "") {
      process.stderr.write(
        "odu: working tree is dirty — strict mode refuses it.\n" +
          "Commit (or stash) first, or pass --no-strict for a dev iteration run.\n",
      );
      return 1;
    }
  }

  const sha = git(repoRoot, ["rev-parse", "HEAD"]);
  const sha7 = sha.slice(0, 7);

  // ── HEAD pin: the run sees the commit, never the live tree ──
  let snapshotDir: string | null = null;
  if (snapshotMode) {
    snapshotDir = mkdtempSync(join(tmpdir(), `odu-${sha7}-`));
    git(repoRoot, ["worktree", "add", "--detach", snapshotDir, "HEAD"]);
  }
  const specSource = snapshotDir ?? repoRoot;

  const cleanupSnapshot = (): void => {
    if (snapshotDir === null) return;
    tryGit(repoRoot, ["worktree", "remove", "--force", snapshotDir]);
    rmSync(snapshotDir, { recursive: true, force: true });
    snapshotDir = null;
  };

  try {
    return await orchestrate(args, {
      repoRoot,
      specSource,
      sha,
      sha7,
      posting,
      snapshotMode,
    });
  } finally {
    cleanupSnapshot();
    destroyAllSessions();
  }
}

interface RunContext {
  repoRoot: string;
  specSource: string;
  sha: string;
  sha7: string;
  posting: boolean;
  snapshotMode: boolean;
}

async function orchestrate(args: RunArgs, ctx: RunContext): Promise<number> {
  const { repoRoot, specSource, sha, sha7 } = ctx;
  const info = (msg: string): void => {
    process.stderr.write(`${msg}\n`);
  };

  // ── DAG + lanes ──
  const spec = loadJustPipeline(specSource, { root: args.root });
  const hostsConfig = loadHosts();
  const lanesByPlatform = resolveLanes(
    hostsConfig,
    args.hostPins,
    args.platforms,
  );
  const selectors = args.selectors.map(parseSelector);
  for (const selector of selectors) {
    if (
      selector.platform !== undefined &&
      lanesByPlatform[selector.platform] === undefined
    ) {
      throw new Error(
        `odu: selector platform "${selector.platform}" is not in the fanout ` +
          `(${Object.keys(lanesByPlatform).join(", ") || "no lanes"})`,
      );
    }
  }

  const platforms = Object.keys(lanesByPlatform).sort();
  const tasksByPlatform = new Map<string, TaskSpec[]>();
  for (const platform of platforms) {
    const tasks = laneTasks(spec, platform, selectors, args.noDeps);
    if (tasks.length > 0) tasksByPlatform.set(platform, tasks);
  }
  if (tasksByPlatform.size === 0) {
    throw new Error("odu: nothing to run (no lane has a matching recipe)");
  }

  // ── forge coordinates ──
  const originUrl = tryGit(repoRoot, ["remote", "get-url", "origin"]);
  const github = originUrl !== null ? parseGithubRemote(originUrl) : null;
  if (ctx.posting && github === null) {
    throw new Error(
      "odu: posting commit statuses needs a github.com origin remote " +
        "(pass --no-post for non-GitHub strict runs)",
    );
  }
  for (const [platform, host] of Object.entries(lanesByPlatform)) {
    if (
      !isLocalHost(host) &&
      originUrl === null &&
      tasksByPlatform.has(platform)
    ) {
      throw new Error(
        `odu: remote lane ${platform}=${host} needs an origin remote to fetch from`,
      );
    }
  }

  const poster = new StatusPoster({
    owner: github?.owner ?? "",
    repo: github?.repo ?? "",
    sha,
    enabled: ctx.posting,
    onLine: info,
  });

  // ── fan-in state: one PipelineState keyed `<node>@<platform>` ──
  const order: string[] = [];
  const nodes: Record<string, NodeState> = {};
  const laneStart = new Map<string, number>();
  for (const platform of [...tasksByPlatform.keys()].sort()) {
    const tasks = tasksByPlatform.get(platform) ?? [];
    const setupId = `${SETUP}@${platform}`;
    order.push(setupId);
    nodes[setupId] = {
      id: setupId,
      name: setupId,
      command: `(provision ${lanesByPlatform[platform]})`,
      needs: [],
      status: "pending",
      exitCode: null,
      startedAt: null,
      durationMs: null,
    };
    for (const task of tasks) {
      const id = `${task.id}@${platform}`;
      order.push(id);
      nodes[id] = {
        id,
        name: task.id,
        command: task.command,
        needs: [...task.needs, SETUP].map((dep) => `${dep}@${platform}`),
        status: "pending",
        exitCode: null,
        startedAt: null,
        durationMs: null,
      };
    }
  }

  const store = inMemoryStore<PipelineState>({
    name: spec.name,
    order,
    nodes,
  });

  // ── per-node local logs: tail buffer for late socket subscribers + the
  //    durable per-SHA file (.ci/<sha7>/<plat>/<node>.log, justci's layout) ──
  interface LocalLog {
    buffer: string;
    bus: Channel<NodeLogMessage>;
  }
  const logs = new Map<string, LocalLog>();
  const logFor = (id: string): LocalLog => {
    let log = logs.get(id);
    if (log === undefined) {
      log = { buffer: "", bus: inMemoryChannel<NodeLogMessage>() };
      logs.set(id, log);
    }
    return log;
  };
  const fileFor = (id: string): string => join(repoRoot, logPathFor(sha7, id));
  const appendLocal = (id: string, text: string): void => {
    const log = logFor(id);
    log.buffer = clampLog(log.buffer + text);
    log.bus.publish({ kind: "append", text });
    const file = fileFor(id);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, text);
  };
  const resetLocal = (id: string, text: string): void => {
    const log = logFor(id);
    log.buffer = clampLog(text);
    log.bus.publish({ kind: "snapshot", text: log.buffer });
    const file = fileFor(id);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };

  // ── the fan-in surface (status/logs/monitor attach to this) ──
  const lanes = new Map<string, Lane>();
  const fragment = implementSurface(oduSurface, {
    channel: inMemoryChannelByName(),
    cells: { nodes: { store } },
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
        rerun: async ({ input }) => {
          const at = input.id.lastIndexOf("@");
          const lane = at > 0 ? lanes.get(input.id.slice(at + 1)) : undefined;
          if (lane === undefined) return { ok: false };
          return { ok: await lane.rerun(input.id.slice(0, at)) };
        },
      },
    },
  });
  const router = implement(oduSurface.contract).router({ ...fragment.router });

  // ── observers: progress stream + commit statuses, diffed per transition ──
  const emitProgress = (id: string, node: NodeState): void => {
    const status = PROGRESS_STATUS[node.status];
    if (status === null) return;
    const at = id.lastIndexOf("@");
    const event: ProgressEvent = {
      node: id,
      recipe: id.slice(0, at),
      platform: id.slice(at + 1),
      status,
      ...(node.exitCode !== null ? { exit_code: node.exitCode } : {}),
      log: logPathFor(sha7, id),
    };
    if (args.progressJson) {
      process.stdout.write(`${JSON.stringify(event)}\n`);
    } else {
      process.stdout.write(`${status.padEnd(8)} ${id}\n`);
    }
  };

  let settled: () => void = () => {};
  const allSettled = new Promise<void>((resolve) => {
    settled = resolve;
  });
  const checkSettled = (): void => {
    const state = store.get();
    const done = state.order.every((id) => {
      const status = state.nodes[id]?.status;
      return status !== "pending" && status !== "running";
    });
    if (done) settled();
  };

  const updateNode = (id: string, patch: Partial<NodeState>): void => {
    const cur = store.get();
    const prev = cur.nodes[id];
    if (prev === undefined) return;
    const next = { ...prev, ...patch };
    if (
      next.status === prev.status &&
      next.exitCode === prev.exitCode &&
      next.durationMs === prev.durationMs
    ) {
      return;
    }
    fragment.ctx.cells.nodes.set({
      ...cur,
      nodes: { ...cur.nodes, [id]: next },
    });
    if (next.status !== prev.status) {
      emitProgress(id, next);
      const payload = statusFor(id, next.status, next.durationMs, sha7);
      if (payload !== null) poster.post(payload);
      checkSettled();
    }
  };

  // ── socket + lanes ──
  mkdirSync(join(repoRoot, ".ci"), { recursive: true });
  const closeSocket = await serveSocket(router, join(repoRoot, SOCKET_PATH));

  info(
    `odu: pipeline ${spec.name} @ ${sha7} — lanes: ${[...tasksByPlatform.keys()]
      .sort()
      .map((p) => `${p}=${lanesByPlatform[p]}`)
      .join(", ")} (hosts: ${hostsConfig.source})`,
  );

  for (const platform of [...tasksByPlatform.keys()].sort()) {
    const host = lanesByPlatform[platform] as string;
    const tasks = tasksByPlatform.get(platform) ?? [];
    const setupId = `${SETUP}@${platform}`;
    laneStart.set(platform, Date.now());
    updateNode(setupId, { status: "running", startedAt: Date.now() });

    const local = isLocalHost(host);
    const lane = startLane({
      platform,
      host,
      tasks,
      pipelineName: spec.name,
      origin: local || originUrl === null ? null : fetchUrlFor(originUrl),
      sha: local ? null : sha,
      workspace: local ? specSource : null,
      resolveDrvPath: async () => {
        const result = spawnSync(
          "nix",
          [
            "eval",
            "--raw",
            "--accept-flake-config",
            `${specSource}#packages.${platform}.odu-runner.drvPath`,
          ],
          { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 },
        );
        if (result.status !== 0) {
          throw new Error(`nix eval odu-runner drv failed:\n${result.stderr}`);
        }
        return result.stdout.trim();
      },
      onSetupLine: (line) => appendLocal(setupId, `${line}\n`),
      onNodes: (laneState) => {
        for (const laneId of laneState.order) {
          const laneNode = laneState.nodes[laneId];
          if (laneNode === undefined) continue;
          const fanId = `${laneId}@${platform}`;
          if (laneId === SETUP) {
            // justci's _ci-setup brackets ship+prep; ours brackets
            // provision+fetch+worktree — duration is coordinator-measured.
            const startedAt = laneStart.get(platform) ?? Date.now();
            const terminal =
              laneNode.status !== "pending" && laneNode.status !== "running";
            updateNode(fanId, {
              status:
                laneNode.status === "pending" ? "running" : laneNode.status,
              exitCode: laneNode.exitCode,
              startedAt,
              durationMs: terminal ? Date.now() - startedAt : null,
            });
          } else {
            updateNode(fanId, {
              status: laneNode.status,
              exitCode: laneNode.exitCode,
              startedAt: laneNode.startedAt,
              durationMs: laneNode.durationMs,
            });
          }
        }
      },
      onLogFrame: (laneId, frame) => {
        const fanId = `${laneId}@${platform}`;
        if (frame.kind === "append") {
          appendLocal(fanId, frame.text);
        } else if (laneId === SETUP) {
          // Never reset _ci-setup: the coordinator's provision lines precede
          // the lane stream and must survive the lane's snapshot frame.
          if (frame.text !== "") appendLocal(fanId, frame.text);
        } else if (frame.text !== "" || logFor(fanId).buffer !== "") {
          resetLocal(fanId, frame.text);
        }
      },
      onDead: (error) => {
        const state = store.get();
        for (const id of state.order) {
          if (!id.endsWith(`@${platform}`)) continue;
          const status = state.nodes[id]?.status;
          if (status === "running") {
            appendLocal(id, `\n[odu] lane died: ${error}\n`);
            const startedAt = state.nodes[id]?.startedAt ?? Date.now();
            updateNode(id, {
              status: "errored",
              durationMs: Date.now() - startedAt,
            });
          } else if (status === "pending") {
            updateNode(id, { status: "skipped" });
          }
        }
      },
    });
    lanes.set(platform, lane);
  }

  // ── finalizer: an interrupted coordinator must not strand `Running:`
  //    contexts as eternally-pending checks ──
  let interrupted = false;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (interrupted) return;
    interrupted = true;
    info(`odu: ${signal} — finalizing posted statuses before exit`);
    for (const context of poster.pendingContexts()) {
      poster.post({
        state: "error",
        context,
        description: `Errored (interrupted): ${logPathFor(sha7, context)}`,
      });
    }
    void poster.settle().then(() => {
      for (const lane of lanes.values()) lane.close();
      closeSocket();
      process.exit(130);
    });
  };
  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("SIGTERM", () => onSignal("SIGTERM"));

  await allSettled;

  for (const lane of lanes.values()) lane.close();
  closeSocket();
  await poster.settle();

  // ── verdict ──
  const finalState = store.get();
  const counts = { ok: 0, failed: 0, errored: 0, skipped: 0 };
  const lines: string[] = ["── ci run summary ──"];
  for (const id of finalState.order) {
    const node = finalState.nodes[id];
    if (node === undefined) continue;
    if (node.status === "ok") counts.ok += 1;
    else if (node.status === "failed") counts.failed += 1;
    else if (node.status === "errored") counts.errored += 1;
    else if (node.status === "skipped") counts.skipped += 1;
    const glyph =
      node.status === "ok" ? "✔" : node.status === "skipped" ? "⊘" : "✗";
    const dur =
      node.durationMs !== null ? ` ${formatGoDuration(node.durationMs)}` : "";
    const logRef =
      node.status === "failed" || node.status === "errored"
        ? `  ${logPathFor(sha7, id)}`
        : "";
    lines.push(`  ${glyph} ${id.padEnd(44)} ${node.status}${dur}${logRef}`);
  }
  const red = counts.failed + counts.errored;
  lines.push(
    `${counts.ok} ok · ${counts.failed} failed · ${counts.errored} errored · ${counts.skipped} skipped — ${
      red > 0 ? "FAILED" : "OK"
    }`,
  );
  process.stderr.write(`${lines.join("\n")}\n`);

  return red > 0 ? 1 : 0;
}
