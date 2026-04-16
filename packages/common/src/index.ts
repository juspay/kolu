// Shared types for kolu server↔client communication.
// Zod schemas are the single source of truth; TS types are derived.
// Integration packages define their own schemas (e.g. kolu-claude-code,
// kolu-git); this module re-exports them and composes aggregate types.

import { z } from "zod";
import { TaskProgressSchema } from "anyagent";
import { ClaudeCodeInfoSchema } from "kolu-claude-code";
import { OpenCodeInfoSchema } from "kolu-opencode";
import {
  GitInfoSchema,
  WorktreeCreateInputSchema,
  WorktreeCreateOutputSchema,
  WorktreeRemoveInputSchema,
  GitChangeStatusSchema,
  GitChangedFileSchema,
  GitDiffModeSchema,
  GitBaseRefSchema,
  GitStatusInputSchema,
  GitStatusOutputSchema,
  GitDiffInputSchema,
  GitDiffOutputSchema,
  FsListDirInputSchema,
  FsDirEntrySchema,
  FsListDirOutputSchema,
  FsReadFileInputSchema,
  FsReadFileOutputSchema,
} from "kolu-git";

// Re-export integration schemas so consumers import from kolu-common only.
export { TaskProgressSchema, ClaudeCodeInfoSchema, OpenCodeInfoSchema };

// Re-export git schemas from kolu-git.
export {
  GitInfoSchema,
  WorktreeCreateInputSchema,
  WorktreeCreateOutputSchema,
  WorktreeRemoveInputSchema,
  GitChangeStatusSchema,
  GitChangedFileSchema,
  GitDiffModeSchema,
  GitBaseRefSchema,
  GitStatusInputSchema,
  GitStatusOutputSchema,
  GitDiffInputSchema,
  GitDiffOutputSchema,
  FsListDirInputSchema,
  FsDirEntrySchema,
  FsListDirOutputSchema,
  FsReadFileInputSchema,
  FsReadFileOutputSchema,
};
export type {
  GitInfo,
  GitChangeStatus,
  GitChangedFile,
  GitDiffMode,
  GitBaseRef,
  GitStatusOutput,
  GitDiffOutput,
  FsListDirOutput,
} from "kolu-git";

// --- Zod schemas ---

const TerminalIdSchema = z.string().uuid();

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

// --- AI coding agent context ---

export const AgentKindSchema = z.enum(["claude-code", "opencode"]);

export const AgentInfoSchema = z.discriminatedUnion("kind", [
  ClaudeCodeInfoSchema,
  OpenCodeInfoSchema,
]);

// --- Foreground process context ---

/** Foreground process info from PTY. */
export const ForegroundSchema = z.object({
  /** Binary name (e.g. "vim", "claude", "opencode"). */
  name: z.string(),
  /** Raw terminal title from OSC 0/2 (e.g. "user@host: ~/code", "vim file.ts"). */
  title: z.string().nullable(),
});

// --- Terminal metadata (unified, provider-aggregated) ---

export const CanvasLayoutSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type CanvasLayout = z.infer<typeof CanvasLayoutSchema>;

export const SubPanelStateSchema = z.object({
  collapsed: z.boolean(),
  panelSize: z.number(),
});

export const TerminalMetadataSchema = z.object({
  cwd: z.string(),
  git: GitInfoSchema.nullable(),
  pr: GitHubPrInfoSchema.nullable(),
  /** AI coding agent status (Claude Code, OpenCode, etc.). */
  agent: AgentInfoSchema.nullable(),
  /** Foreground process name — detected via OSC 2 title change events. */
  foreground: ForegroundSchema.nullable(),
  themeName: z.string().optional(),
  /** If set, this terminal is a sub-terminal of the given parent. */
  parentId: z.string().optional(),
  /** Numeric ordering within the terminal's group (top-level or same parent). Higher = later. */
  sortOrder: z.number(),
  /** Canvas tile position/size — client-reported, used for session restore. */
  canvasLayout: CanvasLayoutSchema.optional(),
  /** Sub-panel collapsed/size state — client-reported, used for session restore. */
  subPanel: SubPanelStateSchema.optional(),
});

// --- Activity ---

/** A timestamped activity transition: [epochMs, isActive]. */
export const ActivitySampleSchema = z.tuple([z.number(), z.boolean()]);
export type ActivitySample = z.infer<typeof ActivitySampleSchema>;

/**
 * `onActivityChange` stream contract: the first yield on every
 * (re)subscribe is a `snapshot` of retained history; every later yield
 * is a `delta`. Clients replace on snapshot, append on delta — so
 * re-subscribe after a reconnect restores state without duplication.
 */
export const ActivityStreamEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("snapshot"),
    samples: z.array(ActivitySampleSchema),
  }),
  z.object({
    kind: z.literal("delta"),
    sample: ActivitySampleSchema,
  }),
]);
export type ActivityStreamEvent = z.infer<typeof ActivityStreamEventSchema>;

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

export const TerminalSetCanvasLayoutInputSchema = z.object({
  id: TerminalIdSchema,
  layout: CanvasLayoutSchema,
});

export const TerminalSetSubPanelInputSchema = z.object({
  id: TerminalIdSchema,
  collapsed: z.boolean(),
  panelSize: z.number(),
});

