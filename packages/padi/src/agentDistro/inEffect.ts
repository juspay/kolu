/**
 * Asking agent-distro which profile is in effect — one run of the package's
 * `bin/agent-distro --list --json` in a terminal's cwd and spawn environment,
 * once, after it started. Upstream composes the profile (a repository's own
 * `agent-distro.nix` over the `AI_PROFILE` stack of built profiles, which it
 * reads without fetching anything); this module only runs it and reads the
 * answer (`@kolu/agent-distro/inEffect`). Its volatility is that invocation.
 * It never blocks a spawn and never fails one: every failure is logged and
 * answers `undefined`.
 */

import { execFile } from "node:child_process";
import { join } from "node:path";
import { agentBinDir } from "@kolu/agent-distro/bundle";
import {
  LIST_JSON_ARGS,
  type ProfileInEffect,
  parseProfileInEffect,
} from "@kolu/agent-distro/inEffect";
import { log } from "../log.ts";

/** A repository's own `agent-distro.nix` is evaluated (and its plugin
 *  references fetched) the first time a terminal opens in it. */
const PROBE_TIMEOUT_MS = 120_000;

/** One run's answer: the profile in effect (`undefined` when none is), or why there is none — the run failed (with its stderr), or
 *  printed something kolu cannot read. */
type ListJsonAnswer =
  | {
      readonly kind: "answered";
      readonly effective: ProfileInEffect | undefined;
    }
  | { readonly kind: "failed"; readonly err: Error; readonly stderr: string }
  | { readonly kind: "unreadable"; readonly err: unknown };

function runListJson(args: {
  readonly bundle: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}): Promise<ListJsonAnswer> {
  const command = join(agentBinDir(args.bundle), "agent-distro");
  return new Promise((resolve) => {
    execFile(
      command,
      [...LIST_JSON_ARGS],
      { cwd: args.cwd, env: args.env, timeout: PROBE_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (err !== null) {
          resolve({ kind: "failed", err, stderr });
          return;
        }
        try {
          resolve({
            kind: "answered",
            effective: parseProfileInEffect(stdout),
          });
        } catch (parseErr) {
          resolve({ kind: "unreadable", err: parseErr });
        }
      },
    );
  });
}

/** The profile in effect for a terminal on `bundle`, started in `cwd` with
 *  `env` — or `undefined` when agent-distro could not say (logged). */
export async function probeProfileInEffect(args: {
  readonly bundle: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly terminal: string;
}): Promise<ProfileInEffect | undefined> {
  const plog = log.child({ terminal: args.terminal, bundle: args.bundle });
  const answer = await runListJson(args);
  switch (answer.kind) {
    case "answered":
      if (answer.effective === undefined)
        plog.info("agent-distro --list --json names no profile in effect");
      return answer.effective;
    case "failed":
      plog.warn(
        { err: answer.err, stderr: answer.stderr.trim() },
        "agent-distro --list --json failed; the pill names the delivered profiles",
      );
      return undefined;
    case "unreadable":
      plog.warn(
        { err: answer.err },
        "agent-distro --list --json printed something kolu cannot read",
      );
      return undefined;
    default:
      return answer satisfies never;
  }
}
