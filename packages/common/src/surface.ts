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
import type { TaskProgressSchema } from "anyagent/schemas";
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

/** Sub-view of the Code tab: local/branch diff modes or the file browser. */
export const CodeTabViewSchema = z.enum(["local", "branch", "browse"]);

/** Which tab is currently displayed in the right panel. */
export const RightPanelTabKindSchema = z.enum(["inspector", "code"]);

/** Per-terminal right-panel state — which tab is open, which sub-mode
 *  the Code tab is in, and which file the user last selected in each
 *  mode. The three fields move together because they are *about* the
 *  terminal's task (reviewing branch X, browsing repo, inspecting agent
 *  output) — switching terminals should restore them as a unit.
 *
 *  `selectedFileByMode` is per-mode so flipping between local↔branch↔browse
 *  within a single terminal keeps each mode's last-viewed file, mirroring
 *  the prior `(repo, mode)`-keyed localStorage slot behaviour.
 *
 *  Storage is flat (`activeTab` + `codeMode` as parallel fields) so Solid's
 *  shallow-merge `setStore` is correct. Consumption should go through the
 *  `rightPanelView()` DU projection — pattern-matching on `activeTab` /
 *  `codeMode` separately leaks the storage shape across the DU seam and
 *  defeats the "codeMode survives Inspector toggle" invariant. */
export const RightPanelPerTerminalStateSchema = z.object({
  activeTab: RightPanelTabKindSchema,
  codeMode: CodeTabViewSchema,
  /** Repo-relative file paths keyed by Code-tab sub-mode. Absence of a
   *  key means "no selection" for that mode. */
  selectedFileByMode: z
    .object({
      local: z.string().optional(),
      branch: z.string().optional(),
      browse: z.string().optional(),
    })
    .optional(),
});

// ── Terminal metadata fields, organized by write-authority + persistence ──
//
// Invariant: every terminal-metadata field appears in EXACTLY ONE of
// `ServerPersistedTerminalFieldsSchema`, `ClientPersistedTerminalFieldsSchema`,
// or `LiveTerminalFieldsSchema`. The three schemas partition the
// `TerminalMetadata` field set; their merge (in `TerminalMetadataSchema`
// below) is the wire shape.
//
// Adding a field misclassifies in one of two failure modes:
//   - Persisted base, but written through the live update helper →
//     compile error (the live mutator type excludes it).
//   - Live base, but written through the persisting update helper →
//     compile error (the persisting mutator types exclude it).
//
// Misclassifying a NEW field (declaring it on the wrong base) is the
// only silent failure mode — choose the base on the first axis: "must
// this survive a process restart?" If yes → one of the persisted
// schemas; if no → `LiveTerminalFieldsSchema`. Then on the second
// axis: "is this written by a server-side provider or by a client RPC
// handler?" That picks server-persisted vs client-persisted.

/**
 * Server-persisted fields — written by server-side metadata providers
 * (via `updateServerMetadata`) and round-tripped through disk. The
 * "server-writes + persisted" intersection, declared structurally.
 *
 * Disjoint from `ClientPersistedTerminalFieldsSchema` and
 * `LiveTerminalFieldsSchema`. See the partition comment above.
 */
export const ServerPersistedTerminalFieldsSchema = z.object({
  cwd: z.string(),
  git: GitInfoSchema.nullable(),
  /** Normalized agent CLI invocation last observed in this terminal (e.g.
   *  `"claude --model sonnet"`). Preserved across intervening non-agent
   *  input; drives the "resume agent on restore" offer in EmptyState.
   *  Absent for terminals that never ran a known agent. */
  lastAgentCommand: z.string().optional(),
  /** Workspace-switcher recency key: epoch-millis of the last agent
   *  semantic-key transition (`kind`/`sessionId`/`state`). Idle terminals
   *  stay at `0` and fall back to canvas position. */
  lastActivityAt: z.number().default(0),
});

