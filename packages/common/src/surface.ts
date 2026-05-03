/**
 * Kolu's typed reactive surface — every Cell, Collection, Stream, and Event
 * the app exposes, declared in one `defineSurface(...)` call. Plus the
 * domain schemas the surface is built from and the runtime types lifted
 * out of those schemas via `SurfaceTypes`.
 *
 * One module owns the surface domain end-to-end: schemas → spec →
 * inferred types. Sub-schemas (Persisted/Live/Server/Client terminal
 * fields, agent + git + PR sub-types, UI enums) live here too because
 * they're the building blocks `PreferencesSchema` /
 * `TerminalMetadataSchema` / `ActivityFeedSchema` are composed from —
 * splitting them across files would just re-fragment the same domain.
 *
 * Raw oRPC procedure I/O schemas (`TerminalCreateInputSchema`,
 * `ServerInfoSchema`, …) live in `./contract` next to the contract literal
 * that consumes them. External integration schemas (kolu-git, kolu-github,
 * kolu-claude-code, …) re-export from `./integrations`.
 *
 * The surface produces the `surface.*` portion of the contract. Raw oRPC
 * (`terminal.create/kill/attach/...`, `git.worktreeCreate/...`,
 * `server.info`) lives in `./contract` alongside, composed via spread.
 *
 * Cell names align with persisted `Conf` keys so `confStore("preferences")`
 * / `confStore("activityFeed")` / `confStore("session")` continue working
 * without a migration ladder.
 */

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import { TaskProgressSchema } from "anyagent/schemas";
import { ClaudeCodeInfoSchema } from "kolu-claude-code/schemas";
import { CodexInfoSchema } from "kolu-codex/schemas";
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
import { PrResultSchema } from "kolu-github/schemas";
import { OpenCodeInfoSchema } from "kolu-opencode/schemas";
import { z } from "zod";

// ── Sub-schemas — terminal identity, agent, foreground, layout ────────

export const TerminalIdSchema = z.string().uuid();

export const AgentKindSchema = z.enum(["claude-code", "codex", "opencode"]);

export const AgentInfoSchema = z.discriminatedUnion("kind", [
  ClaudeCodeInfoSchema,
  CodexInfoSchema,
  OpenCodeInfoSchema,
]);

/** Foreground process info from PTY. */
export const ForegroundSchema = z.object({
  /** Binary name (e.g. "vim", "claude", "opencode"). */
  name: z.string(),
  /** Raw terminal title from OSC 0/2 (e.g. "user@host: ~/code", "vim file.ts"). */
  title: z.string().nullable(),
});

export const CanvasLayoutSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

export const SubPanelStateSchema = z.object({
  collapsed: z.boolean(),
  panelSize: z.number(),
});

// ── Terminal metadata fields, organized by write-authority + persistence ──

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

/** Client-owned metadata supplied at create time. Seeded onto the new
 *  terminal's `meta` before the first `terminal.list` yield, so session
 *  restore can't race the canvas default-cascade effect (#642). */
export const InitialTerminalMetadataSchema = z.object({
  themeName: z.string().optional(),
  canvasLayout: CanvasLayoutSchema.optional(),
  subPanel: SubPanelStateSchema.optional(),
});

// ── Terminal cell value + raw-procedure shared schemas ────────────────

export const TerminalInfoSchema = z.object({
  id: TerminalIdSchema,
  pid: z.number(),
  meta: TerminalMetadataSchema,
});

/** Shared by both `terminal.attach` (raw oRPC streaming) and the
 *  `terminalExit` event (surface). Single key shape so consumers don't
 *  have to remember which side defines it. */
export const TerminalAttachInputSchema = z.object({ id: TerminalIdSchema });
export const TerminalOnExitOutputSchema = z.number();

// ── Activity feed sub-schemas ─────────────────────────────────────────

export const RecentRepoSchema = z.object({
  repoRoot: z.string(),
  repoName: z.string(),
  lastSeen: z.number(),
});

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

/** Server-derived activity feed: recent repos cd'd into and recent agent
 *  CLIs spotted via OSC 633;E. Server is sole writer; client is read-only. */
export const ActivityFeedSchema = z.object({
  recentRepos: z.array(RecentRepoSchema),
  recentAgents: z.array(RecentAgentSchema),
});

// ── Session persistence ───────────────────────────────────────────────

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

// ── User preferences (server-side, shared with client) ────────────────

export const ColorSchemeSchema = z.enum(["light", "dark", "system"]);

/** Sub-view of the Code tab: local/branch diff modes or the file browser. */
export const CodeTabViewSchema = z.enum(["local", "branch", "browse"]);

/** Which tab is currently displayed in the right panel. */
export const RightPanelTabKindSchema = z.enum(["inspector", "code"]);

/** Right-panel preferences. `activeTab` and `codeMode` live as flat fields so
 *  the storage layer's shallow merge is correct — Solid's `setStore` deep-merge
 *  cannot preserve discriminated-union variant invariants without a per-path
 *  `reconcile` escape hatch. Storing `codeMode` independently of `activeTab`
 *  also lets the Code tab restore its last sub-mode when the user toggles
 *  back from Inspector. The DU view (`{ kind: "inspector" } | { kind: "code",
 *  mode }`) is exposed via `rightPanelView()` for ergonomic pattern-matching
 *  at use sites. */
