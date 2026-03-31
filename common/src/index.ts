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
  /** Absolute path to the plan file for this session (derived from JSONL slug), if any. */
  latestPlanPath: z.string().nullable(),
  /** Plan file modification time (epoch ms) — changes trigger client content refetch via query key. */
  planModifiedAt: z.number().nullable(),
});

// --- Plans ---

export const PlanContentSchema = z.object({
  path: z.string(),
  content: z.string(),
  modifiedAt: z.number(),
});

export const PlanFeedbackInputSchema = z.object({
  /** Absolute path to the plan file. */
  path: z.string(),
  /** Line number after which to insert feedback (1-based). */
  afterLine: z.number(),
  /** Feedback text (will be wrapped in blockquote format). */
  text: z.string(),
});

// --- Terminal metadata (unified, provider-aggregated) ---

export const TerminalMetadataSchema = z.object({
  cwd: z.string(),
  git: GitInfoSchema.nullable(),
  pr: GitHubPrInfoSchema.nullable(),
  claude: ClaudeCodeInfoSchema.nullable(),
  themeName: z.string().optional(),
  /** If set, this terminal is a sub-terminal of the given parent. */
  parentId: z.string().optional(),
  /** Numeric ordering within the terminal's group (top-level or same parent). Higher = later. */
  sortOrder: z.number(),
});

// --- Activity ---

/** A timestamped activity transition: [epochMs, isActive]. */
export const ActivitySampleSchema = z.tuple([z.number(), z.boolean()]);
export type ActivitySample = z.infer<typeof ActivitySampleSchema>;

// --- Terminal ---

export const TerminalInfoSchema = z.object({
  id: TerminalIdSchema,
  pid: z.number(),
  meta: TerminalMetadataSchema,
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
  /** Unique ID for this server process — changes on restart. */
  processId: z.string().uuid(),
});

// --- Recent repos (server-side persistent state) ---

export const RecentRepoSchema = z.object({
  repoRoot: z.string(),
  repoName: z.string(),
  lastSeen: z.number(),
});

// --- Session persistence ---

export const SavedTerminalSchema = z.object({
  /** Stable ID within this session (original terminal UUID at save time). */
  id: z.string(),
  cwd: z.string(),
  /** References another saved terminal's `id` (sub-terminal relationship). */
  parentId: z.string().optional(),
  /** Snapshot of repo name at save time (for display only). */
  repoName: z.string().optional(),
  /** Snapshot of branch at save time (for display only). */
  branch: z.string().optional(),
  /** Ordering within group at save time. */
  sortOrder: z.number().optional(),
});

export const SavedSessionSchema = z.object({
  terminals: z.array(SavedTerminalSchema),
  savedAt: z.number(),
});

// --- Derived types ---

export type TerminalInfo = z.infer<typeof TerminalInfoSchema>;
export type TerminalId = TerminalInfo["id"];

export type GitInfo = z.infer<typeof GitInfoSchema>;
export type GitHubPrInfo = z.infer<typeof GitHubPrInfoSchema>;
export type ClaudeCodeInfo = z.infer<typeof ClaudeCodeInfoSchema>;
export type TerminalMetadata = z.infer<typeof TerminalMetadataSchema>;
export type RecentRepo = z.infer<typeof RecentRepoSchema>;
export type SavedTerminal = z.infer<typeof SavedTerminalSchema>;
export type SavedSession = z.infer<typeof SavedSessionSchema>;
export type PlanContent = z.infer<typeof PlanContentSchema>;
