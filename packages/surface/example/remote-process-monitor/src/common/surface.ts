/**
 * Remote-process-monitor surface — the shape served by the agent over
 * stdio and re-served by the parent over WebSocket.
 *
 * Three primitives carry the entire feature:
 *
 *   - `system`     — singleton cell with load averages, memory, uptime.
 *   - `processes`  — keyed collection (PID → per-process snapshot).
 *   - `kill`       — imperative procedure (the only mutation).
 *
 * Plus one bulk snapshot-then-delta stream so a 600-PID table arrives in one
 * frame rather than one round-trip per row.
 *
 * Symmetry with R-2: this maps row-for-row onto kolu's terminals surface:
 *
 *   - `processes` ↔ `terminalMetadata` (keyed snapshot + per-key deltas).
 *   - `system`    ↔ `terminalExit` / `sessionSummary` (singleton cell).
 *   - `kill`      ↔ `terminal.create` / `terminal.dispose` (imperative).
 *
 * If the surface shape works here, R-2's `RemoteTerminalBackend` reduces
 * to "Kolu-specific consumer of the same shape." (See plan §R-1.5 row
 * checklist for the full mapping.)
 */

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import { Effect, Schema } from "effect";

const PidSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const ProcessSchema = Schema.Struct({
  user: Schema.String,
  cpuPct: Schema.Number,
  memPct: Schema.Number,
  command: Schema.String,
});

const CpuCoreSchema = Schema.Struct({
  /** Busy-percentage since the previous poll tick (0-100). */
  usagePct: Schema.Number,
  /** Reported clock speed in MHz (often a sticky max on Linux). */
  speedMHz: Schema.Number,
  model: Schema.String,
});
const SystemSchema = Schema.Struct({
  /** 1-minute, 5-minute, 15-minute load averages. */
  loadAvg: Schema.Tuple([Schema.Number, Schema.Number, Schema.Number]),
  /** Bytes used / total — UI converts to GB. */
  memUsed: Schema.Number,
  memTotal: Schema.Number,
  /** Seconds since boot. */
  uptime: Schema.Number,
  /** OS family — `linux` reads /proc/*, `darwin` reads sysctl. */
  os: Schema.Literals(["linux", "darwin", "unknown"]),
  /** Resolved hostname inside the agent (parent shows this in the
   *  header chip — useful when the parent ssh'd by an alias). */
  hostname: Schema.String,
});

export const DEFAULT_SYSTEM: typeof SystemSchema.Type = {
  loadAvg: [0, 0, 0],
  memUsed: 0,
  memTotal: 0,
  uptime: 0,
  os: "unknown",
  hostname: "",
};

/** Snapshot-then-delta `Stream<>` shape — the bulk-friendly counterpart
 *  to the per-key `processes` collection. With 600+ PIDs, the
 *  collection's N+1 subscribes drip a row per round-trip over a
 *  high-latency `ssh` link; this stream yields the entire keyed map
 *  in one frame (snapshot) then per-tick delta sets. The UI consumes
 *  this for the htop table; the per-key `processes` collection stays
 *  on the surface for the framework's "row 3: snapshot-then-delta on
 *  collections" demonstration (and remains the right shape for "watch
 *  one specific PID" use cases).
 *
 *  `Schema.Union`, not `Schema.TaggedUnion`: the discriminant is `kind`, and a
 *  tagged union would rename it to `_tag` and change the bytes. */
const ProcessesSnapshotMessage = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    entries: Schema.Array(Schema.Tuple([PidSchema, ProcessSchema])),
  }),
  Schema.Struct({
    kind: Schema.Literal("delta"),
    upserts: Schema.Array(Schema.Tuple([PidSchema, ProcessSchema])),
    removes: Schema.Array(PidSchema),
  }),
]);

/** `process.kill`'s argument. `signal` absent on the wire ⇒ decoded as
 *  `"TERM"`. `withDecodingDefaultKey`, never `withDecodingDefault`: the key may
 *  be MISSING, never an explicit `undefined` (which the latter would round-trip
 *  through `null`, changing the bytes). */
const KillInputSchema = Schema.Struct({
  pid: PidSchema,
  signal: Schema.Literals(["TERM", "KILL", "HUP", "INT"]).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("TERM" as const)),
  ),
});
const KillOutputSchema = Schema.Struct({ ok: Schema.Boolean });

export const surface = defineSurface({
  cells: {
    system: {
      schema: SystemSchema,
      default: DEFAULT_SYSTEM,
    },
  },
  collections: {
    processes: {
      keySchema: PidSchema,
      schema: ProcessSchema,
    },
    /** Per-core CPU usage — small-N (typical 4-32) Collection<K,T>
     *  showcase. Each core is independently observable via the
     *  framework's per-key reactive identity, which is exactly the
     *  shape a "view N rows side by side" UI wants when N is small.
     *  R-2's `terminalMetadata` collection is the same fit (3-20
     *  terminals); see plan §R-1.5 row 3. */
    cpuCores: {
      keySchema: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      schema: CpuCoreSchema,
    },
  },
  streams: {
    processesSnapshot: {
      inputSchema: Schema.Struct({}),
      outputSchema: ProcessesSnapshotMessage,
    },
  },
  procedures: {
    process: {
      kill: { input: KillInputSchema, output: KillOutputSchema },
    },
  },
});

/** The surface the BROWSER consumes and the PARENT re-serves: the agent's base
 *  `surface`, served verbatim. This example teaches RE-SERVE MECHANICS + process
 *  monitoring — not connection PRESENTATION.
 *
 *  Note (SR9): **connection presentation is a host-map concept.** A single re-served
 *  surface like this carries no per-host connection state — the honest link health
 *  (probing/provisioning/connecting + the log tail) rides a `@kolu/surface-map` host map's
 *  `entries` channel as its fine `connection` payload, produced by `serveHostMap` from
 *  the SAME session frame as the coarse dot (one authority; see
 *  `@kolu/surface-remote`'s `serveHostMap`). A standalone re-serve that genuinely needs
 *  connection state would reintroduce that seam via prove-then-extract with a real
 *  consumer in hand — this example does not pretend the capability exists. */
export const monitorSurface = surface;

type SF = SurfaceTypes<typeof surface.spec>;

export type Pid = SF["collections"]["processes"]["Key"];
export type Process = SF["collections"]["processes"]["Value"];
export type CoreId = SF["collections"]["cpuCores"]["Key"];
export type CpuCore = SF["collections"]["cpuCores"]["Value"];
export type SystemInfo = SF["cells"]["system"]["Value"];
export type ProcessesSnapshotMsg = SF["streams"]["processesSnapshot"]["Output"];
export type ProcessesSnapshotInput =
  SF["streams"]["processesSnapshot"]["InputWire"];

/** `process.kill`'s argument as a CALLER spells it — the ENCODED side, where
 *  `signal` is optional — and its result. `SurfaceTypes` covers the four
 *  reactive primitives; a procedure's two sides are read off its own schemas. */
export type KillArgs = typeof KillInputSchema.Encoded;
export type KillResult = typeof KillOutputSchema.Type;
