/**
 * Agent surface — the typed reactive surface a `kolu --stdio` agent
 * exposes over its stdio link.
 *
 * Replaces `./agentContract.ts` (which hand-rolled the same shape as
 * raw oRPC + 9 separate per-terminal channels). The Surface
 * formulation collapses 8 of those channels into one
 * `terminalMetadata` collection (Q1(a) in the redo plan); raw PTY
 * bytes remain a separate high-throughput `terminalData` stream.
 *
 * Wire shape (after `defineSurface(...)` wraps everything in the
 * top-level `surface` namespace):
 *
 *   collection terminalMetadata     →  surface.terminalMetadata.{keys, get}
 *   stream     terminalData         →  surface.terminalData.get
 *   stream     fsRepoChange         →  surface.fsRepoChange.get
 *   stream     fsFileChange         →  surface.fsFileChange.get
 *   procedure  system.heartbeat     →  surface.system.heartbeat
 *   procedure  terminal.{spawn,...} →  surface.terminal.{spawn,...}
 *   procedure  fs.{listAll,...}     →  surface.fs.{listAll,...}
 *   procedure  git.{getDiff,...}    →  surface.git.{getDiff,...}
 *
 * Agent-managed fields only. `AgentTerminalMetadataSchema` is the
 * intersection of `ServerPersistedTerminalFieldsSchema` and
 * `LiveTerminalFieldsSchema` that the agent's in-process providers
 * actually produce (cwd, git, agent, pr, foreground, lastAgentCommand,
 * lastActivityAt). Client-only fields (themeName, canvasLayout, etc.)
 * stay on the kolu-server side and are NOT shipped over the agent
 * wire — they came from the browser at terminal-create time and live
 * in the kolu-server's `entry.meta`.
 *
 * `connectionState` is NOT in the agent surface (Q1(c) hybrid spillover
 * from the answered Q1(a)): it's the kolu-server's view of
 * `HostSession`'s connection state, not produced by the agent. The
 * RemoteBackend writes it to entry.meta directly from the state
 * machine.
 */

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import {
  FsListAllInputSchema,
  FsListAllOutputSchema,
  FsReadFileOutputSchema,
  GitDiffInputSchema,
  GitDiffOutputSchema,
  GitInfoSchema,
  GitStatusInputSchema,
  GitStatusOutputSchema,
} from "kolu-git/schemas";
import { PrResultSchema } from "kolu-github/schemas";
import { z } from "zod";
import {
  AgentInfoSchema,
  ForegroundSchema,
  InitialTerminalMetadataSchema,
  TerminalIdSchema,
} from "./surface";

// ── Agent-managed metadata shape ──────────────────────────────────────

/** Per-terminal metadata fields the agent produces. Subset of the full
 *  `TerminalMetadataSchema` — only the fields whose authoritative
 *  source is the agent's process (its in-tree providers + PTY). */
export const AgentTerminalMetadataSchema = z.object({
  cwd: z.string(),
  git: GitInfoSchema.nullable(),
  lastAgentCommand: z.string().optional(),
  lastActivityAt: z.number().default(0),
  pr: PrResultSchema,
  agent: AgentInfoSchema.nullable(),
  foreground: ForegroundSchema.nullable(),
});

export type AgentTerminalMetadata = z.infer<typeof AgentTerminalMetadataSchema>;

// ── Procedure I/O schemas ─────────────────────────────────────────────

const AgentTerminalSpawnInputSchema = z.object({
  /** Kolu server pre-generates the id so it can register a connecting
   *  tile before the spawn RPC roundtrips. */
  id: z.string(),
  cwd: z.string().optional(),
  initialMetadata: InitialTerminalMetadataSchema.extend({
    parentId: z.string().optional(),
  }).optional(),
});

const AgentTerminalSpawnOutputSchema = z.object({
  id: TerminalIdSchema,
});

const AgentTerminalKillInputSchema = z.object({ id: TerminalIdSchema });

const AgentTerminalWriteInputSchema = z.object({
  id: TerminalIdSchema,
  data: z.string(),
});

const AgentTerminalResizeInputSchema = z.object({
  id: TerminalIdSchema,
  cols: z.number(),
  rows: z.number(),
});

const AgentUploadFileInputSchema = z.object({
  id: TerminalIdSchema,
  name: z.string().min(1),
  base64Data: z.string(),
});

const AgentUploadFileOutputSchema = z.object({
  path: z.string(),
});

const AgentReadFileInputSchema = z.object({
  repoPath: z.string(),
  filePath: z.string(),
});

const SubscribeRepoInputSchema = z.object({ repoPath: z.string() });
const SubscribeFileInputSchema = z.object({
  repoPath: z.string(),
  filePath: z.string(),
});

// ── The agent surface ─────────────────────────────────────────────────

export const agentSurface = defineSurface({
  collections: {
    /** Per-terminal aggregated metadata — replaces the 8 separate
     *  channels (cwd/title/git/commandRun/agent/pr/foreground/
     *  connectionState) in the old `agentContract.ts`. Subscribers see
     *  ONE collection keyed by terminal id; the agent's providers
     *  internally aggregate before publishing. */
    terminalMetadata: {
      keySchema: TerminalIdSchema,
      schema: AgentTerminalMetadataSchema,
      verbs: ["keys", "get"],
    },
  },

  streams: {
    /** Raw PTY bytes for one terminal. Kept as a separate stream
     *  because it's high-throughput and latency-sensitive — separating
     *  it from `terminalMetadata` avoids interleaving backpressure
     *  semantics. */
    terminalData: {
      inputSchema: z.object({ id: TerminalIdSchema }),
      outputSchema: z.string(),
    },
    /** OSC 633;E preexec command lines (raw) per terminal. */
    terminalCommandRun: {
      inputSchema: z.object({ id: TerminalIdSchema }),
      outputSchema: z.string(),
    },
    /** Repository-wide filesystem change tick. Yields `void` per debounced
     *  change anywhere under `repoPath`. */
    fsRepoChange: {
      inputSchema: SubscribeRepoInputSchema,
      outputSchema: z.void(),
    },
    /** Single-file filesystem change tick. */
    fsFileChange: {
      inputSchema: SubscribeFileInputSchema,
      outputSchema: z.void(),
    },
  },

  procedures: {
    system: {
      /** Liveness probe. RemoteBackend's HostSession pings on a 5s
       *  interval; 5 consecutive missed → reconnect. */
      heartbeat: {
        output: z.object({ ok: z.literal(true) }),
      },
    },
    terminal: {
      spawn: {
        input: AgentTerminalSpawnInputSchema,
        output: AgentTerminalSpawnOutputSchema,
      },
      kill: {
        input: AgentTerminalKillInputSchema,
        output: z.boolean(),
      },
      write: { input: AgentTerminalWriteInputSchema },
      resize: { input: AgentTerminalResizeInputSchema },
      uploadFile: {
        input: AgentUploadFileInputSchema,
        output: AgentUploadFileOutputSchema,
      },
    },
    fs: {
      listAll: {
        input: FsListAllInputSchema,
        output: FsListAllOutputSchema,
      },
      readFile: {
        input: AgentReadFileInputSchema,
        output: FsReadFileOutputSchema,
      },
    },
    git: {
      getDiff: {
        input: GitDiffInputSchema,
        output: GitDiffOutputSchema,
      },
      getStatus: {
        input: GitStatusInputSchema,
        output: GitStatusOutputSchema,
      },
    },
  },
});

export type AgentSurface = SurfaceTypes<typeof agentSurface.spec>;
