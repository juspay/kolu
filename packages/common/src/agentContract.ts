/**
 * `agentContract` — narrow oRPC contract that `kolu agent --stdio`
 * serves and `RemoteBackend` consumes.
 *
 * **Why a narrow contract.** The agent should NOT serve the full
 * `appRouter`. Pre-implementation review (finding E): exposing
 * `terminal.create` recursively would let an agent attempt to spawn
 * another remote terminal-on-a-terminal — recursion nightmare.
 * Exposing `surface.*` (cells, collections, streams) leaks
 * client-facing UX plumbing into a server-internal protocol whose
 * volatility axis is different.
 *
 * The agent's job is narrow: own one machine's PTYs, surface their
 * channels + fs/git ops, accept a heartbeat. The kolu server owns
 * everything else and is the only consumer.
 *
 * Wire shape mirrors `Backend` exactly — every method on the contract
 * corresponds to a method on `Backend`, just transported. This keeps
 * `RemoteBackend` a thin shim: each method is one `client.X.Y(...)`
 * call against the same shape it would call locally on `LocalBackend`.
 *
 * Versioning: the agent contract is independent of the
 * client-server contract. A user can run kolu N locally and connect
 * to a kolu M agent (R-2 doesn't ship the version negotiation; R-3
 * will when the agent's contract grows beyond its initial freeze).
 */

import { eventIterator, oc } from "@orpc/contract";
import {
  FsListAllInputSchema,
  FsListAllOutputSchema,
  FsReadFileInputSchema,
  FsReadFileOutputSchema,
  GitDiffInputSchema,
  GitDiffOutputSchema,
  GitInfoSchema,
  GitStatusInputSchema,
  GitStatusOutputSchema,
} from "kolu-git/schemas";
import { z } from "zod";
import {
  AgentInfoSchema,
  ConnectionStateSchema,
  ForegroundSchema,
  InitialTerminalMetadataSchema,
  TerminalIdSchema,
} from "./surface";
import { PrResultSchema } from "kolu-github/schemas";

// ── Terminal lifecycle ────────────────────────────────────────────────

export const AgentTerminalSpawnInputSchema = z.object({
  cwd: z.string().optional(),
  initialMetadata: InitialTerminalMetadataSchema.extend({
    parentId: z.string().optional(),
  }).optional(),
});

export const AgentTerminalSpawnOutputSchema = z.object({
  id: TerminalIdSchema,
});

export const AgentTerminalKillInputSchema = z.object({ id: TerminalIdSchema });

export const AgentTerminalWriteInputSchema = z.object({
  id: TerminalIdSchema,
  data: z.string(),
});

export const AgentTerminalResizeInputSchema = z.object({
  id: TerminalIdSchema,
  cols: z.number(),
  rows: z.number(),
});

// ── Per-terminal channels ────────────────────────────────────────────
//
// Each channel mirrors a key in `TerminalChannelMap` (kolu-common/backend.ts).
// The agent serves them as event-iterator streams; `RemoteBackend.terminalChannel`
// consumes via the same oRPC client.

const ChannelInput = z.object({ id: TerminalIdSchema });

const channelOf = <T extends z.ZodType>(schema: T) =>
  oc.input(ChannelInput).output(eventIterator(schema));

// ── Filesystem ───────────────────────────────────────────────────────

export const AgentUploadFileInputSchema = z.object({
  id: TerminalIdSchema,
  name: z.string().min(1),
  base64Data: z.string(),
});

export const AgentUploadFileOutputSchema = z.object({
  path: z.string(),
});

const SubscribeRepoInputSchema = z.object({ repoPath: z.string() });
const SubscribeFileInputSchema = z.object({
  repoPath: z.string(),
  filePath: z.string(),
});

// ── The agent contract ───────────────────────────────────────────────

export const agentContract = oc.router({
  /** Liveness probe. RemoteBackend's HostSession pings on
   *  `HEARTBEAT_INTERVAL` (5s); 5 consecutive missed → reconnect. */
  heartbeat: oc.output(z.object({ ok: z.literal(true) })),

  terminal: {
    spawn: oc
      .input(AgentTerminalSpawnInputSchema)
      .output(AgentTerminalSpawnOutputSchema),
    kill: oc.input(AgentTerminalKillInputSchema).output(z.boolean()),
    write: oc.input(AgentTerminalWriteInputSchema).output(z.void()),
    resize: oc.input(AgentTerminalResizeInputSchema).output(z.void()),
    uploadFile: oc
      .input(AgentUploadFileInputSchema)
      .output(AgentUploadFileOutputSchema),

    // Channels — one per TerminalChannelMap key. snapshot-then-delta.
    channelData: channelOf(z.string()),
    channelCwd: channelOf(z.string()),
    channelTitle: channelOf(z.string()),
    channelGit: channelOf(GitInfoSchema.nullable()),
    channelCommandRun: channelOf(z.string()),
    channelAgent: channelOf(AgentInfoSchema.nullable()),
    channelPr: channelOf(PrResultSchema),
    channelForeground: channelOf(ForegroundSchema.nullable()),
    channelConnectionState: channelOf(ConnectionStateSchema),
  },

  fs: {
    listAll: oc.input(FsListAllInputSchema).output(FsListAllOutputSchema),
    readFile: oc.input(FsReadFileInputSchema).output(FsReadFileOutputSchema),
    subscribeRepoChange: oc
      .input(SubscribeRepoInputSchema)
      .output(eventIterator(z.void())),
    subscribeFileChange: oc
      .input(SubscribeFileInputSchema)
      .output(eventIterator(z.void())),
  },

  git: {
    getDiff: oc.input(GitDiffInputSchema).output(GitDiffOutputSchema),
    getStatus: oc.input(GitStatusInputSchema).output(GitStatusOutputSchema),
    // `subscribeRepoChange` lives on `fs` only — Lowy post-impl F1.
    // The git watcher and fs watcher are the same parcel-watcher
    // subscription with a different name. One axis, one site.
  },
});

export type AgentContract = typeof agentContract;
