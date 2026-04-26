/**
 * Opt-in memory/heap diagnostics for leak debugging.
 *
 * Activates only when `KOLU_DIAG_DIR` is set in the environment (see the
 * `default.nix` wrapper, which computes a per-invocation subdir and cds
 * into it). Unset = this module does nothing.
 *
 * What it does when active:
 *
 *  1. Logs one structured "diag_enabled" line at startup with
 *     NODE_OPTIONS, diag dir, node version, cwd, argv — so a log grep
 *     post-mortem can find the heap snapshot files without guessing.
 *
 *  2. Writes one programmatic `baseline.heapsnapshot` at T+5 min — when
 *     the heap is still small and safe to snapshot. Gives memlab a
 *     "clean state" reference point to diff against later snapshots.
 *
 *  3. Starts a 5-min interval logging subsystem sizes at INFO level
 *     with msg "diag". Columns: memory bands (rss, heapUsed, external,
 *     arrayBuffers) + subsystem counts (terminals, publisherSize,
 *     claudeSessions, pendingSummaryFetches). The column that climbs
 *     monotonically alongside rss is the leak site.
 *
 * Deliberately NOT included:
 *
 *  - Periodic automatic heap snapshots during the run. Each
 *    `v8.writeHeapSnapshot()` temporarily doubles the live heap. Taking
 *    one at 3 GB would push V8 over its 4 GB default ceiling and trigger
 *    the very OOM we're trying to observe. The single baseline at T+5min
 *    is safe because the heap is small then. Pre-OOM snapshots come from
 *    V8 itself via `--heapsnapshot-near-heap-limit=3` (NODE_OPTIONS set
 *    by the wrapper). Mid-run snapshots come from `kill -USR2 <pid>` via
 *    `--heapsnapshot-signal=SIGUSR2`.
 */

import path from "node:path";
import v8 from "node:v8";
import { diagnosticResourcesSnapshot, trackDiagnosticResource } from "anyagent";
import { getPendingSummaryFetches } from "kolu-claude-code";
import type { ServerDiagnostics } from "kolu-common";
import { log } from "./log.ts";
import { publisherSize } from "./publisher.ts";
import { terminalEntries, type TerminalProcess } from "./terminal-registry.ts";
import { countActiveClaudeSessions, terminalCount } from "./terminals.ts";

/** 5 min — cadence for subsystem stats logging. Chosen so a ~10 MB/min
 *  leak rate (the observed floor before the 4 GB OOM) produces ~50 MB
 *  per tick: enough resolution to see the curve, few enough rows to
 *  eyeball over a 6 h window without drowning in noise. */
const DIAG_INTERVAL_MS = 5 * 60 * 1000;

/** T+5 min — when to capture the safe baseline snapshot. Early enough
 *  that the heap is small (a few hundred MB at most), late enough that
 *  startup transients have settled. */
const BASELINE_DELAY_MS = 5 * 60 * 1000;

/** Collect a single diagnostics sample: memory bands + subsystem counts.
 *  All values are numbers, ready for JSON logging. */
function sample(): Record<string, number> {
  const m = readMemoryUsage();
  return {
    rss: m.rss,
    heapUsed: m.heapUsed,
    heapTotal: m.heapTotal,
    external: m.external,
    arrayBuffers: m.arrayBuffers,
    terminals: terminalCount(),
    publisherSize: publisherSize(),
    claudeSessions: countActiveClaudeSessions(),
    pendingSummaryFetches: getPendingSummaryFetches(),
  };
}

function readMemoryUsage(): ServerDiagnostics["memory"] {
  const m = process.memoryUsage();
  return {
    rss: m.rss,
    heapUsed: m.heapUsed,
    heapTotal: m.heapTotal,
    external: m.external,
    arrayBuffers: m.arrayBuffers,
  };
}

export function serverDiagnosticsSnapshot(): ServerDiagnostics {
  const resources = diagnosticResourcesSnapshot();
  return {
    uptimeMs: Math.round(process.uptime() * 1000),
    memory: readMemoryUsage(),
    counts: {
      terminals: terminalCount(),
      publisherSize: publisherSize(),
      claudeSessions: countActiveClaudeSessions(),
      pendingSummaryFetches: getPendingSummaryFetches(),
      resources: resources.length,
    },
    processes: [...terminalEntries()].map(([terminalId, entry]) => ({
      terminalId,
      pid: entry.info.pid,
      cwd: entry.info.meta.cwd,
      foregroundPid: entry.handle.foregroundPid ?? null,
      foregroundProcess: safeForegroundProcess(entry) ?? null,
      agentKind: entry.info.meta.agent?.kind ?? null,
    })),
    resources,
  };
}

function safeForegroundProcess(entry: TerminalProcess): string | null {
  try {
    return entry.handle.process;
  } catch {
    return null;
  }
}

/** Start diagnostics if `KOLU_DIAG_DIR` is set. Called once from
 *  `index.ts` after the server is listening. Idempotent — early-return
 *  if the env var is missing, so calling in prod is free. */
export function startDiagnostics(): void {
  const diagDir = process.env.KOLU_DIAG_DIR;
  if (!diagDir) return;

  log.info(
    {
      diagDir,
      nodeOptions: process.env.NODE_OPTIONS,
      nodeVersion: process.version,
      cwd: process.cwd(),
      argv: process.argv,
    },
    "diag_enabled",
  );

  // Baseline snapshot at T+5 min. `writeHeapSnapshot` blocks the event
  // loop for a few seconds and transiently doubles the heap, so we
  // schedule it rather than running at startup — though startup would
  // also be safe, T+5min gives transients time to settle.
  //
  // Absolute path (not relative) so this still works if kolu is
  // started without the Nix wrapper (e.g. `KOLU_DIAG_DIR=... node
  // server/src/index.ts` from a dev shell). The wrapper normally cds
  // into $KOLU_DIAG_DIR, but we shouldn't rely on that coupling for
  // the one path we control.
  let untrackBaselineTimer = () => {};
  const baselineTimer = setTimeout(() => {
    untrackBaselineTimer();
    const snapshotPath = path.join(diagDir, "baseline.heapsnapshot");
    try {
      v8.writeHeapSnapshot(snapshotPath);
      log.info({ path: snapshotPath }, "diag_baseline_snapshot_written");
    } catch (err) {
      log.error({ err, path: snapshotPath }, "diag_baseline_snapshot_failed");
    }
  }, BASELINE_DELAY_MS);
  baselineTimer.unref();
  untrackBaselineTimer = trackDiagnosticResource({
    kind: "timer",
    label: "diagnostics baseline heap snapshot",
    owner: "server:diagnostics",
    target: diagDir,
    details: { delayMs: BASELINE_DELAY_MS },
  });

  // Periodic subsystem stats. `unref` so the interval doesn't keep the
  // process alive on its own — if the server exits, the interval dies
  // with it. The kolu process never exits cleanly in production anyway
  // (systemd restart on failure), but unref is correct hygiene.
  const sampleTimer = setInterval(() => {
    log.info(sample(), "diag");
  }, DIAG_INTERVAL_MS);
  sampleTimer.unref();
  trackDiagnosticResource({
    kind: "timer",
    label: "diagnostics sampler",
    owner: "server:diagnostics",
    target: diagDir,
    details: { intervalMs: DIAG_INTERVAL_MS },
  });

  // Emit one immediate sample so the log timeline has a T+0 row to
  // anchor the curve. The interval will tick again at T+5min.
  log.info(sample(), "diag");
}
