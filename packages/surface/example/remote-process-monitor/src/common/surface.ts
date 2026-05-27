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

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import { z } from "zod";

const PidSchema = z.number().int().nonnegative();
const ProcessSchema = z.object({
  user: z.string(),
  cpuPct: z.number(),
  memPct: z.number(),
  command: z.string(),
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
  /** Lifecycle state of the parent-to-agent link. The agent always
   *  reports `"connected"`; the parent overrides during pre-link
   *  phases (`"copying"` while `nix copy` runs, `"connecting"` while
   *  ssh handshake completes, `"disconnected"` after a blip) so the
   *  browser's overlay reflects the live state without needing a
   *  second channel.
   *
   *  Row 4 of the falsifiability checklist hinges on this — the
   *  parent's surface is read via `useCell(system)`, which yields the
   *  current value synchronously to a new subscriber. The browser
   *  attaches its overlay before `connect()` returns and still sees
   *  the initial `connecting` state. */
  state: z.enum(["copying", "connecting", "connected", "disconnected"]),
});

export const DEFAULT_SYSTEM: z.infer<typeof SystemSchema> = {
  loadAvg: [0, 0, 0],
  memUsed: 0,
  memTotal: 0,
  uptime: 0,
  os: "unknown",
  hostname: "",
  state: "connecting",
};

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

type SF = SurfaceTypes<typeof surface.spec>;

export type Pid = SF["collections"]["processes"]["Key"];
export type Process = SF["collections"]["processes"]["Value"];
export type SystemInfo = SF["cells"]["system"]["Value"];
