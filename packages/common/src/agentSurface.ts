/**
 * `agentSurface` — the typed wire shape the kolu PTY-host agent (the
 * daemon spawned by kolu-server, or the remote ssh agent) serves.
 *
 * Scope. The agent owns the PTY children. It does NOT own kolu's
 * provider DAG (foreground-pid observer, claude/codex/opencode
 * detectors, git/PR watchers) — those still run in kolu-server,
 * consuming the streams below. That keeps `terminalMetadata` as one
 * collection in kolu-server's own surface (no cross-surface bridging)
 * and lets the agent stay a thin PTY service.
 *
 * Snapshot-then-delta. `terminalAttach` yields one
 * `{ kind: "snapshot", data }` entry — the serialized screen state
 * from `@xterm/headless` at attach time — followed by `{ kind:
 * "delta", data }` entries for live PTY output. Late-joining clients
 * pick up where the running PTY left off without raw-scrollback
 * replay.
 *
 * Contract version. Bumped on the wire shape, not on the kolu binary
 * hash. kolu-server holds a compiled-in `MIN_AGENT_CONTRACT` semver
 * range and refuses to talk to a daemon that falls outside it. The
 * daemon's `system.version` reports the contract major.minor;
 * upgrades to kolu that don't change the wire stay compatible across
 * the running daemon.
 */

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import { z } from "zod";
import { TerminalIdSchema } from "./surface.ts";

/** The wire-shape version this build of kolu-server expects from the
 *  agent. Bumped only when `agentSurface` itself changes shape. */
export const AGENT_CONTRACT_VERSION = "1.0";

/** Semver range kolu-server accepts from the daemon at handshake time.
 *  Caret-range tolerates minor bumps (additive changes); a major
 *  mismatch triggers degraded mode. */
export const MIN_AGENT_CONTRACT = "^1.0";

const TerminalSpawnInputSchema = z.object({
  /** Caller-supplied PTY id. kolu-server mints the terminal id and
   *  passes it here so the daemon's PTY id == kolu-server's terminal
   *  id — this is what makes reattach-by-id work across kolu-server
   *  restart. Optional; the daemon generates one if absent. */
  id: TerminalIdSchema.optional(),
  cwd: z.string().optional(),
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  scrollback: z.number().int().positive().optional(),
  termProgramVersion: z.string(),
});

const TerminalSpawnOutputSchema = z.object({
  id: TerminalIdSchema,
  pid: z.number().int(),
  cwd: z.string(),
  /** Foreground process name at spawn (the shell). Seeds the
   *  consumer's process-observer cache before the first title event. */
  process: z.string(),
});

const TerminalIdInputSchema = z.object({ id: TerminalIdSchema });

const TerminalWriteInputSchema = z.object({
  id: TerminalIdSchema,
  data: z.string(),
});

const TerminalResizeInputSchema = z.object({
  id: TerminalIdSchema,
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

const TerminalListEntrySchema = z.object({
  id: TerminalIdSchema,
  pid: z.number().int(),
  cwd: z.string(),
  lastActivity: z.number(),
});

const TerminalDataMsgSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("snapshot"), data: z.string() }),
  z.object({ kind: z.literal("delta"), data: z.string() }),
]);

/** Enriched title event. Carries the foreground process name + pid read
 *  at title-change time so the consumer's process-observer + agent
 *  detectors (which run in kolu-server, not the daemon) can read a
 *  fresh `process`/`foregroundPid` synchronously from a local cache —
 *  the daemon owns the PTY, but kolu-server owns the provider DAG. */
const TerminalTitleMsgSchema = z.object({
  title: z.string(),
  process: z.string(),
  foregroundPid: z.number().int().optional(),
});

const TerminalExitMsgSchema = z.object({ exitCode: z.number().int() });

const SystemVersionOutputSchema = z.object({
  contractVersion: z.string(),
  pkgVersion: z.string(),
  pid: z.number().int(),
  startedAt: z.number(),
});

const SystemHeartbeatOutputSchema = z.object({
  ts: z.number(),
});

export const agentSurface = defineSurface({
  streams: {
    /** Per-terminal output stream — snapshot then live deltas.
     *  First yield is `{kind:"snapshot", data}` where `data` is the
     *  serialized `@xterm/headless` buffer at attach time. */
    terminalAttach: {
      inputSchema: TerminalIdInputSchema,
      outputSchema: TerminalDataMsgSchema,
    },
    /** Per-terminal cwd changes (OSC 7). First yield is the current
     *  cwd at subscribe time, subsequent yields are updates. */
    terminalCwd: {
      inputSchema: TerminalIdInputSchema,
      outputSchema: z.string(),
    },
    /** Per-terminal title changes (OSC 0/2), enriched with the
     *  foreground process name + pid sampled at title-change time.
     *  Delta-only (no initial snapshot) — the title's only meaningful
     *  state is the last change; the consumer seeds its initial
     *  process/foregroundPid from `terminal.spawn`'s output instead. */
    terminalTitle: {
      inputSchema: TerminalIdInputSchema,
      outputSchema: TerminalTitleMsgSchema,
    },
    /** Per-terminal preexec commands (OSC 633;E). Delta-only — by
     *  definition each event is a fresh user-typed command. */
    terminalCommandRun: {
      inputSchema: TerminalIdInputSchema,
      outputSchema: z.string(),
    },
    /** Per-terminal exit notification. Single yield with the exit
     *  code, then the stream ends. */
    terminalExit: {
      inputSchema: TerminalIdInputSchema,
      outputSchema: TerminalExitMsgSchema,
    },
  },
  procedures: {
    terminal: {
      spawn: {
        input: TerminalSpawnInputSchema,
        output: TerminalSpawnOutputSchema,
      },
      kill: {
        input: TerminalIdInputSchema,
        output: z.object({ ok: z.boolean() }),
      },
      killAll: {
        input: z.object({}),
        output: z.object({ killed: z.number().int() }),
      },
      write: {
        input: TerminalWriteInputSchema,
        output: z.object({ ok: z.boolean() }),
      },
      resize: {
        input: TerminalResizeInputSchema,
        output: z.object({ ok: z.boolean() }),
      },
      list: {
        input: z.object({}),
        output: z.object({ entries: z.array(TerminalListEntrySchema) }),
      },
      getForegroundPid: {
        input: TerminalIdInputSchema,
        output: z.object({ pid: z.number().int().optional() }),
      },
      getScreenState: {
        input: TerminalIdInputSchema,
        output: z.object({ data: z.string() }),
      },
      getScreenText: {
        input: z.object({
          id: TerminalIdSchema,
          startLine: z.number().int().optional(),
          endLine: z.number().int().optional(),
        }),
        output: z.object({ text: z.string() }),
      },
    },
    system: {
      version: {
        input: z.object({}),
        output: SystemVersionOutputSchema,
      },
      heartbeat: {
        input: z.object({}),
        output: SystemHeartbeatOutputSchema,
      },
    },
  },
});

export type AgentSurface = SurfaceTypes<typeof agentSurface.spec>;
export type AgentTerminalListEntry = z.infer<typeof TerminalListEntrySchema>;
export type AgentTerminalDataMsg = z.infer<typeof TerminalDataMsgSchema>;
export type AgentSystemVersion = z.infer<typeof SystemVersionOutputSchema>;
