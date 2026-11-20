import { parseLaunchAnswer, parseModels } from "@juspay/agent-distro/models";
import { Schema } from "effect";

/** Upstream's own two rules, read from where they are written:
 *  `isAgentModelId` — WHAT A MODEL ID IS (one word, no whitespace), the one
 *  every launch takes, so a model typed for a harness that cannot list is
 *  checked by it where it is answered; `modelLaunchWords` — THE START OF A
 *  LAUNCH THAT RUNS a model (the environment and arguments its harness takes,
 *  before anything else), so the one place a model flag is spelled is the
 *  harness's own adapter. It throws for a model that is not one word. */
export {
  isModelId as isAgentModelId,
  launchWords as modelLaunchWords,
} from "@juspay/agent-distro/models";

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

const AgentModelListSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("listed"),
    ids: Schema.Array(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("unlisted") }),
]);
export type AgentModelList = typeof AgentModelListSchema.Type;

/** One harness's answer on one host — upstream's `Models`. */
export const AgentModelsSchema = Schema.Struct({
  launch: AgentModelLaunchSchema,
  models: AgentModelListSchema,
});
export type AgentModels = typeof AgentModelsSchema.Type;

/** How one harness's launch takes a model on one host — upstream's `Launch`,
 *  `--launch`'s answer. */
export const AgentLaunchSchema = Schema.Struct({
  model: AgentModelLaunchSchema,
});
export type AgentLaunch = typeof AgentLaunchSchema.Type;

const MODELS_FLAG = "--models";
const LAUNCH_FLAG = "--launch";

/** EVERY FLAG KOLU ASKS A HOST'S PACKAGE — the package a host serves is the
 *  one kolu DELIVERED (upstream's newest published), not the one kolu was
 *  built with, so it may be older than this contract. */
export const HOST_PACKAGE_CALLS: ReadonlyArray<string> = [
  MODELS_FLAG,
  LAUNCH_FLAG,
];

/** Where a package names the flags its picker answers, one per line —
 *  upstream's `share/agent-distro/answers`. A package without it predates
 *  `--models`; one whose file lacks a flag predates that flag. */
export const PACKAGE_ANSWERS_FILE = "share/agent-distro/answers";

/** The flags in that file's text. */
export const parsePackageAnswers = (text: string): ReadonlyArray<string> =>
  text.split("\n").filter((line) => line !== "");

/** The calls of {@link HOST_PACKAGE_CALLS} a package that answers `answers`
 *  cannot take — none for a package as new as this kolu. Read off the
 *  package itself, never off a launch's error. */
export const missingPackageCalls = (
  answers: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  HOST_PACKAGE_CALLS.filter((flag) => !answers.includes(flag));

/** The arguments that make a package's `bin/agent-distro` answer for
 *  `harness`. */
export const modelsArgs = (harness: string): readonly string[] => [
  MODELS_FLAG,
  harness,
];

/** ... and how `harness`'s launch takes a model. */
export const launchArgs = (harness: string): readonly string[] => [
  LAUNCH_FLAG,
  harness,
];

/** The answer in `--models`' stdout, checked by upstream's own parser — a
 *  throw for anything out of its format, which is a format change upstream
 *  must be loud about. */
export function parseAgentModels(stdout: string): AgentModels {
  return parseModels(JSON.parse(stdout));
}

/** The answer in `--launch`'s stdout, checked by upstream's own parser — a
 *  throw for anything out of its format. */
export function parseAgentLaunch(stdout: string): AgentLaunch {
  return parseLaunchAnswer(JSON.parse(stdout));
}