export const SetActiveTerminalInputSchema = z.object({
  id: TerminalIdSchema.nullable(),
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

// --- Recent agents (server-side persistent state) ---

/** A normalized agent CLI invocation (e.g. "claude --model sonnet").
 *  Populated from OSC 633;E command marks emitted by kolu's preexec hook
 *  whenever the user runs a known agent binary in any terminal. */
export const RecentAgentSchema = z.object({
  /** Normalized command line — first token is the agent binary,
   *  followed by its stable flags. Prompt/message flags and trailing
   *  positional arguments are stripped so ephemeral prompt text does
   *  not pollute the MRU. */
  command: z.string(),
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
  /** Theme name at save time. */
  themeName: z.string().optional(),
  /** Canvas tile position and size at save time. */
  canvasLayout: CanvasLayoutSchema.optional(),
  /** Sub-panel state at save time (collapsed, size). */
  subPanel: z
    .object({
      collapsed: z.boolean(),
      panelSize: z.number(),
    })
    .optional(),
});

export const SavedSessionSchema = z.object({
  terminals: z.array(SavedTerminalSchema),
  /** Which terminal was active at save time. */
  activeTerminalId: z.string().nullable().optional(),
  savedAt: z.number(),
});

// --- User preferences (server-side, shared with client) ---

export const ColorSchemeSchema = z.enum(["light", "dark", "system"]);

/** Which sidebar cards render a live xterm preview.
 *  - `all`: every terminal (noisy; mostly useful for testing)
 *  - `agents`: any terminal with a running code agent
 *  - `attention`: only agents that need the user (waiting or unread) — **default**
 *  - `none`: never */
export const SidebarAgentPreviewsSchema = z.enum([
  "all",
  "agents",
  "attention",
  "none",
]);
export type SidebarAgentPreviews = z.infer<typeof SidebarAgentPreviewsSchema>;

export const RightPanelTabSchema = z.enum(["inspector", "diff"]);
export type RightPanelTab = z.infer<typeof RightPanelTabSchema>;

/** Sub-view of the Code tab: local/branch diff modes or the file browser. */
export const CodeTabViewSchema = z.enum(["local", "branch", "browse"]);
export type CodeTabView = z.infer<typeof CodeTabViewSchema>;

export const RightPanelPrefsSchema = z.object({
  collapsed: z.boolean(),
  size: z.number(),
  tab: RightPanelTabSchema,
  /** Whether the right panel is pinned (docked) vs floating overlay. */
  pinned: z.boolean(),
  /** Active sub-view within the Code tab (local/branch/browse). */
  codeMode: CodeTabViewSchema,
});

export const PreferencesSchema = z.object({
  seenTips: z.array(z.string()),
  startupTips: z.boolean(),
  /** Auto-pick a perceptually-distinct theme for each new terminal. When
   *  off, every terminal gets the server default until the user picks one. */
  shuffleTheme: z.boolean(),
  scrollLock: z.boolean(),
  activityAlerts: z.boolean(),
  colorScheme: ColorSchemeSchema,
  sidebarAgentPreviews: SidebarAgentPreviewsSchema,
  /** Canvas mode shows all terminals as freeform draggable tiles.
   *  Focus mode shows one terminal at a time with a sidebar. */
  canvasMode: z.boolean(),
  rightPanel: RightPanelPrefsSchema,
});

// --- Server state ---

/** What conf stores to disk — survives server restart. */
export const PersistedStateSchema = z.object({
  recentRepos: z.array(RecentRepoSchema),
  recentAgents: z.array(RecentAgentSchema),
  session: SavedSessionSchema.nullable(),
  preferences: PreferencesSchema,
});

/** What the client receives — currently same as persisted.
 *  #333 will extend with runtime fields (terminals, terminalMeta). */
export const ServerStateSchema = PersistedStateSchema.extend({});

/** Preference patch — top-level fields are optional; nested objects are deep-partial. */
const PreferencesPatchSchema = PreferencesSchema.omit({ rightPanel: true })
  .partial()
  .extend({ rightPanel: RightPanelPrefsSchema.partial().optional() });

/** Partial patch for state updates — all fields optional, preferences partially mergeable. */
export const ServerStatePatchSchema = z.object({
  recentRepos: z.array(RecentRepoSchema).optional(),
  recentAgents: z.array(RecentAgentSchema).optional(),
  session: SavedSessionSchema.nullable().optional(),
  preferences: PreferencesPatchSchema.optional(),
});

// --- Derived types ---

export type TerminalInfo = z.infer<typeof TerminalInfoSchema>;
export type TerminalId = TerminalInfo["id"];

export type GitHubPrInfo = z.infer<typeof GitHubPrInfoSchema>;
export type TaskProgress = z.infer<typeof TaskProgressSchema>;
export type AgentKind = z.infer<typeof AgentKindSchema>;
export type AgentInfo = z.infer<typeof AgentInfoSchema>;
export type ClaudeCodeInfo = z.infer<typeof ClaudeCodeInfoSchema>;
export type OpenCodeInfo = z.infer<typeof OpenCodeInfoSchema>;
export type Foreground = z.infer<typeof ForegroundSchema>;
export type TerminalMetadata = z.infer<typeof TerminalMetadataSchema>;
export type RecentRepo = z.infer<typeof RecentRepoSchema>;
export type RecentAgent = z.infer<typeof RecentAgentSchema>;
export type SavedTerminal = z.infer<typeof SavedTerminalSchema>;
export type SavedSession = z.infer<typeof SavedSessionSchema>;
export type ColorScheme = z.infer<typeof ColorSchemeSchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;
export type PersistedState = z.infer<typeof PersistedStateSchema>;
export type ServerState = z.infer<typeof ServerStateSchema>;
export type ServerStatePatch = z.infer<typeof ServerStatePatchSchema>;
export type PreferencesPatch = NonNullable<ServerStatePatch["preferences"]>;
