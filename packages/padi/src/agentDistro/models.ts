/**
 * WHICH MODELS A HARNESS OFFERS ON THIS HOST — one run of the serving
 * package's `bin/agent-distro --models <harness>` (`@kolu/agent-distro/models`),
 * in the directory a role will start in and with the profiles a terminal
 * spawned here now would get, so the profile in effect decides the providers
 * exactly as it would for that launch. Upstream's harness adapter knows how to
 * list and how a launch takes a model; this module only runs it and reads the
 * answer. Its volatility is that invocation.
 *
 * Two answers and one refusal, never folded into each other: the ids the
 * harness listed (possibly none), `unlisted` for a harness with no list
 * command, or {@link AgentModelsUnavailable} — the host's agents are not ready
 * (in the same words the setup form refuses with), or the list command failed
 * or printed something kolu cannot read, in its own words.
 */

import { execFile } from "node:child_process";
import { join } from "node:path";
import { agentBinDir } from "@kolu/agent-distro/bundle";
import {
  type AgentModels,
  missingPackageCalls,
  modelsArgs,
  parseAgentModels,
} from "@kolu/agent-distro/models";
import {
  agentsNotReadyWords,
  agentsTooOldWords,
} from "@kolu/agent-distro/status";
import { AgentModelsUnavailable } from "@kolu/padi-client/surface";
import { cleanEnv } from "kolu-pty";
import { log } from "../log.ts";
import { agentDistroSettingStore, assessAgentDistro } from "./agentDistro.ts";
import { packageAnswers } from "./onHost.ts";
import { AGENT_DISTRO_PLUGINS_ENV, AI_PROFILE_ENV } from "./bake.ts";
import type { AgentLayer } from "./layer.ts";

/** A harness reading a repository's `plugin.json` for the first time fetches
 *  its plugin references, as a terminal's first launch there would. */
const MODELS_TIMEOUT_MS = 120_000;

/** How this host is named in its own refusal: padi does not know what the
 *  person calls it, and the asker does. */
const HERE = "this host";

/** The environment a new terminal here gets from its agent layer, over the
 *  clean base every spawn starts from (`ptyHost`'s `composeSpawnInput`): the
 *  plugin dir and the built profiles, which is all a launcher reads. */
function layerEnv(layer: AgentLayer): Record<string, string> {
  const env = cleanEnv();
  env[AGENT_DISTRO_PLUGINS_ENV] = layer.plugins;
  if (layer.profiles.length > 0)
    env[AI_PROFILE_ENV] = layer.profiles.map((p) => p.path).join(" ");
  return env;
}

/** `harness`'s models on this host, asked from `cwd`. */
export function listAgentModels(input: {
  readonly harness: string;
  readonly cwd: string;
}): Promise<AgentModels> {
  const assessed = assessAgentDistro(agentDistroSettingStore.get());
  if (assessed.kind !== "ready")
    return Promise.reject(
      new AgentModelsUnavailable({
        harness: input.harness,
        why: agentsNotReadyWords(assessed, HERE),
      }),
    );
  return runAgentModels({
    bundle: assessed.layer.bundle,
    cwd: input.cwd,
    env: layerEnv(assessed.layer),
    harness: input.harness,
  });
}

/** ONE RUN of `bundle`'s `agent-distro --models <harness>` in `cwd` with
 *  `env` — upstream's answer, or {@link AgentModelsUnavailable} with the words
 *  the run failed in. A package that does not answer `--models` (it says so
 *  itself, {@link packageAnswers}) is never run: it is older than this kolu,
 *  and its picker would take the flag for a launch. The invocation, apart from
 *  the readiness that decides which package and which environment, so it can
 *  be run against any package — a stand-in (`@kolu/agent-distro/testing`'s
 *  `standInModels`) or a real one. */
export function runAgentModels(input: {
  readonly bundle: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly harness: string;
}): Promise<AgentModels> {
  if (missingPackageCalls(packageAnswers(input.bundle)).length > 0)
    return Promise.reject(
      new AgentModelsUnavailable({
        harness: input.harness,
        why: agentsTooOldWords(HERE),
      }),
    );
  const command = join(agentBinDir(input.bundle), "agent-distro");
  const mlog = log.child({ harness: input.harness, cwd: input.cwd });
  const { promise, resolve, reject } = Promise.withResolvers<AgentModels>();
  execFile(
    command,
    [...modelsArgs(input.harness)],
    {
      cwd: input.cwd,
      env: input.env,
      timeout: MODELS_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    },
    (err, stdout, stderr) => {
      if (err !== null) {
        const said = stderr.trim();
        mlog.warn(
          { err, stderr: said },
          "agent-distro --models failed; the setup form shows its words",
        );
        reject(
          new AgentModelsUnavailable({
            harness: input.harness,
            why:
              said === ""
                ? `${input.harness} could not list its models: ${err.message}`
                : said,
          }),
        );
        return;
      }
      try {
        resolve(parseAgentModels(stdout));
      } catch (parseErr) {
        mlog.error(
          { err: parseErr, stdout },
          "agent-distro --models printed something kolu cannot read",
        );
        reject(
          new AgentModelsUnavailable({
            harness: input.harness,
            why: `agent-distro --models ${input.harness} printed something kolu cannot read: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
          }),
        );
      }
    },
  );
  return promise;
}
