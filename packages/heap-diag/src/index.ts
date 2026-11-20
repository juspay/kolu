/**
 * Deliberately NOT included: an Effect `Schedule`/fiber for the two timers
 * below. Both are `.unref()`'d, and the unref is load-bearing rather than
 * hygiene-by-habit: this module is the ONLY thing arming a timer in a
 * diag-enabled process that is otherwise ready to exit, so a ref'd timer would
 * hold a draining daemon open for up to five minutes. Effect 4's default
 * `Clock` sleeps on a plain, ref'd `setTimeout` (`effect/src/internal/effect.ts`,
 * `ClockImpl.sleepMillis`) and exposes no unref, so `Effect.sleep` /
 * `Schedule.fixed` cannot express this timer without a bespoke Clock service.
 * A diagnostics instrument is not worth inventing one for — so the cadence
 * stays on node timers, and this comment is the record of why, so the next
 * sweep does not re-litigate it.
 *
 * Deliberately NOT included: periodic automatic heap snapshots during the run.
 * Each `v8.writeHeapSnapshot()` transiently doubles the live heap; taking one
 * near the ceiling would push V8 over its limit and trigger the very OOM we are
 * trying to observe. The single baseline at T+5min is safe because the heap is
 * small then. Pre-OOM snapshots come from V8 itself via
 * `--heapsnapshot-near-heap-limit` (NODE_OPTIONS set by the wrapper); mid-run
 * snapshots come from `kill -USR2 <pid>` via `--heapsnapshot-signal=SIGUSR2`.
 */

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
   *  `<snapshotPrefix>.heapsnapshot` (e.g. `"baseline"` → `baseline.heapsnapshot`
   *  for the server, `"kaval-baseline"` for kaval). Deliberately distinct from
   *  `logPrefix`: the file naming and the log event naming are two different
   *  concerns and must not move together. */
  snapshotPrefix: string;
  /** Stem for the structured-log `msg` fields, kept separate from the snapshot
   *  file basename so each host owns its own grep/alerting contract. Events:
   *  the startup line is `"<logPrefix>_enabled"`, the curve rows are
   *  `"<logPrefix>"`, and the baseline snapshot result is
   *  `"<logPrefix>_baseline_snapshot_written"` / `"_failed"`. The server passes
   *  `"diag"` to preserve its long-standing event names; kaval passes its own. */
  logPrefix: string;
  /** The host-specific subsystem counters that climb with the leak — merged
   *  into every sample alongside the memory bands. Called on each tick, so it
   *  reads live state. */
  extraColumns: () => Record<string, number>;
}

/** Start heap diagnostics if `KOLU_DIAG_DIR` is set. Idempotent to call
 *  (early-returns when the dir is missing), so wiring it unconditionally into a
 *  daemon's boot is free in production-without-diag. */
export function startHeapDiagnostics(opts: HeapDiagnosticsOptions): void {
  const diagDir = opts.diagDir ?? process.env.KOLU_DIAG_DIR;
  if (!diagDir) return;
  if (!path.isAbsolute(diagDir)) {
    throw new Error(
      `heap-diag: KOLU_DIAG_DIR must be an absolute path, got ${JSON.stringify(diagDir)}`,
    );
  }
  const { log, snapshotPrefix, logPrefix, extraColumns } = opts;

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

  log.info(
    {
      diagDir,
      nodeOptions: process.env.NODE_OPTIONS,
      nodeVersion: process.version,
      pid: process.pid,
    },
    `${logPrefix}_enabled`,
  );

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

  setInterval(() => log.info(sample(), logPrefix), DIAG_INTERVAL_MS).unref();

  log.info(sample(), logPrefix);
}
