// Shared types for kolu server↔client communication.
// Zod schemas are the single source of truth; TS types are derived.
// Integration packages define their own schemas (e.g. kolu-claude-code,
// kolu-git); this module re-exports them and composes aggregate types.

// Import from `/schemas` subpaths, not package roots — keeps the
// client bundle free of `@anthropic-ai/claude-agent-sdk`, `node:sqlite`,
// `node:child_process`, etc. (see juspay/kolu#682).
import { TaskProgressSchema } from "anyagent/schemas";
import { ClaudeCodeInfoSchema } from "kolu-claude-code/schemas";
import { CodexInfoSchema } from "kolu-codex/schemas";
import {
  FsListAllInputSchema,
  FsListAllOutputSchema,
  FsReadFileInputSchema,
  FsReadFileOutputSchema,
  GitBaseRefSchema,
  GitChangedFileSchema,
  GitChangeStatusSchema,
  GitDiffInputSchema,
  GitDiffModeSchema,
  GitDiffOutputSchema,
  GitInfoSchema,
  GitStatusInputSchema,
  GitStatusOutputSchema,
  WorktreeCreateInputSchema,
  WorktreeCreateOutputSchema,
  WorktreeRemoveInputSchema,
} from "kolu-git/schemas";
import { OpenCodeInfoSchema } from "kolu-opencode/schemas";
import { z } from "zod";

export type {
  FsListAllOutput,
  GitBaseRef,
  GitChangedFile,
  GitChangeStatus,
  GitDiffMode,
  GitDiffOutput,
  GitInfo,
  GitStatusOutput,
} from "kolu-git/schemas";
// Re-export integration schemas so consumers import from kolu-common only.
// Re-export git schemas from kolu-git.
export {
  ClaudeCodeInfoSchema,
  CodexInfoSchema,
  FsListAllInputSchema,
  FsListAllOutputSchema,
  FsReadFileInputSchema,
  FsReadFileOutputSchema,
  GitBaseRefSchema,
  GitChangedFileSchema,
  GitChangeStatusSchema,
  GitDiffInputSchema,
  GitDiffModeSchema,
  GitDiffOutputSchema,
  GitInfoSchema,
  GitStatusInputSchema,
  GitStatusOutputSchema,
  OpenCodeInfoSchema,
  TaskProgressSchema,
  WorktreeCreateInputSchema,
  WorktreeCreateOutputSchema,
  WorktreeRemoveInputSchema,
};

// --- Zod schemas ---

const TerminalIdSchema = z.string().uuid();

// --- GitHub PR context ---
// Owned by kolu-github (mirrors the kolu-git re-export pattern above). The
// `kolu-common/pr` subpath re-exports the same zod schemas directly for
// callers that only need the PR types without any other common imports.
import {
  GhUnavailableCodeSchema,
  GhUnavailableSchema,
  GitHubCheckStatusSchema,
  GitHubPrInfoSchema,
  GitHubPrStateSchema,
  PrResultSchema,
  PrUnavailableSourceSchema,
  prUnavailableReason,
  prUnavailableSource,
  prValue,
  reasonForGhCode,
  reasonForSource,
} from "kolu-github/schemas";

export type {
  GhUnavailableCode,
  GitHubPrInfo,
  PrResult,
  PrUnavailableSource,
} from "kolu-github/schemas";
export {
  GhUnavailableCodeSchema,
  GhUnavailableSchema,
  GitHubCheckStatusSchema,
  GitHubPrInfoSchema,
  GitHubPrStateSchema,
  PrResultSchema,
  PrUnavailableSourceSchema,
  prUnavailableReason,
  prUnavailableSource,
  prValue,
  reasonForGhCode,
  reasonForSource,
};

// --- AI coding agent context ---

export const AgentKindSchema = z.enum(["claude-code", "codex", "opencode"]);