export const RightPanelPrefsSchema = z.object({
  collapsed: z.boolean(),
  size: z.number(),
  activeTab: RightPanelTabKindSchema,
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
  /** Renderer policy. `auto` lets the system choose (WebGL on the focused+
   *  visible tile, DOM elsewhere — Chrome's per-tab GL context budget makes
   *  WebGL-everywhere unsafe at scale). `webgl` forces WebGL on every tile
   *  (higher throughput, but reintroduces the #575 context-budget risk with
   *  many terminals). `dom` forces DOM everywhere, eliminating the font-
   *  rendering shift on focus swap at the cost of WebGL throughput. */
  terminalRenderer: z.enum(["auto", "webgl", "dom"]),
  rightPanel: RightPanelPrefsSchema,
});

/** Preference patch — top-level fields are optional; nested objects are deep-partial. */
export const PreferencesPatchSchema = PreferencesSchema.omit({
  rightPanel: true,
})
  .partial()
  .extend({ rightPanel: RightPanelPrefsSchema.partial().optional() });

// ── Schema-derived domain types — single source of truth via SurfaceTypes ──
//
// Most of Kolu's domain types fall into two buckets:
//
//   - **Surface entries**: `Preferences`, `ActivityFeed`, `TerminalMetadata`,
//     `SavedSession`, `TerminalInfo`. Lifted off `surface.spec` below via
//     `SurfaceTypes` so the surface declaration is the only place the
//     types are derived from schemas.
//   - **Sub-schema types**: `AgentInfo`, `Foreground`, `RecentRepo`, …
//     These aren't surface entries themselves — they're building blocks
//     of one. `z.infer<typeof Schema>` here keeps the wiring local.

export type AgentKind = z.infer<typeof AgentKindSchema>;
export type AgentInfo = z.infer<typeof AgentInfoSchema>;
export type ClaudeCodeInfo = z.infer<typeof ClaudeCodeInfoSchema>;
export type CodexInfo = z.infer<typeof CodexInfoSchema>;
export type OpenCodeInfo = z.infer<typeof OpenCodeInfoSchema>;
export type Foreground = z.infer<typeof ForegroundSchema>;
export type CanvasLayout = z.infer<typeof CanvasLayoutSchema>;
export type TerminalServerMetadata = z.infer<
  typeof TerminalServerMetadataSchema
>;
export type TerminalClientMetadata = z.infer<
  typeof TerminalClientMetadataSchema
>;
export type InitialTerminalMetadata = z.infer<
  typeof InitialTerminalMetadataSchema
>;
export type PersistedTerminalFields = z.infer<
  typeof PersistedTerminalFieldsSchema
>;
export type LiveTerminalFields = z.infer<typeof LiveTerminalFieldsSchema>;
export type RecentRepo = z.infer<typeof RecentRepoSchema>;
export type RecentAgent = z.infer<typeof RecentAgentSchema>;
export type SavedTerminal = z.infer<typeof SavedTerminalSchema>;
export type ColorScheme = z.infer<typeof ColorSchemeSchema>;
export type CodeTabView = z.infer<typeof CodeTabViewSchema>;
export type RightPanelTabKind = z.infer<typeof RightPanelTabKindSchema>;

/** Discriminated-union view of the right panel's active tab. Derived from the
 *  flat `activeTab` + `codeMode` storage shape — see `rightPanelView()`. Use
 *  this for pattern matching at consumption sites; never write code that
 *  matches on `activeTab` and reads `codeMode` separately. */
export type RightPanelTab =
  | { kind: "inspector" }
  | { kind: "code"; mode: CodeTabView };

export type TaskProgress = z.infer<typeof TaskProgressSchema>;

/** Default preference values — single source of truth for server and client. */
export const DEFAULT_PREFERENCES: z.infer<typeof PreferencesSchema> = {
  seenTips: [],
  startupTips: true,
  shuffleTheme: true,
  scrollLock: true,
  activityAlerts: true,
  colorScheme: "dark",
  terminalRenderer: "auto",
  rightPanel: {
    collapsed: true,
    size: 0.25,
    activeTab: "inspector",
    codeMode: "local",
  },
};

/** Project the flat `RightPanelPrefs` shape onto its DU view. Storage stays
 *  flat (Solid's setStore shallow-merges correctly); use sites get the
 *  exhaustive-match-friendly DU. */
export function rightPanelView(p: {
  activeTab: RightPanelTabKind;
  codeMode: CodeTabView;
}): RightPanelTab {
  return p.activeTab === "inspector"
    ? { kind: "inspector" }
    : { kind: "code", mode: p.codeMode };
}

// `applyPreferencesPatch` references `Preferences` / `PreferencesPatch`
// before the surface is built, so we lift them off the schemas directly
// here. The post-`defineSurface` re-exports below derive the same types
// via `SurfaceTypes` for the public surface — same identity, single
// source of truth at the spec.
type _Preferences = z.infer<typeof PreferencesSchema>;
type _PreferencesPatch = z.infer<typeof PreferencesPatchSchema>;

