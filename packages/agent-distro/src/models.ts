/**
 * The models a harness offers on a host, and how a launch is given one —
 * upstream's `agent-distro --models <harness>` (`@juspay/agent-distro/models`),
 * read with upstream's own parser. Each harness says both in its own adapter
 * upstream; kolu never re-describes a harness, so there is no table here of
 * list commands, model flags or model names.
 *
 * Three answers, and kolu keeps them apart all the way to the screen:
 *
 *  - `listed` — the ids the harness listed (possibly none). An id is exactly
 *    what the launch takes (`anthropic/claude-fable-5`), so the same model
 *    under two providers is two ids.
 *  - `unlisted` — the harness has no command that lists its models (Claude
 *    Code, Codex): a model is whatever the person names.
 *  - a failure — the harness's list command failed, in its own words. It is
 *    never an answer: whoever runs the command raises it.
 */

import {
  launchWords,
  type ModelLaunch,
  parseModels,
} from "@juspay/agent-distro/models";
import { Schema } from "effect";

/** How a launch is given a model — upstream's `ModelLaunch`, as a wire
 *  schema: a flag before the harness's own arguments, or a config layer in
 *  its environment. */
export const AgentModelLaunchSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("flag"), flag: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("config"),
    variable: Schema.String,
    key: Schema.String,
  }),
]);
export type AgentModelLaunch = typeof AgentModelLaunchSchema.Type;

/** The models themselves, or that the harness cannot list them. */
export const AgentModelListSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("listed"),
    ids: Schema.Array(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("unlisted") }),
]);
export type AgentModelList = typeof AgentModelListSchema.Type;

/** One harness's answer on one host — upstream's `Models`. */
export const AgentModelsSchema = Schema.Struct({
  harness: Schema.String,
  launch: AgentModelLaunchSchema,
  models: AgentModelListSchema,
});
export type AgentModels = typeof AgentModelsSchema.Type;

/** The arguments that make a package's `bin/agent-distro` answer for
 *  `harness`. */
export const modelsArgs = (harness: string): readonly string[] => [
  "--models",
  harness,
];

/** The answer in `--models`' stdout, checked by upstream's own parser — a
 *  throw for anything out of its format, which is a format change upstream
 *  must be loud about. */
export function parseAgentModels(stdout: string): AgentModels {
  return parseModels(JSON.parse(stdout));
}

/** THE START OF A LAUNCH THAT RUNS `model`: the environment and the arguments
 *  the harness takes for it, before anything else it is given — upstream's
 *  `launchWords`, so the one place a model flag is spelled is the harness's
 *  own adapter. Throws for a model that is not one word. */
export function modelLaunchWords(
  launch: AgentModelLaunch,
  model: string,
): {
  readonly env: Readonly<Record<string, string>>;
  readonly args: readonly string[];
} {
  const upstream: ModelLaunch = launch;
  return launchWords(upstream, model);
}
