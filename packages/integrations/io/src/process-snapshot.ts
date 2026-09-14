/** Process-snapshot IO — the argv + environment a live pid was STARTED with.
 *
 *  Domain-agnostic: nothing here knows why a caller wants a process's argv or
 *  env, only that both live in the kernel and are readable for a live pid on
 *  some platforms. Two agent integrations need the identical answer (`pi`'s
 *  session-store redirects, `omp`'s agent-dir/profile chain) and neither may
 *  depend on the other, so the one implementation lives here rather than
 *  twice — a second copy of process introspection is a second source of truth
 *  for the same /proc format.
 *
 *  Linux reads `/proc/<pid>` (argv AND env); Darwin reads the argv from `ps`
 *  but the env map comes back EMPTY — modern macOS redacts even same-user
 *  environments (see the Darwin branch below), so a config-env redirect is
 *  unrecoverable there. Any failure — an exited process (routine), a hidden
 *  proc (a `hidepid` host), an unsupported platform — yields null and the
 *  caller resolves its own default; those are genuinely unknowable overrides,
 *  not errors to surface. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { Logger } from "@kolu/log";

export interface ProcessSnapshot {
  argv: string[];
  /** The process's environment, or `null` when this platform cannot report it
   *  (macOS redacts even a same-user process's env — see below). `null` and
   *  `{}` are DIFFERENT facts: "unreadable by policy" vs "started with no
   *  environment", and a consumer that resolves paths from env vars must know
   *  which one it is holding. */
  env: Record<string, string> | null;
}

/** The live process's argv + environment — the one place a launched agent
 *  invocation's flags and env vars genuinely live. */
export function readProcessSnapshot(
  pid: number,
  log?: Logger,
): ProcessSnapshot | null {
  try {
    if (process.platform === "linux") {
      const argv = fs
        .readFileSync(`/proc/${pid}/cmdline`, "utf8")
        .split("\0")
        .filter((s) => s.length > 0);
      const env: Record<string, string> = {};
      for (const pair of fs
        .readFileSync(`/proc/${pid}/environ`, "utf8")
        .split("\0")) {
        const eq = pair.indexOf("=");
        if (eq > 0) env[pair.slice(0, eq)] = pair.slice(eq + 1);
      }
      return { argv, env };
    }
    if (process.platform === "darwin") {
      // Modern macOS (>=10.13) redacts even a SAME-USER process's
      // environment from ps: `-E` is accepted but prints the command line
      // only (verified live on a macOS 15 host — the env row simply does
      // not appear). So `env` here is null by OS policy, not empty: an
      // env-var redirect is a permanent Darwin blind spot, while argv stays
      // the full command line and every flag-only override still resolves.
      const out = execFileSync(
        "ps",
        ["-ww", "-p", String(pid), "-o", "command="],
        { encoding: "utf8" },
      ).trim();
      const argv = out.split(/\s+/).filter((s) => s.length > 0);
      if (argv.length === 0) return null;
      return { argv, env: null };
    }
    return null;
  } catch (err) {
    log?.debug({ err, pid }, "process snapshot unavailable");
    return null;
  }
}
