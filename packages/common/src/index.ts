// Shared types for kolu server↔client communication.
// Zod schemas are the single source of truth; TS types are derived.
// Integration packages define their own schemas (e.g. kolu-claude-code,
// kolu-git); this module re-exports them and composes aggregate types.

import { z } from "zod";
import { match } from "ts-pattern";
import { TaskProgressSchema } from "anyagent";
import { ClaudeCodeInfoSchema } from "kolu-claude-code";
import { CodexInfoSchema } from "kolu-codex";
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
export {
  TaskProgressSchema,
  ClaudeCodeInfoSchema,
  CodexInfoSchema,
  OpenCodeInfoSchema,
};

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
// Owned by kolu-github (mirrors the kolu-git re-export pattern above). The
// `kolu-common/pr` subpath also re-exports these for browser clients that
// want to avoid pulling kolu-claude-code → @anthropic-ai/claude-agent-sdk.
import {
  GitHubCheckStatusSchema,
  GitHubPrStateSchema,
  GitHubPrInfoSchema,
  PrResultSchema,
  GhUnavailableCodeSchema,
  GhUnavailableSchema,
  PrUnavailableSourceSchema,
  prValue,
  prUnavailableReason,
  prUnavailableSource,
  reasonForGhCode,
  reasonForSource,
} from "kolu-github/schemas";
export {
  GitHubCheckStatusSchema,
  GitHubPrStateSchema,
  GitHubPrInfoSchema,
  PrResultSchema,
  GhUnavailableCodeSchema,
  GhUnavailableSchema,
  PrUnavailableSourceSchema,
  prValue,
  prUnavailableReason,
  prUnavailableSource,
  reasonForGhCode,
  reasonForSource,
};
export type {
  GitHubPrInfo,
  PrResult,
  GhUnavailableCode,
  PrUnavailableSource,
} from "kolu-github/schemas";

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

/** Sub-view of the Code tab: local/branch diff modes or the file browser.
 *  Defined here so `PanelContentSchema` can refer to it before the
 *  preferences section. */
export const CodeTabViewSchema = z.enum(["local", "branch", "browse"]);
export type CodeTabView = z.infer<typeof CodeTabViewSchema>;

/** What lives in a single panel tab. Discriminated so illegal pairings
 *  can't be represented. Each kind+key pair is unique within a tile —
 *  e.g. one Inspector per tile, one Code+local per tile, one terminal
 *  per `id`. The unified primitive enforces this on insert. */
export const PanelContentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inspector") }),
  z.object({ kind: z.literal("code"), mode: CodeTabViewSchema }),
  z.object({ kind: z.literal("terminal"), id: TerminalIdSchema }),
  z.object({ kind: z.literal("browser"), url: z.string() }),
]);
export type PanelContent = z.infer<typeof PanelContentSchema>;
export type PanelContentKind = PanelContent["kind"];

/** A single panel slot — the UI region attached to one edge of a tile.
 *  Holds N tabs of `PanelContent`, plus the visible-tab index, fractional
 *  size (0..1 of the tile interior on its axis), and collapsed state. */
export const PanelSlotSchema = z.object({
  tabs: z.array(PanelContentSchema),
  active: z.number().int().nonnegative(),
  size: z.number(),
  collapsed: z.boolean(),
});
export type PanelSlot = z.infer<typeof PanelSlotSchema>;

/** Which edge of a tile a panel attaches to. */
export const PanelEdgeSchema = z.enum(["left", "right", "bottom"]);
export type PanelEdge = z.infer<typeof PanelEdgeSchema>;

/** Iteration order for the three slots — declared once so client and server
 *  walks stay in lockstep instead of repeating the literal in every loop. */
export const ALL_PANEL_EDGES: readonly PanelEdge[] = [
  "left",
  "right",
  "bottom",
] as const;

/** Per-terminal panels — at most one slot per edge. */
export const TerminalPanelsSchema = z.object({
  left: PanelSlotSchema.optional(),
  right: PanelSlotSchema.optional(),
  bottom: PanelSlotSchema.optional(),
});
export type TerminalPanels = z.infer<typeof TerminalPanelsSchema>;

/** Stable string key for a `PanelContent`, used to enforce per-tile
 *  uniqueness in both directions: the client de-dupes on insert (so a
 *  second click on "Open Inspector" surfaces the existing slot), and
 *  the server validates inbound `setPanels` payloads against the same
 *  key so a malformed RPC can't bypass the client's check. `match` over
 *  `switch` so a new variant added to `PanelContentSchema` fails compile
 *  here until it's keyed. */
