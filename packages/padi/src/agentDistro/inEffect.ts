/**
 * Asking agent-distro which profile is in effect — one run of a bundle's
 * `bin/agent-distro --list --json` in a directory and an environment. Upstream
 * resolves the profile (a repository's own `agent-distro.nix`, then
 * `AI_PROFILE`, then the built-in); this module only runs it and reads the
 * answer (`@kolu/agent-distro/inEffect`). Its volatility is that invocation.
 * Two askers:
 *
 *   - a terminal that got agents, once, after it started, in its cwd and spawn
 *     environment ({@link probeProfileInEffect}). It never blocks a spawn and
 *     never fails one: every failure is logged and answers `undefined`;
 *   - the setting, once, from `$HOME` rather than any terminal's folder, with
 *     its profile as `AI_PROFILE` ({@link resolveProfileOnHost}): whether it
 *     resolves at all, and agent-distro's own words when it does not.
 */

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentBinDir } from "@kolu/agent-distro/bundle";
import {
  LIST_JSON_ARGS,
  type ProfileInEffect,
  parseProfileInEffect,
} from "@kolu/agent-distro/inEffect";
import type { AgentDistroResolved } from "@kolu/agent-distro/schema";
import { log } from "../log.ts";
import { AI_PROFILE_ENV } from "./bake.ts";

/** Resolving a reference may fetch it (`nix flake prefetch`) the first time. */
const PROBE_TIMEOUT_MS = 120_000;

/** One run's answer: the profile in effect (`undefined` from a bundle that
 *  names none), or why there is none — the run failed (with its stderr), or
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
        plog.info(
          "agent-distro --list --json names no profile in effect (a bundle older than profile references)",
        );
      return answer.effective;
    case "failed":
      plog.warn(
        { err: answer.err, stderr: answer.stderr.trim() },
        "agent-distro --list --json failed; the pill names the setting's profile",
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

/** Does `profile` resolve on this host — asked of `bundle`'s agent-distro
 *  from `$HOME`, with `profile` as `AI_PROFILE` and padi's own environment
 *  otherwise (its PATH reaches `nix`, which a reference's fetch needs). Never
 *  throws: a failure is the answer, in agent-distro's own words. */
export async function resolveProfileOnHost(args: {
  readonly bundle: string;
  readonly profile: string;
}): Promise<Exclude<AgentDistroResolved, { kind: "none" | "pending" }>> {
  const { profile } = args;
  const answer = await runListJson({
    bundle: args.bundle,
    cwd: homedir(),
    env: { ...process.env, [AI_PROFILE_ENV]: profile },
  });
  const failed = (message: string) =>
    ({ kind: "failed", profile, message }) as const;
  switch (answer.kind) {
    case "answered":
      return answer.effective === undefined
        ? failed("this agent-distro does not say which profile is in effect")
        : {
            kind: "resolved",
            profile,
            name: answer.effective.name,
            description: answer.effective.description,
          };
    case "failed":
      log.info(
        { err: answer.err, profile },
        "agent-distro could not resolve the Agents profile",
      );
      // agent-distro's words as it wrote them, on one line.
      return failed(
        answer.stderr
          .trim()
          .split(/\s*\n\s*/)
          .join(" ") || answer.err.message,
      );
    case "unreadable":
      return failed(
        `agent-distro --list --json printed something kolu cannot read: ${answer.err instanceof Error ? answer.err.message : String(answer.err)}`,
      );
    default:
      return answer satisfies never;
  }
}
