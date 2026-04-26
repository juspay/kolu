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
import { getPendingSummaryFetches } from "kolu-claude-code";
import { AgentKindSchema, type ServerDiagnostics } from "kolu-common";
import { getResources } from "kolu-runtime-diagnostics";
import { log } from "./log.ts";
import { installedActivations } from "./meta/agent.ts";
import { publisherSize } from "./publisher.ts";
import { type TerminalProcess, terminalEntries } from "./terminal-registry.ts";

/** 5 min — cadence for subsystem stats logging. Chosen so a ~10 MB/min
 *  leak rate (the observed floor before the 4 GB OOM) produces ~50 MB
 *  per tick: enough resolution to see the curve, few enough rows to
 *  eyeball over a 6 h window without drowning in noise. */
const DIAG_INTERVAL_MS = 5 * 60 * 1000;

/** T+5 min — when to capture the safe baseline snapshot. Early enough
 *  that the heap is small (a few hundred MB at most), late enough that
 *  startup transients have settled. */
const BASELINE_DELAY_MS = 5 * 60 * 1000;

/** Single sealed read of every live counter both the periodic-log
 *  `sample()` and the on-demand `getServerDiagnostics()` consume. Adding
 *  a new metric (e.g. file descriptor count) is one edit here, propagating
 *  to both consumers — the previous duplication had no structural fence
 *  to keep them in sync.
 *
 *  Counts come from one pass over `terminalEntries()` without retaining
 *  the entries array, so the long-lived 5-min log path stays
 *  allocation-free. */
interface MetricsCapture {
  memory: NodeJS.MemoryUsage;
  terminals: number;
  claudeSessions: number;
  publisherChannels: number;
  pendingSummaryFetches: number;
}

function captureMetrics(): MetricsCapture {
  let terminals = 0;
  let claudeSessions = 0;
  for (const [, entry] of terminalEntries()) {
    terminals++;
    if (entry.info.meta.agent?.kind === "claude-code") claudeSessions++;
  }
  return {
    memory: process.memoryUsage(),
    terminals,
    claudeSessions,
    publisherChannels: publisherSize(),
    pendingSummaryFetches: getPendingSummaryFetches(),
  };
}

/** Foreground binary basename — `entry.handle.process` is a kernel
 *  syscall on darwin (sysctl) and can throw if node-pty has terminated
 *  the process. Swallow the throw so a transient failure on one terminal
 *  doesn't break the whole diagnostics snapshot. */
function safeForegroundProcess(entry: TerminalProcess): string | null {
  try {
    const proc = entry.handle.process;
    return proc ? path.basename(proc) : null;
  } catch {
    return null;
  }
}

/** Snapshot for the client-facing Diagnostic info dialog (Debug → Diagnostic
 *  info). Combines `process.*` introspection, the runtime-diagnostics
 *  registry (every fs.watch / timer / subscription handle), per-PTY
 *  process state, and agent external-change activations.
 *
 *  The registry is the single source of truth for "what handles is the
 *  server holding"; this aggregator just reads it and packages the
 *  result for the wire — no per-integration knowledge lives here. */
export function getServerDiagnostics(): ServerDiagnostics {
  const memory = process.memoryUsage();

  const cwdById = new Map<string, string>();
  const processes: ServerDiagnostics["processes"] = [];
  for (const [terminalId, entry] of terminalEntries()) {
    const meta = entry.info.meta;
    cwdById.set(terminalId, meta.cwd);
    processes.push({
      terminalId,
      pid: entry.info.pid,
      cwd: meta.cwd,
      foregroundPid: entry.handle.foregroundPid ?? null,
      foregroundProcess: safeForegroundProcess(entry),
      agentKind: meta.agent?.kind ?? null,
    });
  }

  const activations: ServerDiagnostics["activations"] = [];
  for (const a of installedActivations()) {
    // Filter at the boundary — the activation map's `kind` is a free
    // string, and the wire schema constrains it to AgentKind. Unknown
    // kinds (a hypothetical future provider) just don't show up; not
    // worth a runtime error in the diagnostics path.
    const parsed = AgentKindSchema.safeParse(a.kind);
    if (!parsed.success) continue;
    activations.push({
      kind: parsed.data,
      // The `?? "?"` defends against a teardown race that the current
      // cleanup ordering (stopProviders before unregisterTerminal)
      // makes unreachable.
      terminals: a.terminalIds.map((id) => ({
        id,
        cwd: cwdById.get(id) ?? "?",
      })),
    });
  }

  return {
    sampledAt: Date.now(),
    uptimeMs: Math.round(process.uptime() * 1000),
    nodeVersion: process.version,
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
    },
    subsystems: {
      publisherChannels: publisherSize(),
      pendingSummaryFetches: getPendingSummaryFetches(),
    },
    resources: getResources(),
    processes,
    activations,
  };
}

/** Collect a single diagnostics sample: memory bands + subsystem counts.
 *  All values are numbers, ready for JSON logging. */
function sample(): Record<string, number> {
  const m = captureMetrics();
  return {
    rss: m.memory.rss,
    heapUsed: m.memory.heapUsed,
    heapTotal: m.memory.heapTotal,
    external: m.memory.external,
    arrayBuffers: m.memory.arrayBuffers,
    terminals: m.terminals,
    publisherSize: m.publisherChannels,
    claudeSessions: m.claudeSessions,
    pendingSummaryFetches: m.pendingSummaryFetches,
  };
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
  setTimeout(() => {
    const snapshotPath = path.join(diagDir, "baseline.heapsnapshot");
    try {
      v8.writeHeapSnapshot(snapshotPath);
      log.info({ path: snapshotPath }, "diag_baseline_snapshot_written");
    } catch (err) {
      log.error({ err, path: snapshotPath }, "diag_baseline_snapshot_failed");
    }
  }, BASELINE_DELAY_MS).unref();

  // Periodic subsystem stats. `unref` so the interval doesn't keep the
  // process alive on its own — if the server exits, the interval dies
  // with it. The kolu process never exits cleanly in production anyway
  // (systemd restart on failure), but unref is correct hygiene.
  setInterval(() => {
    log.info(sample(), "diag");
  }, DIAG_INTERVAL_MS).unref();

  // Emit one immediate sample so the log timeline has a T+0 row to
  // anchor the curve. The interval will tick again at T+5min.
  log.info(sample(), "diag");
}