/**
 * Client-persisted fields — written by client RPCs (via
 * `updateClientMetadata`, or direct mutation for paths that intentionally
 * skip the publish like sub-panel state) and round-tripped through disk.
 * The "client-writes + persisted" intersection, declared structurally.
 *
 * Disjoint from `ServerPersistedTerminalFieldsSchema` and
 * `LiveTerminalFieldsSchema`. See the partition comment above.
 */
export const ClientPersistedTerminalFieldsSchema = z.object({
  themeName: z.string().min(1).optional(),
  /** If set, this terminal is a sub-terminal of the given parent. */
  parentId: z.string().optional(),
  /** Canvas tile position/size — client-reported, used for session restore. */
  canvasLayout: CanvasLayoutSchema.optional(),
  /** Sub-panel collapsed/size state — client-reported, used for session restore. */
  subPanel: SubPanelStateSchema.optional(),
  /** Right-panel per-terminal state — client-reported. Holds the fields
   *  that are *about* the terminal's task (active tab, code sub-mode,
   *  per-mode file selection). The remaining right-panel fields (collapsed,
   *  size, codeTabTreeSize) stay on preferences as workspace-level chrome. */
  rightPanel: RightPanelPerTerminalStateSchema.optional(),
  /** User-set freeform annotation — multiline markdown. The first line
   *  doubles as a glanceable tag (rendered as a chip next to the repo
   *  name and painted onto the dock rail swatch); the full body shows
   *  in the canvas-tile top-border pill, the dock-awaiting card, the
   *  workspace switcher card, and the intent editor. Empty / undefined
   *  collapses every render site to its no-intent shape. */
  intent: z.string().min(1).optional(),
});

/**
 * Fields that only exist on a live terminal — transient status fed by
 * external state and never persisted. If a field is here, a session
 * restore must re-derive it; if a field is on one of the persisted
 * schemas, it round-trips through disk as-is.
 *
 * Disjoint from `ServerPersistedTerminalFieldsSchema` and
 * `ClientPersistedTerminalFieldsSchema`. See the partition comment
 * above. Writes go through `updateServerLiveMetadata`, which does NOT
 * fire `terminals:dirty` — that's how the agent-stream firehose is
 * kept off the autosave channel.
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
 * Every field that rides to disk. Disjoint union of the two
 * write-authority persisted bases — `SavedTerminal` just adds `id` to
 * this shape. Adding a persisted field is a one-place change on
 * whichever base owns it (server vs client). Live fields don't
 * participate.
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
 *  restore can't race the canvas default-cascade effect (#642).
 *
 *  `lastActivityAt` is technically a server-derived field, but session
 *  restore is the one client-driven path with truth about its prior
 *  value (read from the saved session blob). Threading it through here
 *  keeps recency ordering stable across restart — without it,
 *  `createMetadata` would reset every restored terminal to `0`. */
export const InitialTerminalMetadataSchema = z.object({
  themeName: z.string().min(1).optional(),
  canvasLayout: CanvasLayoutSchema.optional(),
  subPanel: SubPanelStateSchema.optional(),
  rightPanel: RightPanelPerTerminalStateSchema.optional(),
  lastActivityAt: z.number().optional(),
  intent: z.string().min(1).optional(),
});

// ── Terminal cell value + raw-procedure shared schemas ────────────────

/** Wire shape for the `terminalList` cell. Identity only — metadata
 *  flows through the `terminalMetadata` collection. */
export const TerminalInfoSchema = z.object({
  id: TerminalIdSchema,
  pid: z.number(),
});

/** Shared by both `terminal.attach` (raw oRPC streaming) and the
 *  `terminalExit` event (surface). Single key shape so consumers don't
 *  have to remember which side defines it. */
export const TerminalAttachInputSchema = z.object({ id: TerminalIdSchema });
export const TerminalOnExitOutputSchema = z.number();

// ── Local PTY-host daemon status ──────────────────────────────────────

/** Status of the kolu local PTY-host daemon, as observed by
 *  kolu-server. Read-only on the client (the chrome-bar dot reads
 *  this); kolu-server is the sole writer at boot, on socket close,
 *  and on heartbeat. */
