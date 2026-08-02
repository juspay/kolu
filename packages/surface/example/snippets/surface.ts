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
 *
 * Schemas are Effect Schemas. Two spellings are LAWS for any wire field: an
 * optional key is `Schema.optionalKey` (never `Schema.optional`, which
 * round-trips an explicit `undefined` through `null`), and a defaulted key is
 * `Schema.withDecodingDefaultKey` (never `Schema.withDecodingDefault`).
 */

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import { Schema } from "effect";

const Load = Schema.Struct({
  one: Schema.Number,
  five: Schema.Number,
  fifteen: Schema.Number,
});
export const ZERO: typeof Load.Type = { one: 0, five: 0, fifteen: 0 };

const Pid = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Proc = Schema.Struct({
  command: Schema.String,
  cpuPct: Schema.Number,
  memPct: Schema.Number,
});

const NodeId = Schema.String;
const LogFrame = Schema.Struct({
  kind: Schema.Literals(["snapshot", "delta"]),
  text: Schema.String,
  done: Schema.Boolean,
});

const DocId = Schema.String;
const SavedAt = Schema.Struct({ at: Schema.Number });

const KillArgs = Schema.Struct({ pid: Pid });
const Killed = Schema.Struct({ ok: Schema.Boolean });

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
/** A stream's input as a CALLER spells it — the ENCODED side. */
export type NodeIdArg = SF["streams"]["nodeLog"]["InputWire"];
export type KillArgs = typeof KillArgs.Encoded;
export type Killed = typeof Killed.Type;