/** Pure merge of a `PreferencesPatch` into the current preferences.
 *  `rightPanel` is deep-merged so callers can patch a single nested field
 *  without supplying the rest of the object. Lives on the surface spec
 *  (`cells.preferences.patch`) so server (`implementSurface`) and client
 *  (`surfaceClient`'s default `applyPatch`) reach the same logic without
 *  a duplicate import. */
export function applyPreferencesPatch(
  current: _Preferences,
  patch: _PreferencesPatch,
): _Preferences {
  const { rightPanel: rpPatch, ...rest } = patch;
  return {
    ...current,
    ...rest,
    ...(rpPatch !== undefined && {
      rightPanel: { ...current.rightPanel, ...rpPatch },
    }),
  };
}

// ── The surface ───────────────────────────────────────────────────────

export const surface = defineSurface({
  cells: {
    /** User preferences — local-authority on the client; server-canonical
     *  on disk. Storage is flat (no discriminated-union subtrees), so the
     *  spec's `patch` is the only merge path — both server and client run
     *  it via `applyPatch` defaulting from the spec. */
    preferences: {
      schema: PreferencesSchema,
      default: DEFAULT_PREFERENCES,
      patchSchema: PreferencesPatchSchema,
      patch: applyPreferencesPatch,
      // `test__set` exposed for e2e fixtures.
      verbs: ["get", "patch", "test__set"],
    },

    /** Server-derived activity feed (recent repos + recent agents).
     *  Read-only on the client; the server is the sole writer via
     *  `trackRecentRepo` / `trackRecentAgent`. */
    activityFeed: {
      schema: ActivityFeedSchema,
      default: { recentRepos: [], recentAgents: [] } satisfies z.infer<
        typeof ActivityFeedSchema
      >,
      verbs: ["get", "test__set"],
    },

    /** Last persisted snapshot of terminals + active id, or null when no
     *  session is saved. Read-only on the client; the server's debounced
     *  autosave loop owns writes. */
    session: {
      schema: SavedSessionSchema.nullable(),
      default: null as z.infer<typeof SavedSessionSchema> | null,
      verbs: ["get", "test__set"],
    },

    /** Live list of terminals — server-driven on create/kill. Mutations
     *  go through dedicated procedures (`terminal.create`/`kill`/`killAll`)
     *  in the raw oRPC namespace, not via cell.set. */
    terminalList: {
      schema: z.array(TerminalInfoSchema),
      default: [] as z.infer<typeof TerminalInfoSchema>[],
      verbs: ["get"],
    },
  },
  collections: {
    /** Per-terminal metadata (cwd, git, PR, agent status). Each terminal
     *  is independently observable; mutations come from server-side
     *  providers writing through the publisher channel — clients don't
     *  call `upsert` on this collection directly. */
    terminalMetadata: {
      keySchema: TerminalIdSchema,
      schema: TerminalMetadataSchema,
      // Only the streaming reads are exposed; writes are server-internal.
      verbs: ["keys", "get"],
    },
  },
  streams: {
    /** Live changed-files list for the Code-view's Local/Branch modes. */
    gitStatus: {
      inputSchema: GitStatusInputSchema,
      outputSchema: GitStatusOutputSchema,
    },
    /** Live unified diff for one file. */
    gitDiff: {
      inputSchema: GitDiffInputSchema,
      outputSchema: GitDiffOutputSchema,
    },
    /** Live repo-relative path list (tracked + untracked-but-not-ignored). */
    fsListAll: {
      inputSchema: FsListAllInputSchema,
      outputSchema: FsListAllOutputSchema,
    },
    /** Live UTF-8 content for a single file in the Code-view's All-mode body. */
    fsReadFile: {
      inputSchema: FsReadFileInputSchema,
      outputSchema: FsReadFileOutputSchema,
    },
  },
  events: {
    /** Terminal process exited — fires once per terminal lifetime with the
     *  exit code. Drives the exit toast and the active-terminal auto-switch
     *  in `useTerminals`. */
    terminalExit: {
      inputSchema: TerminalAttachInputSchema,
      outputSchema: TerminalOnExitOutputSchema,
    },
  },
});

// ── Inferred runtime types — surface-bound, via SurfaceTypes ──────────
// `Surface` lifts `z.infer<schema>` over the spec so consumers reach for
// `Surface["cells"]["preferences"]["Value"]` etc. The flat aliases below
// are the conventional re-exports for the surface entries that Kolu code
// references by name across packages.

export type Surface = SurfaceTypes<typeof surface.spec>;

export type Preferences = Surface["cells"]["preferences"]["Value"];
export type PreferencesPatch = Surface["cells"]["preferences"]["Patch"];
export type ActivityFeed = Surface["cells"]["activityFeed"]["Value"];
export type TerminalMetadata =
  Surface["collections"]["terminalMetadata"]["Value"];
export type TerminalInfo = z.infer<typeof TerminalInfoSchema>;
export type TerminalId = TerminalInfo["id"];
export type SavedSession = z.infer<typeof SavedSessionSchema>;