export const AgentInfoSchema = z.discriminatedUnion("kind", [
  ClaudeCodeInfoSchema,
  CodexInfoSchema,
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

/**
 * Server-persisted fields — written by server-side metadata providers
 * (via `updateServerMetadata`) and round-tripped through disk. The
 * "server-writes + persisted" intersection, declared structurally.
 */
export const ServerPersistedTerminalFieldsSchema = z.object({
  cwd: z.string(),
  git: GitInfoSchema.nullable(),
  /** Normalized agent CLI invocation last observed in this terminal (e.g.
   *  `"claude --model sonnet"`). Preserved across intervening non-agent
   *  input; drives the "resume agent on restore" offer in EmptyState.
   *  Absent for terminals that never ran a known agent. */
  lastAgentCommand: z.string().optional(),
});

/**
 * Client-persisted fields — written by client RPCs (via
 * `updateClientMetadata`, or direct mutation for paths that intentionally
 * skip the publish like sub-panel state) and round-tripped through disk.
 * The "client-writes + persisted" intersection, declared structurally.
 */
export const ClientPersistedTerminalFieldsSchema = z.object({
  themeName: z.string().optional(),
  /** If set, this terminal is a sub-terminal of the given parent. */
  parentId: z.string().optional(),
  /** Canvas tile position/size — client-reported, used for session restore. */
  canvasLayout: CanvasLayoutSchema.optional(),
  /** Sub-panel collapsed/size state — client-reported, used for session restore. */
  subPanel: SubPanelStateSchema.optional(),
});

/**
 * Fields that only exist on a live terminal — transient status fed by
 * external state and never persisted. If a field is here, a session
 * restore must re-derive it; if a field is on one of the persisted
 * schemas, it round-trips through disk as-is.
 */
export const LiveTerminalFieldsSchema = z.object({
  /** GitHub PR resolution — discriminated union (see PrResultSchema). */
  pr: PrResultSchema,
  /** AI coding agent status (Claude Code, OpenCode, etc.). */
  agent: AgentInfoSchema.nullable(),
  /** Foreground process name — detected via OSC 2 title change events. */
  foreground: ForegroundSchema.nullable(),
});

/**
 * Every field that rides to disk. Union of the two write-authority
 * bases — `SavedTerminal` just adds `id` to this shape. Adding a
 * persisted field is a one-place change on whichever base owns it.
 */
export const PersistedTerminalFieldsSchema =
  ServerPersistedTerminalFieldsSchema.merge(
    ClientPersistedTerminalFieldsSchema,
  );

/**
 * Server write fence — the mutator passed to `updateServerMetadata` is
 * narrowed to this shape, so providers cannot accidentally write
 * client-owned fields like themeName. Server-persisted base + transient
 * live state (both server-written).
 */
export const TerminalServerMetadataSchema =
  ServerPersistedTerminalFieldsSchema.merge(LiveTerminalFieldsSchema);

/**
 * Client write fence — the mutator passed to `updateClientMetadata` is
 * narrowed to this shape, so RPC handlers cannot accidentally overwrite
 * provider-owned state. Exactly the client-persisted base.
 */
export const TerminalClientMetadataSchema = ClientPersistedTerminalFieldsSchema;

/**
 * Unified wire shape — persisted fields plus transient live status.
 * Flat for convenience; code that only needs one half should import the
 * sub-schema so the dependency is explicit.
 */
export const TerminalMetadataSchema = PersistedTerminalFieldsSchema.merge(
  LiveTerminalFieldsSchema,
);

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

/** Client-owned metadata supplied at create time. Seeded onto the new
 *  terminal's `meta` before the first `terminal.list` yield, so session
 *  restore can't race the canvas default-cascade effect (#642). */
export const InitialTerminalMetadataSchema = z.object({
  themeName: z.string().optional(),
  canvasLayout: CanvasLayoutSchema.optional(),
  subPanel: SubPanelStateSchema.optional(),
});

export const TerminalCreateInputSchema = z
  .object({
    cwd: z.string().optional(),
    parentId: TerminalIdSchema.optional(),
  })
  .merge(InitialTerminalMetadataSchema);

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

export const ServerInfoSchema = z.object({
  hostname: z.string(),
  /** Unique ID for this server process — changes on restart. */
  processId: z.string().uuid(),
});

/** One active fs.watch instance the server is currently holding. The
 *  diagnostic dialog enumerates these one-per-row instead of folding
 *  them into a count, so a reader can see exactly which terminal /
 *  session / shared singleton each handle belongs to. */
export const ServerWatchInstanceSchema = z.object({
  /** Free-form per-instance label, e.g. `term-abcd · myrepo (main)` for
   *  a `git-head` instance, or `term-xy · session-zw · ~/projects/foo`
   *  for a Claude transcript watcher. */
  label: z.string(),
  /** Optional secondary detail for the row (e.g. fan-out subscribers
   *  on a shared singleton watcher). Absent for self-explanatory rows. */
  detail: z.string().optional(),
});

/** Categorical view of active server-side watchers — one group per
 *  category, with one row per actual fs.watch instance inside.
 *
 *  Server emits facts only (kind, category description, per-instance
 *  labels). The client composes any prose. No pluralization or other
 *  UI rendering rides in the wire shape. */
export const ServerWatchSchema = z.object({
  /** Stable identifier for the watch category, e.g. `git-head`,
   *  `claude-transcript`, `agent-external:claude-code`. */
  kind: z.string(),
  /** Static, run-time-data-free description for the diagnostic dialog. */
  description: z.string(),
  /** One entry per active fs.watch handle in this category. Singleton
   *  kinds (`agent-external:*`) produce exactly one entry; per-instance
   *  kinds produce N entries. */
  instances: z.array(ServerWatchInstanceSchema),
});

export const ServerDiagnosticsSchema = z.object({
  /** Process uptime in milliseconds. */
  uptimeMs: z.number(),
  /** `process.version` (e.g. `v22.11.0`). */
  nodeVersion: z.string(),
  /** Bytes from `process.memoryUsage()`. */
  memory: z.object({
    rss: z.number(),
    heapUsed: z.number(),
    heapTotal: z.number(),
    external: z.number(),
    arrayBuffers: z.number(),
  }),
  /** Subsystem-level counts already collected by the heap-leak diag log. */
  subsystems: z.object({
    terminals: z.number().int().nonnegative(),
    publisherChannels: z.number().int().nonnegative(),
    pendingSummaryFetches: z.number().int().nonnegative(),
  }),
  /** Categorical view of active server-side watchers. */
  watches: z.array(ServerWatchSchema),
});
export type ServerDiagnostics = z.infer<typeof ServerDiagnosticsSchema>;

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

/**
 * On-disk snapshot of a terminal. Exactly the persisted fields plus a
 * stable `id` for cross-referencing parents. Derived mechanically from
 * `PersistedTerminalFieldsSchema` — adding a persisted field to
 * `TerminalMetadataSchema` automatically rides through here.
 *
 * Within-group ordering is the array index; the server writes terminals
 * in `Map` insertion order (stable per ES2015) and restore replays that
 * order verbatim.
 */
export const SavedTerminalSchema = PersistedTerminalFieldsSchema.extend({
  /** Stable ID within this session (original terminal UUID at save time). */
  id: z.string(),
});

export const SavedSessionSchema = z.object({
  terminals: z.array(SavedTerminalSchema),
  /** Which terminal was active at save time. */
  activeTerminalId: z.string().nullable().optional(),
  savedAt: z.number(),
});

// --- User preferences (server-side, shared with client) ---

export const ColorSchemeSchema = z.enum(["light", "dark", "system"]);

/** Sub-view of the Code tab: local/branch diff modes or the file browser. */
export const CodeTabViewSchema = z.enum(["local", "branch", "browse"]);
export type CodeTabView = z.infer<typeof CodeTabViewSchema>;

/** Active tab of the right panel. A discriminated union so illegal pairings
 *  ("inspector with a code mode attached") can't be represented. The Inspector
 *  tab carries no sub-state; the Code tab carries its current mode. */
export const RightPanelTabSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inspector") }),
  z.object({ kind: z.literal("code"), mode: CodeTabViewSchema }),
]);
export type RightPanelTab = z.infer<typeof RightPanelTabSchema>;
export type RightPanelTabKind = RightPanelTab["kind"];

