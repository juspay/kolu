/**
 * WHAT A HARNESS ON THIS HOST SAYS ABOUT MODELS — two runs of the serving
 * package's picker (`@kolu/agent-distro/models`), for two questions that fail
 * differently:
 *
 *  - WHICH MODELS IT OFFERS (`agent-distro --models <harness>`), asked in the
 *    directory a role will start in and in THE ENVIRONMENT A NEW TERMINAL
 *    THERE ENDS UP WITH — its own spawn, after the person's shell has read
 *    their dotfiles (`ptyHost`'s `terminalShellEnv`). A launch in a kolu
 *    terminal sees what an rc file exports (an API key, a gateway URL), so the
 *    question about that launch does too. Two answers and one refusal, never
 *    folded into each other: the ids the harness listed (possibly none),
 *    `unlisted` for a harness with no list command, or
 *    {@link AgentModelsUnavailable} — the host's agents are not ready (in the
 *    same words the setup form refuses with), the shell could not be asked,
 *    or the list command failed or printed something kolu cannot read, in its
 *    own words.
 *  - HOW A LAUNCH TAKES ONE (`agent-distro --launch <harness>`), which reads
 *    the harness's adapter and runs nothing, so it answers wherever the
 *    package is installed. A start reads only this, so starting a role never
 *    depends on a list that may be failing today.
 *
 * Upstream's adapter knows how to list and how a launch takes a model; this
 * module only runs the picker and reads the answer. Its volatility is that
 * invocation.
 */

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
import { AgentPackageUnreadable, packageAnswers } from "./onHost.ts";

/** A harness reading a repository's `plugin.json` for the first time fetches
 *  its plugin references, as a terminal's first launch there would. */
const MODELS_TIMEOUT_MS = 120_000;

/** `--launch` reads one file; anything slower than this is a broken package. */
const LAUNCH_TIMEOUT_MS = 30_000;

/** How this host is named in its own refusal: padi does not know what the
 *  person calls it, and the asker does. */
const HERE = "this host";

/** THE MOST OF A RUN'S OWN OUTPUT KOLU KEEPS — in the daemon's log and in the
 *  words a refusal carries. The run holds the environment the person's
 *  dotfiles built, so its output can hold their keys; a megabyte of it in a
 *  log file that outlives the question is a leak with no reader. */
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
    // A package that cannot be asked is never run — nor is the shell asked
    // for an environment nothing will use.
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

/** WHY `bundle`'s picker cannot be asked at all, in the words a refusal
 *  carries — `undefined` when it can. Two readings, never one: a package that
 *  does not answer every call this kolu makes is OLD (its picker would take
 *  the flag for a launch, so it is never run), and one whose answers file is
 *  there and names nothing is BROKEN ({@link AgentPackageUnreadable}) — only
 *  the first is something a person waits out. */
function cannotAsk(bundle: string): string | undefined {
  let answers: ReadonlyArray<string>;
  try {
    answers = packageAnswers(bundle);
  } catch (err) {
    if (!(err instanceof AgentPackageUnreadable)) throw err;
    return err.message;
  }
  return missingPackageCalls(answers).length > 0
    ? agentsTooOldWords(HERE)
    : undefined;
}

/** ONE RUN of `bundle`'s picker with `args` — its answer, read by `parse`, or
 *  `Unavailable` with the words the run failed in. */
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

/** ONE RUN of `bundle`'s `agent-distro --models <harness>` in `cwd` with
 *  `env` — upstream's answer, or {@link AgentModelsUnavailable} with the words
 *  the run failed in. A package that does not answer every call this kolu
 *  makes is never run. The invocation, apart from the readiness and the
 *  environment that decide which package and how it runs, so it can be run
 *  against any package — a stand-in (`@kolu/agent-distro/testing`'s
 *  `standInModels`) or a real one. */
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

/** ONE RUN of `bundle`'s `agent-distro --launch <harness>` — how a launch
 *  takes a model, or {@link AgentLaunchUnavailable}. It runs no harness, so it
 *  needs no repository and no shell's environment: the clean base every spawn
 *  starts from. */
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
