// Shared types for kolu server↔client communication.
// Zod schemas are the single source of truth; TS types are derived.

import { z } from "zod";

// --- Zod schemas ---

const TerminalIdSchema = z.string();

// Shared fields spread into each discriminant variant
const terminalBaseFields = {
  id: TerminalIdSchema,
  name: z.string(),
  pid: z.number(),
  themeName: z.string().optional(),
};

// Discriminated union: exitCode is required when exited, absent when running.
export const TerminalInfoSchema = z.discriminatedUnion("status", [
  z.object({
    ...terminalBaseFields,
    status: z.literal("running"),
    isActive: z.boolean(),
  }),
  z.object({
    ...terminalBaseFields,
    status: z.literal("exited"),
    exitCode: z.number(),
  }),
]);

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

export const TerminalPasteImageInputSchema = z.object({
  id: TerminalIdSchema,
  /** Base64-encoded image data (PNG, JPEG, etc.) */
  data: z.string(),
});

export const ServerInfoSchema = z.object({
  hostname: z.string(),
});

// --- Derived types ---

export type TerminalInfo = z.infer<typeof TerminalInfoSchema>;
export type TerminalId = TerminalInfo["id"];
export type TerminalStatus = TerminalInfo["status"];

/** Extract the status discriminant from TerminalInfo for reuse (e.g. server-side TerminalEntry). */
export type TerminalRunning = Extract<TerminalInfo, { status: "running" }>;
export type TerminalExited = Extract<TerminalInfo, { status: "exited" }>;

export type GitInfo = z.infer<typeof GitInfoSchema>;
export type CwdInfo = z.infer<typeof CwdInfoSchema>;
