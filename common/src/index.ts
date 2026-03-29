// Shared types for kolu server↔client communication.
// Zod schemas are the single source of truth; TS types are derived.

import { z } from "zod";

// --- Zod schemas ---

const TerminalIdSchema = z.string().uuid();

// --- Git context ---

export const GitInfoSchema = z.object({
  repoRoot: z.string(),
  repoName: z.string(),
  worktreePath: z.string(),
  branch: z.string(),
  isWorktree: z.boolean(),
  mainRepoRoot: z.string(),
});

// --- Git worktree operations ---

export const WorktreeCreateInputSchema = z.object({
  repoPath: z.string(),
});

export const WorktreeCreateOutputSchema = z.object({
  path: z.string(),
  branch: z.string(),
});

export const WorktreeRemoveInputSchema = z.object({
  worktreePath: z.string(),
});

// --- GitHub PR context ---

export const GitHubCheckStatusSchema = z.enum(["pending", "pass", "fail"]);

export const GitHubPrStateSchema = z.enum(["open", "closed", "merged"]);

export const GitHubPrInfoSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  /** PR state: open, closed, or merged. */
  state: GitHubPrStateSchema,
  /** Combined CI status: pending, pass, or fail. Null if no checks configured. */
  checks: GitHubCheckStatusSchema.nullable(),
});

// --- Claude Code context ---

export const ClaudeCodeStateSchema = z.enum([
  "thinking",
  "tool_use",
  "waiting",
]);

export const ClaudeCodeInfoSchema = z.object({
  /** Current state derived from session JSONL. */
  state: ClaudeCodeStateSchema,
  /** Session UUID from ~/.claude/sessions/. */
  sessionId: z.string(),
  /** Model name if available (e.g. "claude-opus-4-6"). */
  model: z.string().nullable(),
});

// --- Terminal metadata (unified, provider-aggregated) ---

export const TerminalMetadataSchema = z.object({
  cwd: z.string(),
  git: GitInfoSchema.nullable(),
  pr: GitHubPrInfoSchema.nullable(),
  claude: ClaudeCodeInfoSchema.nullable(),
});

// --- Activity ---

/** A timestamped activity transition: [epochMs, isActive]. */
export const ActivitySampleSchema = z.tuple([z.number(), z.boolean()]);
export type ActivitySample = z.infer<typeof ActivitySampleSchema>;

// --- Terminal ---

export const TerminalInfoSchema = z.object({
  id: TerminalIdSchema,
  pid: z.number(),
  themeName: z.string().optional(),
  isActive: z.boolean(),
  meta: TerminalMetadataSchema.optional(),
  parentId: TerminalIdSchema.optional(),
  /** Server-side activity history for sparkline rendering. */
  activityHistory: z.array(ActivitySampleSchema).optional(),
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
export const TerminalActivityOutputSchema = z.boolean();

export const TerminalScreenTextInputSchema = z.object({
  id: TerminalIdSchema,
  /** First line to capture (0-based, inclusive). Defaults to 0 (start of scrollback). */
  startLine: z.number().int().nonnegative().optional(),
  /** Last line to capture (exclusive). Defaults to buffer length. */
  endLine: z.number().int().nonnegative().optional(),
});

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

// --- Recent repos (server-side persistent state) ---

export const RecentRepoSchema = z.object({
  repoRoot: z.string(),
  repoName: z.string(),
  lastSeen: z.number(),
});

// --- Derived types ---

export type TerminalInfo = z.infer<typeof TerminalInfoSchema>;
export type TerminalId = TerminalInfo["id"];

export type GitInfo = z.infer<typeof GitInfoSchema>;
export type GitHubPrInfo = z.infer<typeof GitHubPrInfoSchema>;
export type ClaudeCodeInfo = z.infer<typeof ClaudeCodeInfoSchema>;
export type TerminalMetadata = z.infer<typeof TerminalMetadataSchema>;
export type RecentRepo = z.infer<typeof RecentRepoSchema>;
