/**
 * fleet-top part 1 — the surface, declared once.
 *
 * A live `top` for one machine. Four primitives carry the whole tool:
 *
 *   - `load`      — Cell: the 1/5/15-minute load averages (a singleton).
 *   - `memory`    — Cell: bytes used / total (a singleton).
 *   - `processes` — Collection keyed by pid: one row per process.
 *   - `process.kill` — Procedure: the one mutation (send a signal to a pid).
 *
 * `defineSurface` turns this spec into `surface.group` (the flat Effect RPC
 * group the server binds handlers on and every link is built over — one member
 * per wire tag, `surface/<member>/<verb>`) plus `surface.descriptors` /
 * `surface.spec` for reflection. Nothing else in the app re-declares these
 * shapes — the inferred domain types at the bottom are the single source of
 * truth (`SurfaceTypes` lifts them straight out of the spec).
 *
 * The schemas are Effect Schemas. Two spellings are laws rather than taste:
 * an optional wire key is `Schema.optionalKey` (never `Schema.optional`, which
 * round-trips an explicit `undefined` through `null`), and a defaulted wire key
 * is `Schema.withDecodingDefaultKey` — as `kill`'s `signal` is below, so a
 * caller may omit it while the handler always receives a real signal name.
 */

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import { Effect, Schema } from "effect";

// ── Named schemas — referenced from more than one position ──────────────

const PidSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const ProcessSchema = Schema.Struct({
  /** Owning user (name on darwin/ps, uid-derived on linux). */
  user: Schema.String,
  /** Percent of one core during the last poll window. */
  cpuPct: Schema.Number,
  /** Resident memory as a percent of total. */
  memPct: Schema.Number,
  /** The command line (truncated). */
  command: Schema.String,
});

const LoadSchema = Schema.Struct({
  /** 1-minute, 5-minute, 15-minute load averages. */
  avg: Schema.Tuple([Schema.Number, Schema.Number, Schema.Number]),
  /** Logical CPU count — the "100% == this many busy cores" denominator. */
  cores: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

const MemorySchema = Schema.Struct({
  /** Bytes in use (total − available). */
  used: Schema.Number,
  /** Total physical memory in bytes. */
  total: Schema.Number,
});

export const DEFAULT_LOAD: typeof LoadSchema.Type = {
  avg: [0, 0, 0],
  cores: 0,
};
export const DEFAULT_MEMORY: typeof MemorySchema.Type = {
  used: 0,
  total: 0,
};

/** `kill`'s argument. `signal` absent on the wire ⇒ decoded as `"TERM"`.
 *  `withDecodingDefaultKey`, never `withDecodingDefault`: the key may be
 *  MISSING, never an explicit `undefined`. */
const KillInputSchema = Schema.Struct({
  pid: PidSchema,
  signal: Schema.Literals(["TERM", "KILL", "HUP", "INT"]).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("TERM" as const)),
  ),
});
const KillOutputSchema = Schema.Struct({ ok: Schema.Boolean });

// ── The surface ─────────────────────────────────────────────────────────

export const surface = defineSurface({
  cells: {
    load: { schema: LoadSchema, default: DEFAULT_LOAD },
    memory: { schema: MemorySchema, default: DEFAULT_MEMORY },
  },
  collections: {
    processes: { keySchema: PidSchema, schema: ProcessSchema },
  },
  procedures: {
    process: {
      // Imperative escape hatch: killing a pid is a command, not a keyed
      // upsert, so it doesn't fit the collection's mutation verbs.
      kill: { input: KillInputSchema, output: KillOutputSchema },
    },
  },
});

// ── Inferred domain types — single source of truth ──────────────────────

type SF = SurfaceTypes<typeof surface.spec>;

export type Pid = SF["collections"]["processes"]["Key"];
export type Process = SF["collections"]["processes"]["Value"];
export type Load = SF["cells"]["load"]["Value"];
export type Memory = SF["cells"]["memory"]["Value"];

/** `process.kill`'s argument as a CALLER spells it — the ENCODED side, where
 *  `signal` is optional — and its result. `SurfaceTypes` covers the four
 *  reactive primitives; a procedure's two sides are read straight off its own
 *  schemas. */
export type KillArgs = typeof KillInputSchema.Encoded;
export type KillResult = typeof KillOutputSchema.Type;
