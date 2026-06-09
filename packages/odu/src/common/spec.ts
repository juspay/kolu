/**
 * The pipeline spec — the wire shape `run.configure` carries to a lane
 * runner, and the in-memory shape the coordinator derives from the `just`
 * DAG (src/just/ingest.ts).
 *
 * Task ids are `just` namepaths (`ci::e2e`); the synthetic `_ci-setup` node
 * the runner prepends (src/runner/runner.ts) is the one non-namepath id,
 * mirroring justci's `_ci-setup@<platform>` bookkeeping context.
 */

import { z } from "zod";

export const TaskIdSchema = z.string().min(1);
export type TaskId = z.infer<typeof TaskIdSchema>;

export const TaskSpecSchema = z.object({
  id: TaskIdSchema,
  /** Display name; defaults to the id. */
  name: z.string().optional(),
  /** Shell command, run via `sh -c` from the workspace root. */
  command: z.string().min(1),
  needs: z.array(TaskIdSchema).default([]),
});
export type TaskSpec = z.infer<typeof TaskSpecSchema>;

export const PipelineSpecSchema = z.object({
  name: z.string().default("pipeline"),
  tasks: z.array(TaskSpecSchema).min(1),
});
export type PipelineSpec = z.infer<typeof PipelineSpecSchema>;

/** Throws unless every dependency names a declared task, ids are unique, and
 *  the `needs` graph is acyclic (Kahn's algorithm as a cycle check: if not
 *  every node drains, a cycle remains). */
export function validatePipeline(spec: PipelineSpec): PipelineSpec {
  const ids = new Set<string>();
  for (const task of spec.tasks) {
    if (ids.has(task.id)) {
      throw new Error(`pipeline: duplicate task id "${task.id}"`);
    }
    ids.add(task.id);
  }
  for (const task of spec.tasks) {
    for (const dep of task.needs) {
      if (!ids.has(dep)) {
        throw new Error(
          `pipeline: task "${task.id}" needs unknown task "${dep}"`,
        );
      }
    }
  }
  assertAcyclic(spec.tasks);
  return spec;
}

function assertAcyclic(tasks: readonly TaskSpec[]): void {
  const remainingDeps = new Map<string, Set<string>>(
    tasks.map((t) => [t.id, new Set(t.needs)]),
  );
  const queue = tasks.filter((t) => t.needs.length === 0).map((t) => t.id);
  let drained = 0;
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    drained += 1;
    for (const [candidate, deps] of remainingDeps) {
      if (deps.delete(id) && deps.size === 0) queue.push(candidate);
    }
  }
  if (drained !== tasks.length) {
    throw new Error("pipeline: dependency cycle detected");
  }
}
