/**
 * Opt-in heap diagnostics for any kolu-family Node process — the interim
 * instrument behind the kaval heap-OOM fix
 * (`docs/atlas/src/content/atlas/kaval-heap-oom.mdx`).
 *
 * This is the single receptacle for one volatile capability: "given a process
 * and a way to count its subsystem sizes, when `KOLU_DIAG_DIR` is set, emit a
 * T+0 anchor sample, a periodic memory/counts curve, and one safe baseline
 * heapsnapshot at T+5min, with unref hygiene — paired with the V8 near-limit
 * snapshot armed by the Nix wrapper." The three genuinely host-specific axes are
 * (a) which subsystem counters climb with the leak (`extraColumns`), (b) the
 * snapshot-file basename prefix (`snapshotPrefix`), and (c) the log event-name
 * stem (`logPrefix`) — deliberately separate from the file basename so the
 * server keeps its long-standing `diag*` log contract while writing a
 * `baseline.heapsnapshot` file. Everything else — the cadence, the
 * baseline-snapshot safety reasoning, the unref hygiene, the env gate, the
 * `<logPrefix>_enabled` line — lives here ONCE, so a change to any of it is a
 * one-file edit shared by every consumer (kolu-server, kaval, any future
 * kolu-* daemon that can OOM).
 *
 * Activates ONLY when `KOLU_DIAG_DIR` is set in the process environment (the
 * Nix wrapper computes a per-invocation subdir, cds into it, and arms
 * `--heapsnapshot-near-heap-limit`). Unset = this module does nothing.
 *
 * What it does when active:
 *
 *  1. Logs one structured `<logPrefix>_enabled` line at startup with
 *     NODE_OPTIONS, diag dir, node version, pid — so a post-mortem log grep can
 *     find the heap snapshot files without guessing.
 *
 *  2. Writes one programmatic `<snapshotPrefix>.heapsnapshot` at T+5min — when
 *     the heap is still small and safe to snapshot — as a memlab "clean state"
 *     reference to diff later snapshots against.
 *
 *  3. Starts a 5-min interval logging the memory bands
 *     (rss/heapUsed/heapTotal/external/arrayBuffers) plus the caller's
 *     `extraColumns` subsystem counts, under the `<logPrefix>` event. The column
 *     that climbs monotonically alongside rss is the leak site.
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

// The structured-logging contract this module writes to is the workspace's
// single authoritative `Logger` (`@kolu/log`) — a types-only, zero-runtime,
// zero-`kolu-*` leaf, so importing it keeps `@kolu/heap-diag` a stable leaf
// while reusing the canonical type instead of re-declaring a private copy.
// kolu's pino logger and kaval's `@kolu/surface-daemon` logger are both
// assignable to it, so a host passes its logger through unchanged.
export type { Logger };

/** 5 min — cadence for the heap/counts curve. Chosen so a ~10 MB/min leak rate
 *  (the observed floor before the kaval OOM) produces ~50 MB per tick: enough
 *  resolution to see the curve, few enough rows to eyeball over a multi-hour
 *  window. The same constant for every consumer, so two timelines align when
 *  more than one process is enabled at once. */
const DIAG_INTERVAL_MS = 5 * 60 * 1000;

/** T+5min — when the safe baseline snapshot is taken. Early enough that the heap
 *  is small (a few hundred MB at most), late enough that startup transients
 *  have settled. */
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
  // Fail fast on a misconfigured dir: a RELATIVE path would silently land the
  // baseline snapshot in the process cwd (path.join keeps it relative) — the
  // wrong place, with no error. The contract (and the home-manager option) is
  // an absolute path; enforce it rather than degrade silently.
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

  // Baseline snapshot at T+5min — `writeHeapSnapshot` transiently doubles the
  // heap, so it's scheduled (not at boot) and only taken once while the heap is
  // small. Absolute path so it works even without the Nix wrapper's cd (e.g. a
  // dev shell setting KOLU_DIAG_DIR by hand). `unref` so it never keeps the
  // process alive on its own.
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

  // Periodic heap/counts curve. `unref` so the interval doesn't hold the process
  // open by itself — if it exits, the interval dies with it. Daemons serve
  // forever (systemd restart on failure), but unref is correct hygiene.
  setInterval(() => log.info(sample(), logPrefix), DIAG_INTERVAL_MS).unref();

  // One immediate T+0 sample so the log timeline has an anchor row; the interval
  // ticks again at T+5min.
  log.info(sample(), logPrefix);
}
