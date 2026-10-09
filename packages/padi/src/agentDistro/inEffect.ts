/**
 * Asking agent-distro which profile is in effect in a terminal — one run of its
 * bundle's `bin/agent-distro --list --json` in the terminal's cwd and spawn
 * environment, after the terminal started. Upstream resolves the profile
 * (a repository's own `agent-distro.nix`, then `AI_PROFILE`, then the built-in);
 * this module only runs it and reads the answer
 * (`@kolu/agent-distro/inEffect`). Its volatility is that invocation.
 *
 * It never blocks a spawn and never fails one: every failure (the command
 * missing, a non-zero exit, a timeout, output out of upstream's format) is
 * logged and answers `undefined`, as does a bundle that predates the field.
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

/** Resolving a reference may fetch it (`nix flake prefetch`) the first time. */
const PROBE_TIMEOUT_MS = 120_000;

/** The profile in effect for a terminal on `bundle`, started in `cwd` with
 *  `env` — or `undefined` when agent-distro could not say (logged). */
export function probeProfileInEffect(args: {
  readonly bundle: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly terminal: string;
}): Promise<ProfileInEffect | undefined> {
  const command = join(agentBinDir(args.bundle), "agent-distro");
  const plog = log.child({ terminal: args.terminal, command });
  return new Promise((resolve) => {
    execFile(
      command,
      [...LIST_JSON_ARGS],
      { cwd: args.cwd, env: args.env, timeout: PROBE_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (err !== null) {
          plog.warn(
            { err, stderr: stderr.trim() },
            "agent-distro --list --json failed; the pill names the setting's profile",
          );
          resolve(undefined);
          return;
        }
        try {
          const effective = parseProfileInEffect(stdout);
          if (effective === undefined)
            plog.info(
              "agent-distro --list --json names no profile in effect (a bundle older than profile references)",
            );
          resolve(effective);
        } catch (parseErr) {
          plog.warn(
            { err: parseErr },
            "agent-distro --list --json printed something kolu cannot read",
          );
          resolve(undefined);
        }
      },
    );
  });
}