export const LocalPtyDaemonStatusSchema = z.object({
  /** Lifecycle stage:
   *   - `starting` — supervisor is spawning / connecting
   *   - `ready`    — connected, version handshake complete
   *   - `down`     — socket dropped; reconnect not yet completed */
  state: z.enum(["starting", "ready", "down"]),
  /** Daemon process PID (post-handshake). */
  pid: z.number().int().optional(),
  /** Daemon's `agentSurface` contract version (e.g. "1.0"). */
  contractVersion: z.string().optional(),
  /** Unix socket path the daemon is bound to. */
  socketPath: z.string().optional(),
  /** Epoch ms at which kolu-server last observed the daemon as live. */
  lastSeenAt: z.number().optional(),
  /** Running daemon's own package version (post-handshake). */
  pkgVersion: z.string().optional(),
  /** kolu-server's package version at handshake time. Paired with
   *  `pkgVersion` so the client can render "running X, server Y". */
  serverPkgVersion: z.string().optional(),
  /** True when the running daemon's `pkgVersion` differs from the
   *  server's while the wire contract is still compatible: the daemon
   *  survived a deploy and is serving stale code. Drives the amber
   *  "update pending" nudge on the chrome-bar dot — restart to apply. */
  outdated: z.boolean().optional(),
});

export type LocalPtyDaemonStatus = z.infer<typeof LocalPtyDaemonStatusSchema>;

export const DEFAULT_LOCAL_PTY_DAEMON_STATUS: LocalPtyDaemonStatus = {
  state: "starting",
};

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

/** Right-panel preferences — workspace-level layout chrome. The fields
 *  *about* what each terminal is doing (active tab, code sub-mode,
 *  selected file) live on `RightPanelPerTerminalStateSchema` against the
 *  terminal record, not here. Splitting follows the volatility seam: panel
 *  width and tree-pane split are tuned once and stay put; active tab and
 *  code-mode flip per terminal task. */
export const RightPanelPrefsSchema = z.object({
  collapsed: z.boolean(),
  size: z.number(),
  /** Vertical split fraction (0–1) inside the Code tab: tree pane occupies
   *  this share, content pane gets the rest. Persisted so layout survives
   *  reload, mirroring the horizontal `size` field's behavior. */
  codeTabTreeSize: z.number(),
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
export type ServerPersistedTerminalFields = z.infer<
  typeof ServerPersistedTerminalFieldsSchema
>;
export type RecentRepo = z.infer<typeof RecentRepoSchema>;
export type RecentAgent = z.infer<typeof RecentAgentSchema>;
export type SavedTerminal = z.infer<typeof SavedTerminalSchema>;
export type ColorScheme = z.infer<typeof ColorSchemeSchema>;
export type CodeTabView = z.infer<typeof CodeTabViewSchema>;
export type RightPanelTabKind = z.infer<typeof RightPanelTabKindSchema>;
export type RightPanelPerTerminalState = z.infer<
  typeof RightPanelPerTerminalStateSchema
>;

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
    codeTabTreeSize: 0.35,
  },
};

/** Default per-terminal right-panel state — seeded into the in-memory
 *  store when a terminal has no `rightPanel` record yet (fresh terminals,
 *  or terminals from a session predating this schema). */
export const DEFAULT_RIGHT_PANEL_PER_TERMINAL: z.infer<
  typeof RightPanelPerTerminalStateSchema
> = {
  activeTab: "inspector",
  codeMode: "local",
};

/** Project the flat `RightPanelPerTerminalState` shape onto its DU view.
 *  Storage stays flat (Solid's setStore shallow-merges correctly); use sites
 *  get the exhaustive-match-friendly DU. */
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

    /** Local PTY-host daemon status. Read-only on the client; the
     *  chrome-bar daemon dot subscribes here. Written by kolu-server's
     *  supervisor at boot + on socket close. */
    localPtyDaemon: {
      schema: LocalPtyDaemonStatusSchema,
      default: DEFAULT_LOCAL_PTY_DAEMON_STATUS,
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
