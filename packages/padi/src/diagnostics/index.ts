/**
 * `@kolu/padi/diagnostics` — the answer to `diagnostics.read`: why this padi is
 * slow. Always on; assembled only when asked.
 *
 * | Section | Instrument | Lives in |
 * | --- | --- | --- |
 * | children | the child meter at Node's spawn seam | `kolu-io` `child-meter.ts` |
 * | stalls | `monitorEventLoopDelay` | `./stalls.ts` |
 * | watchers | the dir+filename and working-tree registries | `kolu-io`, `kolu-git` |
 * | kernelWatches | `/proc/self/fdinfo` inotify lines | `./kernelWatches.ts` |
 * | memory | `process.memoryUsage()` | here |
 * | calls | one wrapper over the procedure table | `./calls.ts` |
 *
 * The child meter is installed once at daemon boot (`runPadiDaemon`); a read
 * from a process without it throws rather than report no children.
 */

import type {
  PadiDiagnostics,
  PadiWatcherRow,
} from "@kolu/padi-client/surface";
import { listDirWatcherRows, measured, readChildren } from "kolu-io";
import { listWorkingTreeWatcherRows } from "kolu-git";
import type { Logger } from "pino";
import { type CallsTable, createCallsTable, timeProcedures } from "./calls.ts";
import { readKernelWatches } from "./kernelWatches.ts";
import { startStallMonitor } from "./stalls.ts";

export interface PadiDiagnosticsHandle {
  /** Wrap a built procedure table so every call is timed into `calls`. */
  timeProcedures<T extends object>(procedures: T): T;
  read(): Promise<PadiDiagnostics>;
  dispose(): void;
}

function watcherRows(): PadiWatcherRow[] {
  const trees: PadiWatcherRow[] = listWorkingTreeWatcherRows().map((row) => ({
    kind: row.kind,
    root: row.repoRoot,
    askers: [...row.askers],
    state: row.state,
    directories: row.directories,
    rebuilds: row.rebuilds,
    lastInstallMs: row.lastInstallMs,
    detail: {
      kind: "tree",
      ignoredPaths: row.ignoredPaths,
      lastRebuildReason: row.lastRebuildReason,
    },
  }));
  const files: PadiWatcherRow[] = listDirWatcherRows().map((row) => ({
    kind: row.kind,
    root: row.dir,
    askers: [...row.askers],
    state: { kind: "watching" },
    directories: measured(1),
    rebuilds: 0,
    lastInstallMs: measured(row.installMs),
    detail: { kind: "file", file: row.file },
  }));
  const installMs = (row: PadiWatcherRow): number =>
    row.lastInstallMs.kind === "measured" ? row.lastInstallMs.value : -1;
  return [...trees, ...files].sort((a, b) => installMs(b) - installMs(a));
}

export function startPadiDiagnostics(log: Logger): PadiDiagnosticsHandle {
  const stalls = startStallMonitor();
  const calls: CallsTable = createCallsTable();
  return {
    timeProcedures: (procedures) => timeProcedures(procedures, calls, log),
    async read() {
      const mem = process.memoryUsage();
      return {
        process: { pid: process.pid, uptimeMs: process.uptime() * 1000 },
        memory: {
          rssBytes: mem.rss,
          heapUsedBytes: mem.heapUsed,
          heapTotalBytes: mem.heapTotal,
          externalBytes: mem.external,
          nonHeapBytes: mem.rss - mem.heapTotal,
        },
        stalls: stalls.read(),
        children: readChildren(),
        calls: calls.read(),
        watchers: { rows: watcherRows() },
        kernelWatches: await readKernelWatches(),
      };
    },
    dispose: () => stalls.stop(),
  };
}
