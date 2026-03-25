// Shared types for kolu server↔client communication.
// Zod schemas are the single source of truth; TS types are derived.

import { z } from "zod";

// --- Zod schemas ---

const TerminalIdSchema = z.number().int();

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

// --- Terminal ---

export const TerminalInfoSchema = z.object({
  id: TerminalIdSchema,
  name: z.string(),
  pid: z.number(),
  themeName: z.string().optional(),
  isActive: z.boolean(),
  cwd: CwdInfoSchema.optional(),
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
});

export const TerminalAttachInputSchema = z.object({ id: TerminalIdSchema });
export const TerminalAttachOutputSchema = z.string();
export const TerminalOnExitOutputSchema = z.number();
export const TerminalActivityOutputSchema = z.boolean();

export const TerminalPasteImageInputSchema = z.object({
  id: TerminalIdSchema,
  /** Base64-encoded image data (PNG, JPEG, etc.) */
  data: z.string(),
});

// --- Git worktree ---

export const WorktreeEntrySchema = z.object({
  path: z.string(),
  branch: z.string().nullable(),
  isBare: z.boolean(),
});

export const WorktreeListInputSchema = z.object({
  repoRoot: z.string(),
});

export const WorktreeListOutputSchema = z.array(WorktreeEntrySchema);

export const ServerInfoSchema = z.object({
  hostname: z.string(),
});

// --- Derived types ---

export type TerminalInfo = z.infer<typeof TerminalInfoSchema>;
export type TerminalId = TerminalInfo["id"];

export type GitInfo = z.infer<typeof GitInfoSchema>;
export type CwdInfo = z.infer<typeof CwdInfoSchema>;
export type WorktreeEntry = z.infer<typeof WorktreeEntrySchema>;
