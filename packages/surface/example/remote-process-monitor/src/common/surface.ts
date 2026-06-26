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
 * Plus one named connection-progress event so the parent can stream
 * "Copying agent to remote…" lines to the browser while `nix copy` is in
 * flight (row 7: instant pane + async fill).
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

// The shared, gate-closed connection cell + the seam that composes it — the
// SAME source of truth pulam-web uses, instead of a hand-rolled parallel copy.
import { mirroredSurface } from "@kolu/surface-nix-host/connection";
import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import { z } from "zod";

export {
  type ConnectionInfo,
  type ConnectionState,
  DEFAULT_CONNECTION,
} from "@kolu/surface-nix-host/connection";

const PidSchema = z.number().int().nonnegative();
const ProcessSchema = z.object({
  user: z.string(),
  cpuPct: z.number(),
  memPct: z.number(),
  command: z.string(),
});

const CpuCoreSchema = z.object({
  /** Busy-percentage since the previous poll tick (0-100). */
  usagePct: z.number(),
  /** Reported clock speed in MHz (often a sticky max on Linux). */
  speedMHz: z.number(),
  model: z.string(),
});
const SystemSchema = z.object({
  /** 1-minute, 5-minute, 15-minute load averages. */
  loadAvg: z.tuple([z.number(), z.number(), z.number()]),
  /** Bytes used / total — UI converts to GB. */
  memUsed: z.number(),
  memTotal: z.number(),
  /** Seconds since boot. */
  uptime: z.number(),
  /** OS family — `linux` reads /proc/*, `darwin` reads sysctl. */
  os: z.enum(["linux", "darwin", "unknown"]),
  /** Resolved hostname inside the agent (parent shows this in the
   *  header chip — useful when the parent ssh'd by an alias). */
  hostname: z.string(),
});

export const DEFAULT_SYSTEM: z.infer<typeof SystemSchema> = {
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
 *  one specific PID" use cases). */
const ProcessesSnapshotMessage = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("snapshot"),
    entries: z.array(z.tuple([PidSchema, ProcessSchema])),
  }),
  z.object({
    kind: z.literal("delta"),
    upserts: z.array(z.tuple([PidSchema, ProcessSchema])),
    removes: z.array(PidSchema),
  }),
]);

export const surface = defineSurface({
  cells: {
    system: {
      schema: SystemSchema,
      default: DEFAULT_SYSTEM,
    },
    // NOTE: no `connection` cell here. Link health is composed ONLY at the
    // nix-host re-serve seam via `mirroredSurface(surface)` below — the agent
    // serves this connection-free base; the parent mirrors it and adds the cell.
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
      keySchema: z.number().int().nonnegative(),
      schema: CpuCoreSchema,
    },
  },
  streams: {
    processesSnapshot: {
      inputSchema: z.object({}),
      outputSchema: ProcessesSnapshotMessage,
    },
  },
  procedures: {
    process: {
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

/** The surface the BROWSER consumes and the PARENT re-serves: the agent's base
 *  `surface` augmented at the mirror seam with the gate-closed `connection` cell.
 *  The agent serves the base; the parent mirrors it and writes `connection` from
 *  `session.onState` — exactly pulam-web's split, on the shared combinator. */
export const monitorSurface = mirroredSurface(surface);

type SF = SurfaceTypes<typeof surface.spec>;

export type Pid = SF["collections"]["processes"]["Key"];
export type Process = SF["collections"]["processes"]["Value"];
export type CoreId = SF["collections"]["cpuCores"]["Key"];
export type CpuCore = SF["collections"]["cpuCores"]["Value"];
export type SystemInfo = SF["cells"]["system"]["Value"];
export type ProcessesSnapshotMsg = SF["streams"]["processesSnapshot"]["Output"];
