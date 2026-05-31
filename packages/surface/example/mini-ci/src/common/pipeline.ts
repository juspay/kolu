/**
 * Pipeline spec — the toy task DAG mini-ci runs.
 *
 * A pipeline is a small set of tasks, each a shell command with a list of
 * `needs` (the ids of tasks that must finish `ok` first). The runner topo-
 * sorts them, runs every currently-runnable task in parallel, and skips a
 * task whose dependency failed. This is the deliberately-minimal cousin of
 * the real [justci](https://github.com/juspay/justci): no Haskell, no
 * GitHub statuses, no multi-platform fan-out — just a DAG of shell commands.
 *
 * Pipelines are plain JSON (`--pipeline ci.json`); the built-in
 * `DEFAULT_PIPELINE` is the `build → test → lint` spine the plan's mock
 * shows, so `mini-ci` runs with zero config.
 */

import { readFileSync } from "node:fs";
import { z } from "zod";

export const TaskIdSchema = z.string().min(1);

export const TaskSpecSchema = z.object({
  id: TaskIdSchema,
  /** Human label for the dashboard; defaults to `id`. */
  name: z.string().optional(),
  /** Shell command, run via `sh -c`. */
  command: z.string().min(1),
  /** Ids of tasks that must finish `ok` before this one starts. */
  needs: z.array(TaskIdSchema).default([]),
});

export const PipelineSpecSchema = z.object({
  name: z.string().default("pipeline"),
  tasks: z.array(TaskSpecSchema).min(1),
});

export type TaskSpec = z.infer<typeof TaskSpecSchema>;
export type PipelineSpec = z.infer<typeof PipelineSpecSchema>;

/** The zero-config pipeline — the `build → test → lint` spine from the
 *  plan's mock. Commands are hermetic (only `echo`/`sleep`, no network, no
 *  repo state) so the example runs anywhere; the short `sleep`s just make
 *  the `running` state visible in the live dashboard. */
export const DEFAULT_PIPELINE: PipelineSpec = {
  name: "ci",
  tasks: [
    {
      id: "build",
      command: "echo 'compiling 3 modules…'; sleep 0.4; echo 'build ok'",
      needs: [],
    },
    {
      id: "test",
      command: "echo 'running 12 tests…'; sleep 0.5; echo '12 passed'",
      needs: ["build"],
    },
    {
      id: "lint",
      command: "echo 'linting…'; sleep 0.3; echo 'no issues'",
      needs: ["test"],
    },
  ],
};

/** Parse + validate a pipeline. Throws on malformed JSON, schema mismatch,
 *  a `needs` that references an unknown task, or a dependency cycle (which
 *  would otherwise leave the scheduler with no runnable node and hang). */
export function validatePipeline(spec: PipelineSpec): PipelineSpec {
  const ids = new Set(spec.tasks.map((t) => t.id));
  if (ids.size !== spec.tasks.length) {
    throw new Error("mini-ci: duplicate task id in pipeline");
  }
  for (const task of spec.tasks) {
    for (const dep of task.needs) {
      if (!ids.has(dep)) {
        throw new Error(
          `mini-ci: task "${task.id}" needs unknown task "${dep}"`,
        );
      }
    }
  }
  assertAcyclic(spec);
  return spec;
}

/** Kahn's algorithm purely as a cycle check — if not every node drains, a
 *  cycle remains. */
function assertAcyclic(spec: PipelineSpec): void {
  const indegree = new Map<string, number>();
  for (const task of spec.tasks) indegree.set(task.id, task.needs.length);
  const queue = spec.tasks.filter((t) => t.needs.length === 0).map((t) => t.id);
  let drained = 0;
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    drained += 1;
    for (const task of spec.tasks) {
      if (!task.needs.includes(id)) continue;
      const next = (indegree.get(task.id) ?? 0) - 1;
      indegree.set(task.id, next);
      if (next === 0) queue.push(task.id);
    }
  }
  if (drained !== spec.tasks.length) {
    throw new Error("mini-ci: pipeline has a dependency cycle");
  }
}

/** Load a pipeline from a JSON file, or the built-in default when no path
 *  is given. Reads synchronously — the runner calls this once at startup,
 *  before serving. */
export function loadPipeline(path?: string): PipelineSpec {
  if (path === undefined) return DEFAULT_PIPELINE;
  const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
  return validatePipeline(PipelineSpecSchema.parse(raw));
}
