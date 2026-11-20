import fs from "node:fs";
import type { Logger } from "@kolu/log";
import { bakedOsFactsBin, snapshotPidsSync } from "osfacts-client";
import { meterSyncChild } from "./child-meter.ts";
import type { ProcessSnapshot } from "./types.ts";

export type { ProcessSnapshot };

const OSFACTS_BIN =
  process.platform === "darwin" ? bakedOsFactsBin("KOLU_OSFACTS_BIN") : null;

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
    if (process.platform === "darwin" && OSFACTS_BIN !== null) {
      // macOS redacts even a same-user process's environment, so `env` is
      // null by OS policy, not empty.
      const reading = meterSyncChild(["osfacts", "snapshot"], () =>
        snapshotPidsSync(OSFACTS_BIN, [pid], { argv: true }),
      );
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
