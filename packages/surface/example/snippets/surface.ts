/**
 * The example surface the Surface docs embed. Every `<Snippet>` in the
 * Stratum-I reference/how-to pages imports THIS surface (or the helpers built
 * over it), so the shapes shown on the site are the shapes the workspace
 * typechecks. A wrong call path fails `pnpm -r typecheck`, not review.
 *
 * A small process-monitor surface, one member of each kind:
 *
 *   - `load`      — cell: the current load average.
 *   - `processes` — keyed collection: PID → process snapshot.
 *   - `nodeLog`   — stream: a node's live log, snapshot then deltas.
 *   - `autosave`  — event: "a doc was saved" (occurrence, no snapshot).
 *   - `proc.kill` — procedure: the one imperative mutation.
 */

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import { z } from "zod";

const Load = z.object({
  one: z.number(),
  five: z.number(),
  fifteen: z.number(),
});
export const ZERO: z.infer<typeof Load> = { one: 0, five: 0, fifteen: 0 };

const Pid = z.number().int().nonnegative();
const Proc = z.object({
  command: z.string(),
  cpuPct: z.number(),
  memPct: z.number(),
});

const NodeId = z.string();
const LogFrame = z.object({
  kind: z.enum(["snapshot", "delta"]),
  text: z.string(),
  done: z.boolean(),
});

const DocId = z.string();
const SavedAt = z.object({ at: z.number() });

const KillArgs = z.object({ pid: Pid });
const Killed = z.object({ ok: z.boolean() });

// #region define
export const surface = defineSurface({
  cells: { load: { schema: Load, default: ZERO } },
  collections: { processes: { keySchema: Pid, schema: Proc } },
  streams: { nodeLog: { inputSchema: NodeId, outputSchema: LogFrame } },
  events: { autosave: { inputSchema: DocId, outputSchema: SavedAt } },
  procedures: { proc: { kill: { input: KillArgs, output: Killed } } },
});
// #endregion define

type SF = SurfaceTypes<typeof surface.spec>;

export type Pid = SF["collections"]["processes"]["Key"];
export type Proc = SF["collections"]["processes"]["Value"];
export type Load = SF["cells"]["load"]["Value"];
export type LogFrame = SF["streams"]["nodeLog"]["Output"];
