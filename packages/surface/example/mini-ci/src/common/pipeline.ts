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
 *
 * `name` is OPTIONAL and `needs` is DEFAULTED, and the two spellings are laws:
 * `Schema.optionalKey` (the key may be ABSENT, never an explicit `undefined` —
 * `Schema.optional` would round-trip that through `null`) and
 * `Schema.withDecodingDefaultKey` (a missing key decodes to the default; an
 * explicit `undefined` is still a decode error).
 */

import { readFileSync } from "node:fs";
import { Effect, Schema } from "effect";

export const TaskIdSchema = Schema.String.check(Schema.isMinLength(1));

export const TaskSpecSchema = Schema.Struct({
  id: TaskIdSchema,
  /** Human label for the dashboard; defaults to `id`. */
  name: Schema.optionalKey(Schema.String),
  /** Shell command, run via `sh -c`. */
  command: Schema.String.check(Schema.isMinLength(1)),
  /** Ids of tasks that must finish `ok` before this one starts. */
  needs: Schema.Array(TaskIdSchema).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
});

export const PipelineSpecSchema = Schema.Struct({
  name: Schema.String.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("pipeline")),
  ),
  tasks: Schema.Array(TaskSpecSchema).check(Schema.isMinLength(1)),
});

export type TaskSpec = typeof TaskSpecSchema.Type;
export type PipelineSpec = typeof PipelineSpecSchema.Type;

/** The zero-config pipeline — **real CI for the remote-process-monitor
 *  example**: type-check its dependency closure (the `@kolu/surface` framework
 *  and `@kolu/surface-remote` in parallel, then the example itself). These
 *  are the same `tsc --noEmit` gates the repo's CI runs.
 *
 *  Tasks run against the workspace the `mini-ci-runner` closure bundles
 *  (workspace + `node_modules`, via `surfaceExampleBase`), so provisioning
 *  that closure on a remote host carries everything the checks need.
 *
 *  Only **read-only** checks (typecheck) are in the default pipeline: the
 *  closure lives in the read-only nix store, so write-heavy tasks (a `vite`
 *  build wants `node_modules/.vite-temp`, `nix build` wants `flake.nix` which
 *  isn't in the fileset) would need a writable copy of the workspace first.
 *  That's the trade-off of shipping a *closure* rather than source. */
export const DEFAULT_PIPELINE: PipelineSpec = {
  name: "remote-process-monitor",
  tasks: [
    {
      id: "surface",
      command: "pnpm --filter @kolu/surface typecheck",
      needs: [],
    },
    {
      id: "nix-host",
      command: "pnpm --filter @kolu/surface-remote typecheck",
      needs: [],
    },
    {
      id: "monitor",
      command:
        "pnpm --filter @kolu/surface-example-remote-process-monitor typecheck",
      needs: ["surface", "nix-host"],
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

/** `Schema.decodeUnknownSync` — the fail-fast successor of zod's `.parse`:
 *  it THROWS a `SchemaError` whose message is the rendered issue tree. Built
 *  once at module scope because a decoder is a compiled value, not a call. */
const decodePipeline = Schema.decodeUnknownSync(PipelineSpecSchema);

/** Load a pipeline from a JSON file, or the built-in default when no path
 *  is given. Reads synchronously — the runner calls this once at startup,
 *  before serving. */
export function loadPipeline(path?: string): PipelineSpec {
  if (path === undefined) return DEFAULT_PIPELINE;
  const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
  return validatePipeline(decodePipeline(raw));
}