export function panelContentKey(c: PanelContent): string {
  return match(c)
    .with({ kind: "inspector" }, () => "inspector")
    .with({ kind: "code" }, (x) => `code:${x.mode}`)
    .with({ kind: "terminal" }, (x) => `terminal:${x.id}`)
    .with({ kind: "browser" }, (x) => `browser:${x.url}`)
    .exhaustive();
}

/**
 * Server-derived metadata — populated by providers from external state
 * (git working tree, PTY foreground process, agent CLI transcripts).
 * Write authority: server-side metadata providers, via `updateServerMetadata`.
 */
export const TerminalServerMetadataSchema = z.object({
  cwd: z.string(),
  git: GitInfoSchema.nullable(),
  /** GitHub PR resolution — discriminated union (see PrResultSchema). */
  pr: PrResultSchema,
  /** AI coding agent status (Claude Code, OpenCode, etc.). */
  agent: AgentInfoSchema.nullable(),
  /** Foreground process name — detected via OSC 2 title change events. */
  foreground: ForegroundSchema.nullable(),
  /** Short id-prefix suffix ("#a3f2") rendered next to the name when ≥2
   *  terminals would otherwise collide on identity (same git repo+branch
   *  for git-aware terminals; same cwd for the rest). Computed server-side
   *  across the live terminal set so clients render a stable, agreed-upon
   *  suffix without re-deriving collisions per surface. */
  displaySuffix: z.string().optional(),
});

/**
 * Client-owned metadata — set by client RPC handlers, persisted server-side
 * for session restore and multi-client sync. Write authority: client RPCs,
 * via `updateClientMetadata` (or direct mutation for paths that intentionally
 * skip the metadata publish, like sub-panel state).
 */
export const TerminalClientMetadataSchema = z.object({
  themeName: z.string().optional(),
  /** If set, this terminal is a sub-terminal of the given parent. */
  parentId: z.string().optional(),
  /** Numeric ordering within the terminal's group (top-level or same parent). Higher = later. */
  sortOrder: z.number(),
  /** Canvas tile position/size — client-reported, used for session restore. */
  canvasLayout: CanvasLayoutSchema.optional(),
  /** Per-terminal panels — left/right/bottom slots, each with tabs of
   *  `PanelContent`. Client-reported via `setPanels`; persisted server-side
   *  for session restore and multi-client sync. */
  panels: TerminalPanelsSchema.optional(),
});

/**
 * Unified wire shape — merge of the server-derived and client-owned halves.
 * Flat for backwards-compat with existing consumers; code that only needs
 * one half should import the sub-schema so the dependency is explicit.
 */
export const TerminalMetadataSchema = TerminalServerMetadataSchema.merge(
  TerminalClientMetadataSchema,
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

export const TerminalSetPanelsInputSchema = z.object({
  id: TerminalIdSchema,
  panels: TerminalPanelsSchema,
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
  panels: TerminalPanelsSchema.optional(),
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
  /** Per-terminal panels at save time. */
  panels: TerminalPanelsSchema.optional(),
});

export const SavedSessionSchema = z.object({
  terminals: z.array(SavedTerminalSchema),
  /** Which terminal was active at save time. */
  activeTerminalId: z.string().nullable().optional(),
  savedAt: z.number(),
});

// --- User preferences (server-side, shared with client) ---

export const ColorSchemeSchema = z.enum(["light", "dark", "system"]);

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
});

// --- Activity feed (server-derived, append + MRU evict) ---

/** Server-derived activity feed: recent repos cd'd into and recent agent
 *  CLIs spotted via OSC 633;E. Server is sole writer; client is read-only. */
export const ActivityFeedSchema = z.object({
  recentRepos: z.array(RecentRepoSchema),
  recentAgents: z.array(RecentAgentSchema),
});

/** Preference patch — top-level fields are optional. */
export const PreferencesPatchSchema = PreferencesSchema.partial();

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
export type SavedTerminal = z.infer<typeof SavedTerminalSchema>;
export type SavedSession = z.infer<typeof SavedSessionSchema>;
export type ColorScheme = z.infer<typeof ColorSchemeSchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;
export type PreferencesPatch = z.infer<typeof PreferencesPatchSchema>;
export type ActivityFeed = z.infer<typeof ActivityFeedSchema>;