export const RightPanelPrefsSchema = z.object({
  collapsed: z.boolean(),
  size: z.number(),
  tab: RightPanelTabSchema,
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
  /** Renderer policy. `auto` lets the system choose (WebGL on the focused+
   *  visible tile, DOM elsewhere — Chrome's per-tab GL context budget makes
   *  WebGL-everywhere unsafe at scale). `webgl` forces WebGL on every tile
   *  (higher throughput, but reintroduces the #575 context-budget risk with
   *  many terminals). `dom` forces DOM everywhere, eliminating the font-
   *  rendering shift on focus swap at the cost of WebGL throughput. */
  terminalRenderer: z.enum(["auto", "webgl", "dom"]),
  rightPanel: RightPanelPrefsSchema,
});

// --- Activity feed (server-derived, append + MRU evict) ---

/** Server-derived activity feed: recent repos cd'd into and recent agent
 *  CLIs spotted via OSC 633;E. Server is sole writer; client is read-only. */
export const ActivityFeedSchema = z.object({
  recentRepos: z.array(RecentRepoSchema),
  recentAgents: z.array(RecentAgentSchema),
});

/** Preference patch — top-level fields are optional; nested objects are deep-partial. */
export const PreferencesPatchSchema = PreferencesSchema.omit({
  rightPanel: true,
})
  .partial()
  .extend({ rightPanel: RightPanelPrefsSchema.partial().optional() });

