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
  implementSurface,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import { destroyAllSessions, isLocalHost } from "@kolu/surface-nix-host";
import { implement } from "@orpc/server";
import { bold, dim, green, magenta, red } from "../cli/ansi";
import { formatGoDuration } from "../common/duration";
import { createLogTail } from "../common/logTail";
import { fanId, onPlatform, splitFanId } from "../common/nodeId";
import type { TaskSpec } from "../common/spec";
import {
  type NodeState,
  oduSurface,
  pendingNode,
  type PipelineState,
  STATUS_META,
} from "../common/surface";
import { createDisplay, type ProgressEvent } from "./display";
import { laneTasks, loadJustPipeline, parseSelector } from "../just/ingest";
import { loadHosts, resolveLanes } from "./hosts";
import { type Lane, startLane } from "./lane";
import { SOCKET_PATH, serveSocket } from "./socket";
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
  const dirty = git(repoRoot, ["status", "--porcelain"]) !== "";
  if (snapshotMode && dirty) {
    process.stderr.write(
      "odu: working tree is dirty — strict mode refuses it.\n" +
        "Commit (or stash) first, or pass --no-strict for a dev iteration run.\n",
    );
    return 1;
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
      dirty,
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
  /** Working tree has uncommitted changes (only reachable when !snapshotMode). */
  dirty: boolean;
}

