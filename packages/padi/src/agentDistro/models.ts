import { execFile } from "node:child_process";
import { join } from "node:path";
import { agentBinDir } from "@kolu/agent-distro/bundle";
import {
  type AgentLaunch,
  type AgentModels,
  launchArgs,
  missingPackageCalls,
  modelsArgs,
  parseAgentLaunch,
  parseAgentModels,
} from "@kolu/agent-distro/models";
import {
  agentsNotReadyWords,
  agentsTooOldWords,
} from "@kolu/agent-distro/status";
import {
  AgentLaunchUnavailable,
  AgentModelsUnavailable,
} from "@kolu/padi-client/surface";
import { Effect } from "effect";
import { cleanEnv } from "kolu-pty";
import { log } from "../log.ts";
import { terminalShellEnv } from "../ptyHost/index.ts";
import { ShellEnvUnreadable } from "../ptyHost/shellEnv.ts";
import { agentDistroSettingStore, assessAgentDistro } from "./agentDistro.ts";
import {
  AgentPackageUnreadable,
  type PackageAnswers,
  packageAnswers,
} from "./onHost.ts";

/** A harness reading a repository's `plugin.json` for the first time fetches
 *  its plugin references, as a terminal's first launch there would. */
const MODELS_TIMEOUT_MS = 120_000;

const LAUNCH_TIMEOUT_MS = 30_000;

const HERE = "this host";

const OUTPUT_CAP = 2_000;

const capOutput = (text: string): string =>
  text.length <= OUTPUT_CAP
    ? text
    : `${text.slice(0, OUTPUT_CAP)}… (${text.length} characters in all)`;

/** `harness`'s models on this host, asked from `cwd` in the environment a new
 *  terminal there gets. */
export const listAgentModels = (input: {
  readonly harness: string;
  readonly cwd: string;
}): Effect.Effect<AgentModels, unknown> =>
  Effect.gen(function* () {
    const assessed = assessAgentDistro(agentDistroSettingStore.get());
    if (assessed.kind !== "ready")
      return yield* Effect.fail(
        new AgentModelsUnavailable({
          harness: input.harness,
          why: agentsNotReadyWords(assessed, HERE),
        }),
      );
    const cannot = cannotAsk(assessed.layer.bundle);
    if (cannot !== undefined)
      return yield* Effect.fail(
        new AgentModelsUnavailable({ harness: input.harness, why: cannot }),
      );
    const env = yield* terminalShellEnv({
      cwd: input.cwd,
      agents: assessed.layer,
    }).pipe(
      Effect.mapError((err: unknown) =>
        err instanceof ShellEnvUnreadable
          ? new AgentModelsUnavailable({
              harness: input.harness,
              why: err.message,
            })
          : err,
      ),
    );
    return yield* Effect.tryPromise({
      try: () =>
        runAgentModels({
          bundle: assessed.layer.bundle,
          cwd: input.cwd,
          env,
          harness: input.harness,
        }),
      catch: (err: unknown) => err,
    });
  });

/** How `harness`'s launch takes a model on this host. */
export function agentModelLaunch(input: {
  readonly harness: string;
}): Promise<AgentLaunch> {
  const assessed = assessAgentDistro(agentDistroSettingStore.get());
  if (assessed.kind !== "ready")
    return Promise.reject(
      new AgentLaunchUnavailable({
        harness: input.harness,
        why: agentsNotReadyWords(assessed, HERE),
      }),
    );
  return runAgentLaunch({
    bundle: assessed.layer.bundle,
    harness: input.harness,
  });
}

function cannotAsk(bundle: string): string | undefined {
  let answers: PackageAnswers;
  try {
    answers = packageAnswers(bundle);
  } catch (err) {
    if (!(err instanceof AgentPackageUnreadable)) throw err;
    return err.message;
  }
  const flags = answers.kind === "answers" ? answers.flags : [];
  return missingPackageCalls(flags).length > 0
    ? agentsTooOldWords(HERE)
    : undefined;
}

function askPackage<A, E extends Error>(input: {
  readonly bundle: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly harness: string;
  readonly timeoutMs: number;
  readonly parse: (stdout: string) => A;
  readonly Unavailable: new (fields: { harness: string; why: string }) => E;
}): Promise<A> {
  const { harness, Unavailable } = input;
  const said = `agent-distro ${input.args.join(" ")}`;
  const cannot = cannotAsk(input.bundle);
  if (cannot !== undefined)
    return Promise.reject(new Unavailable({ harness, why: cannot }));
  const command = join(agentBinDir(input.bundle), "agent-distro");
  const mlog = log.child({ harness, cwd: input.cwd, args: input.args });
  const { promise, resolve, reject } = Promise.withResolvers<A>();
  execFile(
    command,
    [...input.args],
    {
      cwd: input.cwd,
      env: input.env,
      timeout: input.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    },
    (err, stdout, stderr) => {
      if (err !== null) {
        const words = capOutput(stderr.trim());
        mlog.warn({ err, stderr: words }, `${said} failed`);
        reject(
          new Unavailable({
            harness,
            why: words === "" ? `${said} failed: ${err.message}` : words,
          }),
        );
        return;
      }
      try {
        resolve(input.parse(stdout));
      } catch (parseErr) {
        mlog.error(
          { err: parseErr, stdout: capOutput(stdout) },
          `${said} printed something kolu cannot read`,
        );
        reject(
          new Unavailable({
            harness,
            why: `${said} printed something kolu cannot read: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
          }),
        );
      }
    },
  );
  return promise;
}

export function runAgentModels(input: {
  readonly bundle: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly harness: string;
}): Promise<AgentModels> {
  return askPackage({
    ...input,
    args: modelsArgs(input.harness),
    timeoutMs: MODELS_TIMEOUT_MS,
    parse: parseAgentModels,
    Unavailable: AgentModelsUnavailable,
  });
}

export function runAgentLaunch(input: {
  readonly bundle: string;
  readonly harness: string;
}): Promise<AgentLaunch> {
  const env = cleanEnv();
  return askPackage({
    ...input,
    args: launchArgs(input.harness),
    cwd: env.HOME ?? "/",
    env,
    timeoutMs: LAUNCH_TIMEOUT_MS,
    parse: parseAgentLaunch,
    Unavailable: AgentLaunchUnavailable,
  });
}
