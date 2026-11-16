/**
 * `diagnostics.read` — what padi answers when asked why it is slow.
 *
 * Browser-safe schemas only (no `node:` imports), re-exported from
 * `./surface.ts` the way `./chromeVocab.ts` is, so every face reads them as
 * `@kolu/padi-client/surface`.
 *
 * Two shapes recur and are spelled once each:
 *   - {@link measuredSchema} — a number that was measured, or WHY it was not.
 *     No field here is optional, nullable or zero to mean "unknown";
 *   - {@link TimingSummarySchema} — median, 99th percentile, worst and sum in
 *     milliseconds, plus the sample count. Children, stalls and calls all
 *     report time in it.
 *
 * Rows are sorted worst first BY PADI, so the CLI and the dialog agree:
 * children by summed start-call time, calls by worst total, watchers by last
 * install time.
 */

import { Schema } from "effect";

/** A value that was measured, or the reason it was not. */
export const measuredSchema = <S extends Schema.Top>(value: S) =>
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal("measured"), value }),
    Schema.Struct({
      kind: Schema.Literal("unmeasured"),
      reason: Schema.String,
    }),
  ]);

export const TimingSummarySchema = Schema.Struct({
  count: Schema.Number,
  medianMs: Schema.Number,
  p99Ms: Schema.Number,
  maxMs: Schema.Number,
  sumMs: Schema.Number,
});
export type TimingSummary = typeof TimingSummarySchema.Type;

const MeasuredTimingSchema = measuredSchema(TimingSummarySchema);

/** Event-loop delay: how late the loop ran a timer that was due. Node's
 *  histogram keeps no per-sample values, so each summary's `sumMs` is an
 *  estimate — (mean − resolution) × count — where every other field is read
 *  off the histogram. */
export const PadiStallsSchema = Schema.Struct({
  /** The monitor's sampling interval; a reading is already net of it. */
  resolutionMs: Schema.Number,
  /** The last COMPLETED minute. Unmeasured until one has completed. */
  lastMinute: measuredSchema(
    Schema.Struct({ summary: TimingSummarySchema, windowMs: Schema.Number }),
  ),
  /** The minute in progress, and how much of it has passed. */
  current: Schema.Struct({
    summary: MeasuredTimingSchema,
    elapsedMs: Schema.Number,
  }),
});

export const PadiChildRowSchema = Schema.Struct({
  /** The program, plus its subcommand words for git (1), gh (2), osfacts (1). */
  kind: Schema.String,
  /** Started in the window. */
  started: Schema.Number,
  /** Running now, whatever their age. */
  running: Schema.Number,
  failedToStart: Schema.Number,
  /** Time inside the start call — the event loop is blocked for all of it. */
  startCall: MeasuredTimingSchema,
  /** Start to exit, of those that exited. */
  run: MeasuredTimingSchema,
  /** Why they ran, where the caller said (a `gh` from the PR watcher). */
  causes: Schema.Array(
    Schema.Struct({ cause: Schema.String, count: Schema.Number }),
  ),
});
export type PadiChildRow = typeof PadiChildRowSchema.Type;

export const PadiCallRowSchema = Schema.Struct({
  /** The procedure's dotted name, e.g. `git.getStatus`. */
  procedure: Schema.String,
  count: Schema.Number,
  /** Call to answer. */
  total: TimingSummarySchema,
  /** The summed run time of each call's children, and how many it started. */
  inChildren: measuredSchema(
    Schema.Struct({ summary: TimingSummarySchema, children: Schema.Number }),
  ),
});
export type PadiCallRow = typeof PadiCallRowSchema.Type;

export const PadiWatcherStateSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("installing") }),
  Schema.Struct({ kind: Schema.Literal("watching") }),
  /** A bare repo's folder: nothing is installed for it, by design. */
  Schema.Struct({ kind: Schema.Literal("no-working-tree") }),
  Schema.Struct({ kind: Schema.Literal("failed"), message: Schema.String }),
]);

export const PadiWatcherRowSchema = Schema.Struct({
  /** The watcher's own label: `git: working-tree`, `git: head`, … */
  kind: Schema.String,
  /** The directory watched — recursively for `git: working-tree`. */
  root: Schema.String,
  /** Who asked: `terminal <id>`, `stream pullRequest (branch <b>)`, … */
  askers: Schema.Array(Schema.String),
  state: PadiWatcherStateSchema,
  directories: measuredSchema(Schema.Number),
  rebuilds: Schema.Number,
  lastInstallMs: measuredSchema(Schema.Number),
  /** What only one kind of row has. */
  detail: Schema.Union([
    /** One `fs.watch` on `root`, filtered to one file in it. */
    Schema.Struct({ kind: Schema.Literal("file"), file: Schema.String }),
    /** A recursive working-tree subscription. */
    Schema.Struct({
      kind: Schema.Literal("tree"),
      ignoredPaths: measuredSchema(Schema.Number),
      /** The reason of the last rebuild. `null` means the entry has never
       *  rebuilt — a fact, not an unknown. */
      lastRebuildReason: Schema.NullOr(Schema.String),
    }),
  ]),
});
export type PadiWatcherRow = typeof PadiWatcherRowSchema.Type;

/** What the kernel says padi holds, beside the rows: on Linux, the inotify
 *  watches of each inotify instance this process has open. */
export const PadiKernelWatchesSchema = Schema.Struct({
  total: Schema.Number,
  perInstance: Schema.Array(
    Schema.Struct({ fd: Schema.Number, watches: Schema.Number }),
  ),
});

export const PadiDiagnosticsSchema = Schema.Struct({
  process: Schema.Struct({ pid: Schema.Number, uptimeMs: Schema.Number }),
  memory: Schema.Struct({
    rssBytes: Schema.Number,
    heapUsedBytes: Schema.Number,
    heapTotalBytes: Schema.Number,
    externalBytes: Schema.Number,
    /** Resident minus the JS heap: native buffers, watchers, code. */
    nonHeapBytes: Schema.Number,
  }),
  stalls: PadiStallsSchema,
  children: Schema.Struct({
    windowMs: Schema.Number,
    rows: Schema.Array(PadiChildRowSchema),
  }),
  calls: Schema.Struct({
    windowMs: Schema.Number,
    rows: Schema.Array(PadiCallRowSchema),
  }),
  watchers: Schema.Struct({ rows: Schema.Array(PadiWatcherRowSchema) }),
  kernelWatches: measuredSchema(PadiKernelWatchesSchema),
});
export type PadiDiagnostics = typeof PadiDiagnosticsSchema.Type;