// --- Derived types ---

export type TerminalInfo = z.infer<typeof TerminalInfoSchema>;
export type TerminalId = TerminalInfo["id"];

export type TaskProgress = z.infer<typeof TaskProgressSchema>;
export type AgentKind = z.infer<typeof AgentKindSchema>;
export type AgentInfo = z.infer<typeof AgentInfoSchema>;
export type ClaudeCodeInfo = z.infer<typeof ClaudeCodeInfoSchema>;
export type CodexInfo = z.infer<typeof CodexInfoSchema>;
export type OpenCodeInfo = z.infer<typeof OpenCodeInfoSchema>;
export type Foreground = z.infer<typeof ForegroundSchema>;
export type TerminalServerMetadata = z.infer<
  typeof TerminalServerMetadataSchema
>;
export type TerminalClientMetadata = z.infer<
  typeof TerminalClientMetadataSchema
>;
export type TerminalMetadata = z.infer<typeof TerminalMetadataSchema>;
export type InitialTerminalMetadata = z.infer<
  typeof InitialTerminalMetadataSchema
>;
export type RecentRepo = z.infer<typeof RecentRepoSchema>;
export type RecentAgent = z.infer<typeof RecentAgentSchema>;
export type PersistedTerminalFields = z.infer<
  typeof PersistedTerminalFieldsSchema
>;
export type LiveTerminalFields = z.infer<typeof LiveTerminalFieldsSchema>;
export type SavedTerminal = z.infer<typeof SavedTerminalSchema>;
export type SavedSession = z.infer<typeof SavedSessionSchema>;
export type ColorScheme = z.infer<typeof ColorSchemeSchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;
export type PreferencesPatch = z.infer<typeof PreferencesPatchSchema>;
export type ActivityFeed = z.infer<typeof ActivityFeedSchema>;

// --- Terminal identity keys ---
// Canonical `(group, label)` projection + collision-suffix computation.
// Extracted into its own module so the schema grab-bag here stays scoped
// to types; re-exported for caller convenience.
export {
  computeTerminalKeys,
  type TerminalIdentity,
  type TerminalKey,
  terminalKey,
} from "./terminalKey";

// --- Path helpers ---
export { cwdBasename, shortenCwd } from "./path";
