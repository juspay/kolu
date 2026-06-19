/**
 * Opt-in heap diagnostics for the kaval daemon — the interim instrument behind
 * the kaval heap-OOM fix (`docs/atlas/src/content/atlas/kaval-heap-oom.mdx`).
 *
 * kaval is the process that OOMs (a per-live-terminal headless mirror × an
 * unbounded, never-reaped terminal population), yet historically only the
 * kolu-server was instrumented. This activates ONLY when `KOLU_DIAG_DIR` is set
 * in kaval's environment (forwarded by the server's `localDriver` and turned
 * into a kaval-private subdir by kaval's nix wrapper, which also arms
 * `--heapsnapshot-near-heap-limit`). Unset = this module does nothing.
 *
 * When active it logs one `kaval_diag` line every 5 min with the memory bands
 * (rss/heapUsed/heapTotal/external/arrayBuffers) AND the live-terminal count —
 * the leak's independent variable — so a log grep shows the curve climbing with
 * terminal count over days. It also writes one safe `kaval-baseline.heapsnapshot`
 * at T+5min (heap still small) as a memlab diff reference; the pre-OOM snapshot
 * comes from V8 itself via the wrapper's `--heapsnapshot-near-heap-limit`.
 */

import path from "node:path";
import v8 from "node:v8";
import type { Logger } from "@kolu/surface-daemon";

/** 5 min — cadence for the heap/terms curve. Matches the server's diagnostics
 *  so the two timelines align when both are enabled. */
const DIAG_INTERVAL_MS = 5 * 60 * 1000;

/** T+5min — when the safe baseline snapshot is taken (heap still small). */
const BASELINE_DELAY_MS = 5 * 60 * 1000;

/** Start kaval diagnostics if `KOLU_DIAG_DIR` is set in the environment.
 *  Idempotent to call (early-returns when the env var is missing), so wiring it
 *  unconditionally into the daemon boot is free in production-without-diag. */
export function startKavalDiagnostics(opts: {
  log: Logger;
  /** Live-PTY count — the column that climbs with the leak. */
  terminalCount: () => number;
}): void {
  const diagDir = process.env.KOLU_DIAG_DIR;
  if (!diagDir) return;
  const { log, terminalCount } = opts;

  const sample = (): Record<string, number> => {
    const m = process.memoryUsage();
    return {
      rss: m.rss,
      heapUsed: m.heapUsed,
      heapTotal: m.heapTotal,
      external: m.external,
      arrayBuffers: m.arrayBuffers,
      terminals: terminalCount(),
    };
  };

  log.info(
    {
      diagDir,
      nodeOptions: process.env.NODE_OPTIONS,
      nodeVersion: process.version,
      pid: process.pid,
    },
    "kaval_diag_enabled",
  );

  // Baseline snapshot at T+5min — `writeHeapSnapshot` transiently doubles the
  // heap, so it's scheduled (not at boot) and only taken once while the heap is
  // small. `unref` so it never keeps the daemon alive on its own.
  setTimeout(() => {
    const snapshotPath = path.join(diagDir, "kaval-baseline.heapsnapshot");
    try {
      v8.writeHeapSnapshot(snapshotPath);
      log.info({ path: snapshotPath }, "kaval_diag_baseline_snapshot_written");
    } catch (err) {
      log.error(
        { err, path: snapshotPath },
        "kaval_diag_baseline_snapshot_failed",
      );
    }
  }, BASELINE_DELAY_MS).unref();

  // Periodic heap/terms curve. `unref` so the interval doesn't hold the daemon
  // open by itself (it serves `forever`, but unref is correct hygiene).
  setInterval(() => log.info(sample(), "kaval_diag"), DIAG_INTERVAL_MS).unref();

  // One immediate T+0 sample so the timeline has an anchor row.
  log.info(sample(), "kaval_diag");
}
