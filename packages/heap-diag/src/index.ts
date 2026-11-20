import path from "node:path";
import v8 from "node:v8";
import type { Logger } from "@kolu/log";

export type { Logger };

const DIAG_INTERVAL_MS = 5 * 60 * 1000;

const BASELINE_DELAY_MS = 5 * 60 * 1000;

export interface HeapDiagnosticsOptions {
  /** Where the consumer writes its log lines. */
  log: Logger;
  /** The capture dir. Defaults to `process.env.KOLU_DIAG_DIR`; pass it
   *  explicitly only to test the gate. Unset/empty = this module does nothing. */
  diagDir?: string;
  /** Basename for the baseline snapshot **file** — written as
   *  `<snapshotPrefix>.heapsnapshot` (e.g. `"baseline"` →
   *  `baseline.heapsnapshot`). */
  snapshotPrefix: string;
  /** Stem for the structured-log `msg` fields: the startup line is
   *  `"<logPrefix>_enabled"`, the curve rows are `"<logPrefix>"`, and the
   *  baseline snapshot result is `"<logPrefix>_baseline_snapshot_written"` /
   *  `"_failed"`. */
  logPrefix: string;
  /** Host-specific subsystem counters, merged into every sample alongside the
   *  memory bands. Called on each tick, so it reads live state. */
  extraColumns: () => Record<string, number>;
}

function requireAbsoluteDiagDir(diagDir: string): string {
  if (!path.isAbsolute(diagDir)) {
    throw new Error(
      `heap-diag: KOLU_DIAG_DIR must be an absolute path, got ${JSON.stringify(diagDir)}`,
    );
  }
  return diagDir;
}

function logEnabled(log: Logger, logPrefix: string, diagDir: string): void {
  log.info(
    {
      diagDir,
      nodeOptions: process.env.NODE_OPTIONS,
      nodeVersion: process.version,
      pid: process.pid,
    },
    `${logPrefix}_enabled`,
  );
}

function scheduleBaselineSnapshot(
  log: Logger,
  logPrefix: string,
  diagDir: string,
  snapshotPrefix: string,
): void {
  setTimeout(() => {
    const snapshotPath = path.join(diagDir, `${snapshotPrefix}.heapsnapshot`);
    try {
      v8.writeHeapSnapshot(snapshotPath);
      log.info(
        { path: snapshotPath },
        `${logPrefix}_baseline_snapshot_written`,
      );
    } catch (err) {
      log.error(
        { err, path: snapshotPath },
        `${logPrefix}_baseline_snapshot_failed`,
      );
    }
  }, BASELINE_DELAY_MS).unref();
}

function startCurve(
  log: Logger,
  logPrefix: string,
  extraColumns: () => Record<string, number>,
): void {
  const sample = (): Record<string, number> => {
    const m = process.memoryUsage();
    return {
      rss: m.rss,
      heapUsed: m.heapUsed,
      heapTotal: m.heapTotal,
      external: m.external,
      arrayBuffers: m.arrayBuffers,
      ...extraColumns(),
    };
  };
  setInterval(() => log.info(sample(), logPrefix), DIAG_INTERVAL_MS).unref();
  log.info(sample(), logPrefix);
}

/** Starts heap diagnostics when `KOLU_DIAG_DIR` (or `opts.diagDir`) is set, and
 *  does nothing when it is not. */
export function startHeapDiagnostics(opts: HeapDiagnosticsOptions): void {
  const dir = opts.diagDir ?? process.env.KOLU_DIAG_DIR;
  if (!dir) return;
  const diagDir = requireAbsoluteDiagDir(dir);
  const { log, snapshotPrefix, logPrefix, extraColumns } = opts;

  logEnabled(log, logPrefix, diagDir);
  scheduleBaselineSnapshot(log, logPrefix, diagDir, snapshotPrefix);
  startCurve(log, logPrefix, extraColumns);
}