async function orchestrate(args: RunArgs, ctx: RunContext): Promise<number> {
  const { repoRoot, specSource, sha, sha7 } = ctx;
  // Where stdout points picks the face: NDJSON for the /do contract, an
  // in-place live matrix on a TTY, transition lines + heartbeats for a pipe.
  const display = createDisplay(
    args.progressJson
      ? "json"
      : process.stdout.isTTY === true
        ? "live"
        : "plain",
  );
  const info = (msg: string): void => {
    display.info(msg);
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
    if (!tasksByPlatform.has(platform)) continue;
    if (!isLocalHost(host) && originUrl === null) {
      throw new Error(
        `odu: remote lane ${platform}=${host} needs an origin remote to fetch from`,
      );
    }
    // Live-tree mode (no snapshot) only honors a dirty tree on localhost: a
    // remote lane fetches the committed HEAD, so on a dirty tree it would
    // silently test stale code while local lanes test your edits. Refuse it
    // rather than hand back a misleading verdict.
    if (!ctx.snapshotMode && ctx.dirty && !isLocalHost(host)) {
      throw new Error(
        `odu: live-tree mode (--no-snapshot/--no-strict) on a dirty tree only ` +
          `applies to localhost lanes — remote lane ${platform}=${host} would ` +
          `fetch the committed HEAD (${ctx.sha7}), not your uncommitted changes. ` +
          `Commit and push first, or slice to local platforms with --platform.`,
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
    const setupId = fanId(SETUP, platform);
    order.push(setupId);
    nodes[setupId] = pendingNode({
      id: setupId,
      name: setupId,
      command: `(provision ${lanesByPlatform[platform]})`,
      needs: [],
    });
    for (const task of tasks) {
      const id = fanId(task.id, platform);
      order.push(id);
      nodes[id] = pendingNode({
        id,
        name: task.id,
        command: task.command,
        needs: [...task.needs, SETUP].map((dep) => fanId(dep, platform)),
      });
    }
  }

  const store = inMemoryStore<PipelineState>({
    name: spec.name,
    order,
    nodes,
  });

  // ── per-node local logs: the in-memory tail (late socket subscribers) plus
  //    the durable per-SHA file (.ci/<sha7>/<plat>/<node>.log, justci's layout).
  //    The tail is the shared primitive; durability is this coordinator's
  //    addition, layered on top of each tail mutation. ──
  const tail = createLogTail();
  const fileFor = (id: string): string => join(repoRoot, logPathFor(sha7, id));
  const appendLocal = (id: string, text: string): void => {
    tail.append(id, text);
    display.logLine(id, text);
    const file = fileFor(id);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, text);
  };
  const resetLocal = (id: string, text: string): void => {
    tail.reset(id, text);
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
      nodeLog: { source: tail.streamSource },
    },
    procedures: {
      node: {
        rerun: async ({ input }) => {
          // A bare lane-local id (no `@`) carries no platform to route to:
          // splitFanId reports it as the "unknown" sentinel, which has no lane,
          // so the request is unroutable — `ok: false`, same as a missing lane.
          const { namepath, platform } = splitFanId(input.id);
          const lane = platform === "unknown" ? undefined : lanes.get(platform);
          if (lane === undefined) return { ok: false };
          return { ok: await lane.rerun(namepath) };
        },
      },
    },
  });
  const router = implement(oduSurface.contract).router({ ...fragment.router });

  // ── observers: progress stream + commit statuses, diffed per transition ──
  const emitProgress = (id: string, node: NodeState): void => {
    const status = STATUS_META[node.status].progress;
    if (status === null) return;
    const { namepath, platform } = splitFanId(id);
    const event: ProgressEvent = {
      node: id,
      recipe: namepath,
      platform,
      status,
      ...(node.exitCode !== null ? { exit_code: node.exitCode } : {}),
      log: logPathFor(sha7, id),
    };
    display.transition(event, node);
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
    display.update(store.get());
    if (next.status !== prev.status) {
      emitProgress(id, next);
      const payload = statusFor(id, next.status, next.durationMs, sha7);
      if (payload !== null) poster.post(payload);
      checkSettled();
    }
  };

  // The _ci-setup node's lifecycle is coordinator-owned, not lane-mirrored:
  // its `running` start is stamped when the coordinator begins provisioning
  // (laneStart, below), and its duration is coordinator-measured because our
  // _ci-setup brackets provision+fetch+worktree, which precedes the lane
  // stream. From the lane we take only the terminal verdict (ok/failed).
  const finishSetup = (
    platform: string,
    status: NodeState["status"],
    exitCode: number | null,
  ): void => {
    const id = fanId(SETUP, platform);
    // Freeze the duration at the first terminal transition: lane frames keep
    // arriving for the rest of the run, and re-deriving Date.now() − start
    // on each one silently inflates the settled number.
    const current = store.get().nodes[id]?.status;
    if (current !== "pending" && current !== "running") return;
    const startedAt = laneStart.get(platform) ?? Date.now();
    updateNode(id, {
      status,
      exitCode,
      startedAt,
      durationMs: Date.now() - startedAt,
    });
  };

  // ── socket + lanes ──
  mkdirSync(join(repoRoot, ".ci"), { recursive: true });
  const closeSocket = await serveSocket(router, join(repoRoot, SOCKET_PATH));

  display.start({
    pipeline: spec.name,
    sha7,
    lanes: [...tasksByPlatform.keys()].sort().map((platform) => ({
      platform,
      host: lanesByPlatform[platform] as string,
    })),
    hostsSource: hostsConfig.source,
  });
  display.update(store.get());

  for (const platform of [...tasksByPlatform.keys()].sort()) {
    const host = lanesByPlatform[platform] as string;
    const tasks = tasksByPlatform.get(platform) ?? [];
    const setupId = fanId(SETUP, platform);
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
          if (laneId === SETUP) {
            // The coordinator owns _ci-setup's timing (finishSetup); from the
            // lane we mirror only its terminal verdict, leaving the
            // coordinator-stamped `running` start untouched until then.
            const terminal =
              laneNode.status !== "pending" && laneNode.status !== "running";
            if (terminal) {
              finishSetup(platform, laneNode.status, laneNode.exitCode);
            }
            continue;
          }
          updateNode(fanId(laneId, platform), {
            status: laneNode.status,
            exitCode: laneNode.exitCode,
            startedAt: laneNode.startedAt,
            durationMs: laneNode.durationMs,
          });
        }
      },
      onLogFrame: (laneId, frame) => {
        const id = fanId(laneId, platform);
        if (frame.kind === "append") {
          appendLocal(id, frame.text);
        } else if (laneId === SETUP) {
          // Never reset _ci-setup: the coordinator's provision lines precede
          // the lane stream and must survive the lane's snapshot frame.
          if (frame.text !== "") appendLocal(id, frame.text);
        } else if (frame.text !== "" || tail.logFor(id).buffer !== "") {
          resetLocal(id, frame.text);
        }
      },
      onDead: (error) => {
        const state = store.get();
        for (const id of state.order) {
          if (!onPlatform(id, platform)) continue;
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
      display.stop(store.get());
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
  display.stop(finalState);
  const counts = { ok: 0, failed: 0, errored: 0, skipped: 0 };
  let redCount = 0;
  const lines: string[] = [dim("── ci run summary ──")];
  for (const id of finalState.order) {
    const node = finalState.nodes[id];
    if (node === undefined) continue;
    if (node.status === "ok") counts.ok += 1;
    else if (node.status === "failed") counts.failed += 1;
    else if (node.status === "errored") counts.errored += 1;
    else if (node.status === "skipped") counts.skipped += 1;
    if (STATUS_META[node.status].isRed) redCount += 1;
    const color =
      node.status === "ok"
        ? green
        : node.status === "errored"
          ? magenta
          : node.status === "failed"
            ? red
            : dim;
    const glyph = color(STATUS_META[node.status].glyph);
    const dur =
      node.durationMs !== null
        ? ` ${dim(formatGoDuration(node.durationMs))}`
        : "";
    const logRef =
      node.status === "failed" || node.status === "errored"
        ? dim(`  ${logPathFor(sha7, id)}`)
        : "";
    lines.push(`  ${glyph} ${id.padEnd(44)} ${node.status}${dur}${logRef}`);
  }
  lines.push(
    `${counts.ok} ok · ${counts.failed} failed · ${counts.errored} errored · ${counts.skipped} skipped — ${
      redCount > 0 ? bold(red("FAILED")) : bold(green("OK"))
    }`,
  );
  process.stderr.write(`${lines.join("\n")}\n`);

  // ── timing sidecar: the per-node durations report.sh used to scrape out of
  //    justci's process-compose log (.ci/pc.log). odu owns the durations in
  //    its state cell, so it writes them directly rather than leaving anyone
  //    to re-parse logs. JSON lines, one per node: {node, recipe, platform,
  //    status, startedAt, durationMs, exitCode}. ──
  try {
    const timingLines: string[] = [];
    for (const id of finalState.order) {
      const node = finalState.nodes[id];
      if (node === undefined) continue;
      const { namepath, platform } = splitFanId(id);
      timingLines.push(
        JSON.stringify({
          node: id,
          recipe: namepath,
          platform,
          status: node.status,
          startedAt: node.startedAt,
          durationMs: node.durationMs,
          exitCode: node.exitCode,
        }),
      );
    }
    const timingsFile = join(repoRoot, ".ci", sha7, "timings.jsonl");
    mkdirSync(dirname(timingsFile), { recursive: true });
    writeFileSync(timingsFile, `${timingLines.join("\n")}\n`);
  } catch {
    // best-effort: a missing sidecar only degrades the metrics comment
  }

  return redCount > 0 ? 1 : 0;
}
