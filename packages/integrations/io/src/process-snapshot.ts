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
 *  Linux reads `/proc/<pid>` (argv AND env, one cheap read each). Darwin reads
 *  the argv through the BAKED `osfacts` binary (`snapshot --pids <pid> --argv`,
 *  KERN_PROCARGS2) — exact tokens. It does NOT use `ps -o command=`: that
 *  prints ONE string and every consumer then has to whitespace-split it, which
 *  is not invertible (`--settings '{"a": 1}'` becomes three tokens, verified
 *  on macOS 26.5) and would hand the stable-flag filter fragments of a value
 *  instead of the value. The env comes back `null` on Darwin — modern macOS
 *  redacts even same-user environments, and osfacts has no env facet — an
 *  unreadable environment, NOT an empty map (a config-env redirect is a
 *  permanent Darwin blind spot, while every flag-only override resolves).
 *
 *  Any failure READ — an exited process (routine), a hidden proc (a `hidepid`
 *  host), an unsupported platform — yields null and the caller
 *  resolves its own default; those are genuinely unknowable, not errors. An
 *  UNBAKED `KOLU_OSFACTS_BIN`, by contrast, is a packaging defect: it is
 *  resolved OUTSIDE the forgiveness below, so the process crashes loudly instead
 *  of silently losing every restored flag. */

import fs from "node:fs";
import type { Logger } from "@kolu/log";
import { bakedOsFactsBin, snapshotPidsSync } from "osfacts-client";
import type { ProcessSnapshot } from "./types.ts";

export type { ProcessSnapshot };

/** The live process's argv + environment — the one place a launched agent
 *  invocation's flags and env vars genuinely live. */
export function readProcessSnapshot(
  pid: number,
  log?: Logger,
): ProcessSnapshot | null {
  // The bake is resolved OUTSIDE the forgiving read: a missing `KOLU_OSFACTS_BIN`
  // is a packaging defect that would silently cost every restored flag on this
  // host (and, because failures are not cached, re-spawn once per scrape tick).
  // Every other osfacts caller keeps the bake loud the same way.
  const osfactsBin =
    process.platform === "darwin" ? bakedOsFactsBin("KOLU_OSFACTS_BIN") : null;
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
    if (process.platform === "darwin" && osfactsBin !== null) {
      // Exact argv tokens from the OS (KERN_PROCARGS2). `env` is null by OS
      // policy, not empty: macOS redacts even a same-user process's environment,
      // and osfacts has no env facet.
      const reading = snapshotPidsSync(osfactsBin, [pid], { argv: true });
      const row = reading.argv.find((r) => r.pid === pid);
      if (row === undefined || row.argv.length === 0) return null;
      return { argv: row.argv, env: null };
    }
    return null;
  } catch (err) {
    log?.debug({ err, pid }, "process snapshot unavailable");
    return null;
  }
}
