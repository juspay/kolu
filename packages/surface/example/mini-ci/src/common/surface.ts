/**
 * mini-ci surface — the shape the runner serves over stdio and the TUI
 * consumes. Three primitives carry the whole tool, and they are a clean
 * structural twin of what `kolu-tui` will need (see
 * `docs/plans/remote-terminals.pty-daemon.tui.html`):
 *
 *   - `nodes`   — a Cell holding the entire pipeline's node-state.
 *                 Snapshot-then-delta. ↔ kolu-tui's `list`.
 *   - `nodeLog` — a Stream of one node's output, parameterised by id.
 *                 First frame is the buffered snapshot, then `append`
 *                 deltas. ↔ kolu-tui's `attach` (snapshot-then-delta).
 *   - `node.rerun` — an imperative procedure (the only mutation).
 *                 ↔ kolu-tui's input.
 *
 * The plan writes these as `nodes.list()` / `node.log(id)` / `node.rerun(id)`;
 * the surface-idiomatic spelling the framework derives is
 * `surface.nodes.get({})` / `surface.nodeLog.get({ id })` /
 * `surface.node.rerun({ id })`. The mapping is the point — if the surface
 * primitives express this cleanly, the seam is at the right altitude for
 * kolu-tui to inherit; if it were awkward, that would be a framework
 * finding to fix *before* kolu-tui adopts it.
 */

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import { z } from "zod";
import { TaskIdSchema } from "./pipeline";

export const NodeStatusSchema = z.enum([
  "pending",
  "running",
  "ok",
  "failed",
  "skipped",
]);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const NodeStateSchema = z.object({
  id: TaskIdSchema,
  name: z.string(),
  command: z.string(),
  needs: z.array(TaskIdSchema),
  status: NodeStatusSchema,
  /** Process exit code once terminal; `null` while pending/running or when
   *  the process never spawned. */
  exitCode: z.number().int().nullable(),
  /** `Date.now()` when the node started running; `null` until then. */
  startedAt: z.number().nullable(),
  /** Wall-clock run time in ms once terminal; `null` otherwise. */
  durationMs: z.number().nullable(),
});
export type NodeState = z.infer<typeof NodeStateSchema>;

export const PipelineStateSchema = z.object({
  name: z.string(),
  /** Task ids in declaration order — the row order the dashboard paints. */
  order: z.array(TaskIdSchema),
  nodes: z.record(TaskIdSchema, NodeStateSchema),
});
export type PipelineState = z.infer<typeof PipelineStateSchema>;

export const EMPTY_STATE: PipelineState = {
  name: "pipeline",
  order: [],
  nodes: {},
};

/** Per-node log frame — the discriminated-union shape the
 *  remote-process-monitor example pioneered. A fresh subscriber's first
 *  frame is `snapshot` (the buffered-so-far output); subsequent frames are
 *  `append` deltas. A `rerun` that clears a node's log re-emits a
 *  `snapshot` with empty text, so a still-attached client resets cleanly
 *  rather than seeing the new run's lines glued onto the old buffer. */
export const NodeLogMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("snapshot"), text: z.string() }),
  z.object({ kind: z.literal("append"), text: z.string() }),
]);
export type NodeLogMessage = z.infer<typeof NodeLogMessageSchema>;

/** Cap a per-node log to its last `MAX_LOG_CHARS` — bounds memory for a noisy
 *  command, on both the runner's buffer and the TUI's accumulated copy. The
 *  dashboard only paints the tail anyway, so this is a `tail`-style drop of
 *  the oldest output, applied at both ends so they stay consistent. */
export const MAX_LOG_CHARS = 64 * 1024;
export function clampLog(buffer: string): string {
  return buffer.length > MAX_LOG_CHARS
    ? buffer.slice(buffer.length - MAX_LOG_CHARS)
    : buffer;
}

export const surface = defineSurface({
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
  procedures: {
    node: {
      rerun: {
        input: z.object({ id: TaskIdSchema }),
        output: z.object({ ok: z.boolean() }),
      },
    },
  },
});

type SF = SurfaceTypes<typeof surface.spec>;
export type NodesSnapshot = SF["cells"]["nodes"]["Value"];
export type NodeLogFrame = SF["streams"]["nodeLog"]["Output"];
