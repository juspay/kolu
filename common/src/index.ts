// Shared types for kolu server↔client communication.
// Zod schemas are the single source of truth; TS types are derived.

import { z } from "zod";

// --- Zod schemas ---

const TerminalIdSchema = z.string().uuid();

// --- Git context (enriches CWD stream) ---

export const GitInfoSchema = z.object({
  repoRoot: z.string(),
  repoName: z.string(),
  worktreePath: z.string(),
  branch: z.string(),
});

export const CwdInfoSchema = z.object({
  cwd: z.string(),
  git: GitInfoSchema.nullable(),
});

// --- Agent detection (enriches activity stream) ---

export const AgentStateSchema = z.enum(["thinking", "waiting", "idle"]);

export const AgentStatusSchema = z.object({
  agent: z.string(),
  state: AgentStateSchema,
});

export const ActivityInfoSchema = z.object({
  isActive: z.boolean(),
  foregroundProcess: z.string(),
  agent: AgentStatusSchema.nullable(),
});

// --- Terminal ---

export const TerminalInfoSchema = z.object({
  id: TerminalIdSchema,
  pid: z.number(),
  themeName: z.string().optional(),
  isActive: z.boolean(),
  cwd: CwdInfoSchema.optional(),
  parentId: TerminalIdSchema.optional(),
  foregroundProcess: z.string().optional(),
  agentStatus: AgentStatusSchema.nullable().optional(),
});

export const TerminalResizeInputSchema = z.object({
  id: TerminalIdSchema,
  cols: z.number(),
  rows: z.number(),
});

export const TerminalSendInputSchema = z.object({
  id: TerminalIdSchema,
  data: z.string(),
});

export const TerminalSetThemeInputSchema = z.object({
  id: TerminalIdSchema,
  themeName: z.string(),
});

export const TerminalCreateInputSchema = z.object({
  cwd: z.string().optional(),
  parentId: TerminalIdSchema.optional(),
});

export const TerminalAttachInputSchema = z.object({ id: TerminalIdSchema });
export const TerminalAttachOutputSchema = z.string();
export const TerminalOnExitOutputSchema = z.number();
export const TerminalActivityOutputSchema = ActivityInfoSchema;

export const TerminalPasteImageInputSchema = z.object({
  id: TerminalIdSchema,
  /** Base64-encoded image data (PNG, JPEG, etc.) */
  data: z.string(),
});

export const TerminalSetParentInputSchema = z.object({
  id: TerminalIdSchema,
  parentId: TerminalIdSchema.nullable(),
});

export const TerminalReorderInputSchema = z.object({
  ids: z.array(TerminalIdSchema),
});

export const ServerInfoSchema = z.object({
  hostname: z.string(),
});

// --- Derived types ---

export type TerminalInfo = z.infer<typeof TerminalInfoSchema>;
export type TerminalId = TerminalInfo["id"];

export type GitInfo = z.infer<typeof GitInfoSchema>;
export type CwdInfo = z.infer<typeof CwdInfoSchema>;

export type AgentState = z.infer<typeof AgentStateSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type ActivityInfo = z.infer<typeof ActivityInfoSchema>;
