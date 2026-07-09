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
 * `defineSurface` turns this spec into `surface.contract` (the oRPC router the
 * server implements and the client consumes) plus `surface.descriptors` /
 * `surface.spec` for reflection. Nothing else in the app re-declares these
 * shapes — the inferred domain types at the bottom are the single source of
 * truth (`SurfaceTypes` lifts them straight out of the spec).
 */

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import { z } from "zod";

// ── Named schemas — referenced from more than one position ──────────────

const PidSchema = z.number().int().nonnegative();

const ProcessSchema = z.object({
  /** Owning user (name on darwin/ps, uid-derived on linux). */
  user: z.string(),
  /** Percent of one core during the last poll window. */
  cpuPct: z.number(),
  /** Resident memory as a percent of total. */
  memPct: z.number(),
  /** The command line (truncated). */
  command: z.string(),
});

const LoadSchema = z.object({
  /** 1-minute, 5-minute, 15-minute load averages. */
  avg: z.tuple([z.number(), z.number(), z.number()]),
  /** Logical CPU count — the "100% == this many busy cores" denominator. */
  cores: z.number().int().nonnegative(),
});

const MemorySchema = z.object({
  /** Bytes in use (total − available). */
  used: z.number(),
  /** Total physical memory in bytes. */
  total: z.number(),
});

export const DEFAULT_LOAD: z.infer<typeof LoadSchema> = {
  avg: [0, 0, 0],
  cores: 0,
};
export const DEFAULT_MEMORY: z.infer<typeof MemorySchema> = {
  used: 0,
  total: 0,
};

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
      kill: {
        input: z.object({
          pid: PidSchema,
          signal: z.enum(["TERM", "KILL", "HUP", "INT"]).default("TERM"),
        }),
        output: z.object({ ok: z.boolean() }),
      },
    },
  },
});

// ── Inferred domain types — single source of truth ──────────────────────

type SF = SurfaceTypes<typeof surface.spec>;

export type Pid = SF["collections"]["processes"]["Key"];
export type Process = SF["collections"]["processes"]["Value"];
export type Load = SF["cells"]["load"]["Value"];
export type Memory = SF["cells"]["memory"]["Value"];
