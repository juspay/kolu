/**
 * The odu surfaces — the typed contracts every face attaches to.
 *
 * Two surfaces share one state vocabulary:
 *
 *   - `laneSurface` — served by `odu-runner --stdio` on each platform's host.
 *     mini-ci's three primitives (`nodes` cell, `nodeLog` stream,
 *     `node.rerun`) plus `run.configure`, the one lane-only procedure: the
 *     runner spawns idle (HostSession argv is fixed to `--stdio`), and the
 *     coordinator sends the pipeline + workspace recipe over the surface.
 *
 *   - `oduSurface` — the fan-in the coordinator serves on `.ci/odu.sock` for
 *     `odu status` / `logs` / `monitor`. Same three primitives; node ids are
 *     `<namepath>@<platform>`.
 *
 * Call shapes (idiomatic):
 *   surface.nodes.get({})          — snapshot of the whole pipeline, then deltas
 *   surface.nodeLog.get({ id })    — buffered snapshot frame, then appends
 *   surface.node.rerun({ id })     — the only mutation: reset id + dependents
 *   surface.run.configure({ … })   — lane only; idempotence: second call errors
 */

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import { z } from "zod";
import { TaskIdSchema, TaskSpecSchema } from "./spec";

export const NodeStatusSchema = z.enum([
  "pending",
  "running",
  "ok",
  "failed",
  "skipped",
  /** Infrastructure death (lane link drop, interrupted coordinator) — never
   *  emitted by the runner itself; overlaid by the coordinator. Maps to
   *  GitHub state `error` and `--progress json` status `errored`. */
  "errored",
]);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

/** GitHub commit-status state (the `state` field of the statuses API). */
export type GithubState = "pending" | "success" | "failure" | "error";

/** `--progress json` status — the external wording for a node transition. */
export type ProgressStatus =
  | "running"
  | "success"
  | "failed"
  | "skipped"
  | "errored";

/** The single projection of a `NodeStatus` onto its external-facing
 *  representations: TUI glyph, GitHub state, `--progress json` status, and
 *  whether the status counts as "red" in the verdict. `github`/`progress` of
 *  `null` mean "post/emit nothing" for that status. Adding a `NodeStatus` is a
 *  single edit here that the compiler enforces across every consumer
 *  (render's glyph table, run's progress + verdict, statuses' state). The
 *  byte-parity wording (justci's `Running:`/`Succeeded`/… descriptions) stays
 *  with the poster — it encodes a different volatility. */
export const STATUS_META: Record<
  NodeStatus,
  {
    glyph: string;
    github: GithubState | null;
    progress: ProgressStatus | null;
    isRed: boolean;
  }
> = {
  pending: { glyph: "◦", github: null, progress: null, isRed: false },
  running: { glyph: "▶", github: "pending", progress: "running", isRed: false },
  ok: { glyph: "✔", github: "success", progress: "success", isRed: false },
  failed: { glyph: "✗", github: "failure", progress: "failed", isRed: true },
  skipped: { glyph: "⊘", github: null, progress: "skipped", isRed: false },
  errored: { glyph: "⚠", github: "error", progress: "errored", isRed: true },
};

export const NodeStateSchema = z.object({
  id: TaskIdSchema,
  name: z.string(),
  command: z.string(),
  needs: z.array(TaskIdSchema),
  status: NodeStatusSchema,
  /** Process exit code once terminal; `null` while pending/running or when
   *  the process never spawned (a spawn failure is `failed` + `null`). */
  exitCode: z.number().int().nullable(),
  /** `Date.now()` when the node started running; `null` until then. */
  startedAt: z.number().nullable(),
  /** Wall-clock run time in ms once terminal; `null` otherwise. */
  durationMs: z.number().nullable(),
});
export type NodeState = z.infer<typeof NodeStateSchema>;

export const PipelineStateSchema = z.object({
  name: z.string(),
  /** Node ids in scheduling order — the row order dashboards paint. */
  order: z.array(TaskIdSchema),
  nodes: z.record(TaskIdSchema, NodeStateSchema),
});
export type PipelineState = z.infer<typeof PipelineStateSchema>;

export const EMPTY_STATE: PipelineState = {
  name: "pipeline",
  order: [],
  nodes: {},
};

export const NodeLogMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("snapshot"), text: z.string() }),
  z.object({ kind: z.literal("append"), text: z.string() }),
]);
export type NodeLogMessage = z.infer<typeof NodeLogMessageSchema>;

/** In-memory log tail kept per node for late subscribers. The full log is
 *  durable elsewhere: the coordinator streams every `append` into
 *  `.ci/<sha>/<platform>/<node>.log` as it arrives. */
export const MAX_LOG_CHARS = 64 * 1024;
export function clampLog(buffer: string): string {
  return buffer.length > MAX_LOG_CHARS
    ? buffer.slice(buffer.length - MAX_LOG_CHARS)
    : buffer;
}

/** `run.configure` input: either `workspace` (a checkout the runner can use
 *  as-is — the coordinator's HEAD snapshot on a localhost lane) or
 *  `origin` + `sha` (the runner fetches the pushed SHA into a per-SHA
 *  worktree under ~/.cache/odu). */
export const ConfigureInputSchema = z.object({
  name: z.string(),
  origin: z.string().nullable(),
  sha: z.string().nullable(),
  workspace: z.string().nullable(),
  tasks: z.array(TaskSpecSchema).min(1),
});
export type ConfigureInput = z.infer<typeof ConfigureInputSchema>;

export const ConfigureOutputSchema = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
});
export type ConfigureOutput = z.infer<typeof ConfigureOutputSchema>;

const primitives = {
  cells: {
    nodes: {
      schema: PipelineStateSchema,
      default: EMPTY_STATE,
    },
  },
  streams: {
    nodeLog: {
      inputSchema: z.object({ id: TaskIdSchema }),
      outputSchema: NodeLogMessageSchema,
    },
  },
} as const;

const rerunProcedure = {
  rerun: {
    input: z.object({ id: TaskIdSchema }),
    output: z.object({ ok: z.boolean() }),
  },
} as const;

/** Served by `odu-runner --stdio` on each lane host. */
export const laneSurface = defineSurface({
  ...primitives,
  procedures: {
    node: rerunProcedure,
    run: {
      configure: {
        input: ConfigureInputSchema,
        output: ConfigureOutputSchema,
      },
    },
  },
});

/** Served by the coordinator on `.ci/odu.sock`; consumed by
 *  `odu status` / `logs` / `monitor`. */
export const oduSurface = defineSurface({
  ...primitives,
  procedures: {
    node: rerunProcedure,
  },
});

type LaneSF = SurfaceTypes<typeof laneSurface.spec>;
export type NodesSnapshot = LaneSF["cells"]["nodes"]["Value"];
export type NodeLogFrame = LaneSF["streams"]["nodeLog"]["Output"];
