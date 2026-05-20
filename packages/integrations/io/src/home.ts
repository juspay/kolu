/**
 * `resolveExecutorHome` — return `$HOME` on the executor's backend.
 *
 * Higher-level packages (kolu-claude-code, kolu-codex, kolu-opencode)
 * each need to resolve agent-specific paths under `$HOME` on whichever
 * machine the executor is backing. Each was inlining the same
 * `executor.exec("printenv", ["HOME"])` + trim + null-on-error dance —
 * a `kolu-io` primitive removes the multiplication.
 *
 * Returns `null` on any failure (transport error, empty output, missing
 * `printenv`). Callers degrade to "agent not present on this executor",
 * which is the same path a fresh local machine takes today.
 */

import type { Executor } from "./executor.ts";

export interface HomeLogger {
  debug: (obj: Record<string, unknown>, msg: string) => void;
}

export async function resolveExecutorHome(
  executor: Executor,
  log?: HomeLogger,
): Promise<string | null> {
  try {
    const r = await executor.exec("printenv", ["HOME"], { timeoutMs: 5_000 });
    if (r.exitCode !== 0) {
      log?.debug(
        { stderr: r.stderr },
        "resolveExecutorHome: printenv HOME exited non-zero",
      );
      return null;
    }
    const home = r.stdout.trim();
    return home.length > 0 ? home : null;
  } catch (err) {
    log?.debug({ err }, "resolveExecutorHome failed");
    return null;
  }
}
