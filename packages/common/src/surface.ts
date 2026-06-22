/**
 * Kolu's typed reactive surface — every Cell, Collection, Stream, and Event
 * the app exposes, declared in one `defineSurface(...)` call. Plus the
 * domain schemas the surface is built from and the runtime types lifted
 * out of those schemas via `SurfaceTypes`.
 *
 * One module owns the surface domain end-to-end: schemas → spec →
 * inferred types. The kolu-specific sub-schemas (Persisted/Live/Server/Client
 * terminal fields, UI enums) live here because they're the building blocks
 * `PreferencesSchema` / `TerminalMetadataSchema` / `ActivityFeedSchema` are
 * composed from — splitting them across files would just re-fragment the same
 * domain. The generic awareness sub-schemas (agent + PR sub-types, foreground,
 * terminal identity) are OWNED by `@kolu/terminal-awareness/schema` (P1a) and
 * re-exported below; kolu's terminal-field schemas EXTEND that base rather than
 * declare it.
 *
 * Raw oRPC procedure I/O schemas (`TerminalCreateInputSchema`,
 * `ServerInfoSchema`, …) live in `./contract` next to the contract literal
 * that consumes them. External integration schemas (kolu-git, anyforge,
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
import {
  type BuildInfo,
  defineBuildInfo,
  surfaceAppSurfaceWith,
} from "@kolu/surface-app/surface";
import { ENDPOINT_STATES } from "@kolu/surface-daemon-supervisor/states";
import {
  AwarenessLiveFieldsSchema,
  AwarenessPersistedFieldsSchema,
  PrResultSchema,
  TerminalIdSchema,
} from "@kolu/terminal-awareness/schema";
import type { TaskProgressSchema } from "anyagent/schemas";
import { type PrInfo, prValue } from "anyforge/schemas";
import {
  FsListAllInputSchema,
  FsListAllOutputSchema,
  FsReadFileInputSchema,
  FsReadFileOutputSchema,
  GitDiffInputSchema,
  GitDiffOutputSchema,
  GitStatusInputSchema,
  GitStatusOutputSchema,
} from "kolu-git/schemas";
import { z } from "zod";

// ── Re-exports — the awareness domain moved to @kolu/terminal-awareness (P1a) ──
//
// The generic awareness value (terminal identity, agent status, PR resolution,
// foreground) is OWNED by `@kolu/terminal-awareness/schema` now. kolu-common
// EXTENDS that base — adding `location` and the client/UI fields below — and
// re-exports the moved symbols so existing `kolu-common/surface` import sites
// are unchanged: the schema home inverted, the consumers didn't move.
export {
  AgentInfoSchema,
  AgentKindSchema,
  ForegroundSchema,
  PrResultSchema,
  PrUnavailableSourceSchema,
  prUnavailableReason,
  prUnavailableSource,
  reasonForSource,
} from "@kolu/terminal-awareness/schema";
export type {
  AgentInfo,
  AgentKind,
  ClaudeCodeInfo,
  CodexInfo,
  Foreground,
  OpenCodeInfo,
  PrResult,
  PrUnavailableSource,
  TerminalId,
} from "@kolu/terminal-awareness/schema";
export { TerminalIdSchema };

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

/**
 * Where a terminal's endpoint lives — a closed sum, not a host-id string.
 *
 * `{ kind: "local" }` is the in-process PTY (this kolu-server). `{ kind:
 * "remote", hostId }` is a dialed host (kaval-sessions). Modelling the local
 * case as a distinct *variant* — rather than a reserved `"local"` string in
 * the same namespace as remote host ids — makes a whole bug class
 * unrepresentable: a remote host that happens to be named `local` in
 * `~/.ssh/config` is `{ kind: "remote", hostId: "local" }`, which can never
 * be confused with the in-process endpoint `{ kind: "local" }`. `hostId`
 * matches the rest of the system's host-identity spelling (`getHostSession`,
 * the daemon-status keys).
 */
export const HostLocationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local") }),
  z.object({ kind: z.literal("remote"), hostId: z.string() }),
]);

export type HostLocation = z.infer<typeof HostLocationSchema>;

/** The in-process endpoint's location — the singleton `{ kind: "local" }`.
 *  `location` is never mutated after spawn (a terminal does not migrate
 *  hosts), so sharing this one value across every local terminal is safe and
 *  saves re-spelling the literal at each spawn/restore site. Frozen so the
 *  "never mutated" invariant is enforced at runtime, not just by convention:
 *  an accidental in-place write throws instead of silently aliasing every
 *  local terminal's metadata. */
export const LOCAL_LOCATION: HostLocation = Object.freeze({
  kind: "local",
} as const);

// ── Terminal metadata fields, organized by write-authority + persistence ──
//
// Invariant: every terminal-metadata field appears in EXACTLY ONE of
// `ServerPersistedTerminalFieldsSchema`, `ClientPersistedTerminalFieldsSchema`,
// or `LiveTerminalFieldsSchema`. The three schemas partition the persisted +
// live field set; the `state`/`sleptAt` DISCRIMINANT (see "the active |
// sleeping sum" below) is the one field group that rides ABOVE this partition
// rather than inside it. `TerminalMetadataSchema`'s arms are built from these
// bases: the `active` arm is persisted + live, the `sleeping` arm is persisted
// + `sleptAt`.
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
 * This is kolu's EXTENSION of the generic `AwarenessPersistedFieldsSchema`
 * (cwd · git · lastAgentCommand · lastActivityAt, owned by
 * `@kolu/terminal-awareness`): the awareness base plus the one kolu-specific
 * field, `location`. The schema home inverted in P1a — kolu's record is built
 * ON TOP of the awareness value, not the other way around.
 *
 * Disjoint from `ClientPersistedTerminalFieldsSchema` and
 * `LiveTerminalFieldsSchema`. See the partition comment above.
 */
export const ServerPersistedTerminalFieldsSchema =
  AwarenessPersistedFieldsSchema.merge(
    z.object({
      /** Where this terminal's endpoint lives — `{ kind: "local" }` for an
       *  in-process PTY, `{ kind: "remote", hostId }` for a dialed host (kaval-
       *  sessions). See `HostLocationSchema`. Non-optional and explicit by
       *  construction: a terminal's host is the value of this field, never the
       *  *absence* of a host id. So any code that **constructs** a terminal's
       *  metadata — spawn and host adoption — must name its host: a dropped
       *  location is a compile error there, not a silent local respawn against
       *  the wrong machine. (The client "Restore session" path re-creates
       *  terminals through the create seam, which deliberately omits `location`
       *  because the *endpoint* owns it; P3 replaces that path with
       *  dial-the-host + adopt-its-list, so remote terminals must not ship
       *  before then.) Set once at spawn and never mutated thereafter — a
       *  terminal does not migrate hosts — so although it rides this
       *  server-writable base, no provider writes it. This is the one kolu
       *  concept absent from the generic awareness value (a remote tool can't
       *  know its own kolu-side `hostId`). */
      location: HostLocationSchema,
    }),
  );

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
 * Identical to the generic `AwarenessLiveFieldsSchema` (pr · agent ·
 * foreground, owned by `@kolu/terminal-awareness`): no kolu-specific field
 * rides the live half (`location` is persisted, not live), so kolu aliases the
 * awareness live schema directly rather than re-declaring it.
 *
 * Disjoint from `ServerPersistedTerminalFieldsSchema` and
 * `ClientPersistedTerminalFieldsSchema`. See the partition comment
 * above. Writes go through `updateServerLiveMetadata`, which does NOT
 * fire `terminals:dirty` — that's how the agent-stream firehose is
 * kept off the autosave channel.
 */
export const LiveTerminalFieldsSchema = AwarenessLiveFieldsSchema;

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

// ── The active | sleeping sum ─────────────────────────────────────────
//
// A terminal is a discriminated union on `state`. The field partition above
// already expresses it: an ACTIVE terminal is the persisted base + the live
// overlay (agent · foreground · pr + the PTY/xterm handles); a SLEEPING
// terminal is the persisted base alone — its PTY/xterm/agent released — plus
// `sleptAt`.
//
// `state` and `sleptAt` are persisted DISCRIMINANT fields, composed ABOVE the
// server/client/live partition rather than inside it: a flat `sleptAt` would
// leak onto the active arm, and `state` must gate the live overlay.
//
// Presence consumers (canvas, dock, minimap, arrange, cycle, switcher) read the
// union; any consumer that touches a live field must first narrow
// `state === "active"` — the compiler refuses a live field on the bare union, so
// a sleeping terminal can sit on the canvas yet never be an input/WebGL target.
// The awareness schemas in `@kolu/terminal-awareness` stay FLAT: the union is
// recomposed HERE, and `state` never crosses the awareness wire (arivu/kaval
// never see a sleeping arm).

const ActiveDiscriminantSchema = z.object({ state: z.literal("active") });
const SleepingDiscriminantSchema = z.object({
  state: z.literal("sleeping"),
  /** Epoch-millis the terminal was put to sleep. The sleeping arm's analogue
   *  of the live overlay — the one scalar an active terminal doesn't carry. */
  sleptAt: z.number(),
  /** A FROZEN SNAPSHOT of the live `pr` overlay at sleep time, so the dormant
   *  tile can still surface the GitHub PR the terminal was working — the live PR
   *  resolution is gone with the PTY. `cwd`/`git` ride the persisted base (true
   *  identity, re-resolved live on wake); `pr` is genuinely LIVE (checks tick),
   *  so it can't sit on the base — its frozen copy belongs here on the sleeping
   *  arm, captured at sleep via the `...entry.meta` spread and DISCARDED on wake
   *  (`wakeMeta`), where the re-spawned PTY's PR sensor re-resolves it. Optional:
   *  a terminal slept before this field, or with no PR context, carries none. */
  pr: PrResultSchema.optional(),
});

/** The active arm's persisted core — `persisted base + state: "active"`, the one
 *  composition both the live and saved active arms build on. The live arm adds
 *  the overlay; the saved arm adds the id. Spelling it once keeps "active =
 *  persisted + discriminant" in a single place so the live/saved divergence is
 *  the only thing each arm restates. */
const ActivePersistedCoreSchema = PersistedTerminalFieldsSchema.merge(
  ActiveDiscriminantSchema,
);

/** An active terminal — persisted base + live overlay + `state: "active"`. The
 *  only arm Phase 1 ever constructs. */
export const ActiveTerminalSchema = ActivePersistedCoreSchema.merge(
  LiveTerminalFieldsSchema,
);

/** A sleeping terminal — persisted base + `sleptAt`, no live overlay (its
 *  PTY/xterm/agent are released). */
export const SleepingTerminalSchema = PersistedTerminalFieldsSchema.merge(
  SleepingDiscriminantSchema,
);

/**
 * The terminal as a sum — `Terminal = active | sleeping`, discriminated on
 * `state`. The `terminalMetadata` collection's value (the wire shape). Presence
 * reads the union; liveness narrows to the `active` arm. Code that only needs
 * one half should import the sub-schema so the dependency is explicit.
 */
export const TerminalMetadataSchema = z.discriminatedUnion("state", [
  ActiveTerminalSchema,
  SleepingTerminalSchema,
]);

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
 * On-disk snapshot of a terminal — the persisted projection of the `Terminal`
 * sum plus a stable `id`. Same discriminant as `TerminalMetadataSchema`, minus
 * the live overlay (live fields never ride to disk): an active saved record is
 * the persisted base + id; a sleeping one adds `sleptAt`. So a restored terminal
 * and a slept terminal are the same on-disk record, distinguished only by
 * `state` — session save emits one list and sleeping terminals join it. The
 * discriminant means a legacy record with no `state` key is rejected on read,
 * which `backfillTerminalState` repairs (`state: "active"`) — run by both the
 * `state.ts` 1.27.0 migration (persisted state) and the client import hatch
 * (`backfillSavedSession`, for an exported `kolu-session.json`).
 *
 * Within-group ordering is the array index; the server writes terminals
 * in `Map` insertion order (stable per ES2015) and restore replays that
 * order verbatim.
 */
const SavedTerminalIdSchema = z.object({
  /** Stable ID within this session (original terminal UUID at save time). */
  id: z.string(),
});

/** The active arm of the on-disk record (persisted base + id, no live overlay)
 *  — the shape restore/adoption produce. Exported so the adoption round-trip
 *  test can assert it carries every persisted key. */
export const SavedActiveTerminalSchema = ActivePersistedCoreSchema.merge(
  SavedTerminalIdSchema,
);

/** The sleeping arm of the on-disk record (persisted base + `sleptAt` + id, no
 *  live overlay) — the shape a slept terminal persists. Named symmetrically with
 *  `SavedActiveTerminalSchema` so the saved sum reads as two equally-named arms. */
export const SavedSleepingTerminalSchema = PersistedTerminalFieldsSchema.merge(
  SleepingDiscriminantSchema,
).merge(SavedTerminalIdSchema);

export const SavedTerminalSchema = z.discriminatedUnion("state", [
  SavedActiveTerminalSchema,
  SavedSleepingTerminalSchema,
]);

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
/** The active arm of the `Terminal` sum — what `createMetadata` builds and the
 *  only arm Phase 1 constructs. Narrowing `state === "active"` yields this. */
export type ActiveTerminal = z.infer<typeof ActiveTerminalSchema>;
/** The sleeping arm of the `Terminal` sum — persisted base + `sleptAt`. */
export type SleepingTerminal = z.infer<typeof SleepingTerminalSchema>;
export type ServerPersistedTerminalFields = z.infer<
  typeof ServerPersistedTerminalFieldsSchema
>;
export type RecentRepo = z.infer<typeof RecentRepoSchema>;
export type RecentAgent = z.infer<typeof RecentAgentSchema>;
export type SavedTerminal = z.infer<typeof SavedTerminalSchema>;
/** The active arm of `SavedTerminal` — what restore/adoption produce and the
 *  only on-disk arm Phase 1 writes. The whole-record adoption path is typed to
 *  this (a sleeping record has no live PTY to adopt). */
export type SavedActiveTerminal = z.infer<typeof SavedActiveTerminalSchema>;
/** The sleeping arm of `SavedTerminal` — persisted base + `sleptAt` + id. What a
 *  slept terminal persists and what the boot seed / restore card read back. */
export type SavedSleepingTerminal = z.infer<typeof SavedSleepingTerminalSchema>;
export type ColorScheme = z.infer<typeof ColorSchemeSchema>;
export type CodeTabView = z.infer<typeof CodeTabViewSchema>;

/** User-facing name of a Code-tab view — the single source for the words the
 *  mode picker renders as a chip label and the file-tree right-click menu
 *  composes its "jump to view" entries from. Defining it once keeps the two
 *  surfaces in sync structurally rather than by convention. */
const VIEW_LABELS: Record<CodeTabView, string> = {
  browse: "All files",
  local: "Local",
  branch: "Branch",
};

/** Display name for a Code-tab view (e.g. "All files" / "Local" / "Branch"). */
export function viewLabel(view: CodeTabView): string {
  return VIEW_LABELS[view];
}

/** Canonical left-to-right order of the Code-tab views — the single source the
 *  scope switcher's segments and the file-tree right-click "jump to view"
 *  entries both order themselves by. Defined here (not derived from
 *  `CodeTabViewSchema`, whose enum order is storage-driven and differs) so the
 *  two surfaces stay in sync structurally rather than by a convention comment.
 *  Adding a view is one edit here. */
export const CODE_TAB_VIEW_ORDER = ["browse", "local", "branch"] as const;

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
    collapsed: false,
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
  activeTab: "code",
  codeMode: "browse",
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

// ── Build identity (surface-app's skew axis, extended) ─────────────────
//
// surface-app's `buildInfo` cell carries "what build is the server?" as
// reactive server state (server-pushed, read with `{ authority: "server" }`).
// The library default is `{ commit }`; kolu EXTENDS it with `expectedKaval` —
// the identity of the kaval the server WOULD spawn (its own baked
// `KAVAL_BUILD_ID`/`KAVAL_COMMIT_HASH`: closure `staleKey` + git-navigable
// commit). `defineBuildInfo` is generic over the schema, so the extra axis is
// type-checked end to end.
//
// `expectedKaval` is the SERVER'S OWN constant (the build it bundles), NOT the
// connected daemon's reported identity — that rides `DaemonStatus.identity` on
// the `daemonStatus` collection, which the rail reads directly. So expected (one
// server fact, here) and reported (a per-host daemon fact, there) read distinctly.
//
// B3.4 — currency: kaval's `staleKey` is a staleness input now. B3.3 adoption
// keeps a wire-compatible-but-older daemon ALIVE across a redeploy (the
// always-recycle premise that once made this display-only is gone), so the read
// site compares `expectedKaval.staleKey !== daemonStatus.identity.staleKey` to
// nudge "update pending" on the `kaval` column — a SEPARATE signal, deliberately
// NOT folded into `isStale` (which stays the library-default clean-ref COMMIT
// comparison driving the client's `≠ srv`). Keyed on the closure-hash staleKey,
// never the per-deploy commit, so a server-/client-only deploy never nudges
// (#1034); off-nix the id is "" on both sides, so the read-site guard stays silent.
export const PtyHostIdentitySchema = z.object({
  staleKey: z.string(),
  navigableCommit: z.string(),
});

/** The live state of one host's pty-host daemon (kaval), as the supervisor's
 *  endpoint reports it — the honest-state surface that makes "the daemon is
 *  down" distinguishable from "you have no terminals" (B2, the empty-canvas-lie
 *  fix). `identity`/`startedAt` are present once `connected`. */
export const DaemonStatusSchema = z.object({
  // The state set is the spine's volatility — derive the enum from the
  // supervisor's `ENDPOINT_STATES` so a new endpoint state is a compile-time
  // obligation here, not a silently-dropped wire member. The `identity` arm
  // below stays kolu's (it is the soul).
  state: z.enum(ENDPOINT_STATES),
  identity: PtyHostIdentitySchema.optional(),
  /** Daemon boot time (ms epoch) — the rail's KAVAL uptime is derived from it. */
  startedAt: z.number().optional(),
  /** B3.3: how many terminals this boot ADOPTED from a surviving daemon — set
   *  only on the `connected` status of an adopt-boot (a fresh / recycled boot
   *  omits it). Drives the client's one-shot "N reattached" confirmation.
   *  kolu's soul, not the spine: the supervisor's `EndpointStatus` never carries
   *  it; the server folds it onto this kolu-owned status after reconciling.
   *  Optional + additive, so it forces no contract bump. */
  adopted: z.number().optional(),
  /** B3.3: the ms-epoch the server stamped when it surfaced THIS adoption — a
   *  per-adoption identity the client dedupes the one-shot toast against. Set with
   *  `adopted` (omitted on cold boots). The `adopted`/`adoptedAt` pair is sticky
   *  server-side and replayed to every fresh subscription, so without an identity
   *  a reconnect after a page reload re-fired the toast though nothing was
   *  re-adopted (juspay/kolu#1365); the client keeps the greatest announced
   *  `adoptedAt` in localStorage and only toasts a strictly newer one. A later
   *  update mints a greater `adoptedAt` and announces again. Optional + additive. */
  adoptedAt: z.number().optional(),
  /** The local kaval's unix socket path (`$XDG_RUNTIME_DIR/kaval-<port>/pty-host.sock`)
   *  — surfaced for the kaval dialog to show where this daemon listens (the path
   *  `kaval-tui` auto-discovers). kolu's soul (a server fact the client can't
   *  construct — it doesn't know the server's `XDG_RUNTIME_DIR`); set once at
   *  boot, constant for the daemon's life. Optional + additive. */
  socketPath: z.string().optional(),
});
export type DaemonStatus = z.infer<typeof DaemonStatusSchema>;
export type DaemonState = DaemonStatus["state"];

/** The kaval daemon's memory as an HONEST three-way state, not a `number | null`
 *  that conflates "no daemon" with "the poll failed".
 *
 *   - `{ status: "ok", rssBytes }` — a live daemon answered `system.processMemory`.
 *   - `{ status: "absent" }` — there is no connected daemon to measure (down /
 *     degraded / pre-first-poll). The expected "no value", not an error.
 *   - `{ status: "error" }` — the daemon was BELIEVED connected (its `daemonStatus`
 *     says so) yet the poll threw. A real anomaly the rail must surface distinctly
 *     from `absent`, so a failing RPC never renders identically to "no daemon"
 *     (the `caught-error-must-not-collapse-to-empty` rule — a server-side log is
 *     not a user surface). The original error is logged at `error` level server-
 *     side; the wire carries only the discriminant the rail needs.
 *
 *  A discriminated union (not an extra `kavalMemoryError` flag beside a nullable
 *  number) so the three states are mutually exclusive by construction — there is
 *  no representable "error AND a stale rss". */
export const KavalMemorySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), rssBytes: z.number() }),
  z.object({ status: z.literal("absent") }),
  z.object({ status: z.literal("error") }),
]);
export type KavalMemory = z.infer<typeof KavalMemorySchema>;

/** Live process-memory readout for the chrome bar's identity rail — the
 *  resident-set size (RSS) of the two server-side processes the rail names. The
 *  CLIENT's own JS-heap figure is NOT here: it's a browser-local fact read off
 *  `performance.memory` in the client (no wire round-trip), so this cell carries
 *  only what the client can't measure itself.
 *
 *  `serverRssBytes` is the kolu-server process (always present — it's measuring
 *  itself). `kavalMemory` is the kaval pty-host daemon's RSS, a SEPARATE process
 *  the server polls over the daemon's `system.processMemory`; it is the honest
 *  three-way {@link KavalMemorySchema} so the rail can tell "no daemon" apart from
 *  "the daemon's poll failed", never collapsing a failed RPC into the same shape
 *  as no-data. A continuously-changing metric, kept off the lifecycle-transition
 *  `daemonStatus` collection so the two different change rates don't ride one
 *  channel. */
export const ProcessMemorySchema = z.object({
  serverRssBytes: z.number(),
  kavalMemory: KavalMemorySchema,
});
export type ProcessMemory = z.infer<typeof ProcessMemorySchema>;

/** Bytes in one megabyte. The single source of truth both the server-side dedup
 *  boundary and the client-side rail rendering read, so they can't drift. */
export const BYTES_PER_MB = 1_048_576;

/** The whole-megabyte figure the rail displays for a byte count. One
 *  computation, shared: the server's `processMemory` dedup (drop a set when the
 *  displayed MB doesn't move) and the client's `formatMBCompact` rendering both
 *  read it, so the dedup boundary and the rendered figure provably agree rather
 *  than relying on two byte-for-byte-identical copies. */
export function bytesToWholeMB(bytes: number): number {
  return Math.round(bytes / BYTES_PER_MB);
}

export interface KoluBuildInfo extends BuildInfo {
  /** App version (X.Y.Z) — the rail's `srv` column shows it as `vX.Y.Z` beside the
   *  commit. Optional only in the library-seeded default (`{ commit }`); once
   *  the async buildInfo patch resolves it's always present — `pkg.version`,
   *  even in dev. */
  version?: string;
  /** The identity of the kaval the server would spawn — its own baked closure
   *  `staleKey` + commit (B3.4). Optional only in the library-seeded `{ commit }`
   *  default and off-nix (no baked id); under nix it's always present. The
   *  read-site currency nudge compares its `staleKey` against the connected
   *  daemon's reported `DaemonStatus.identity.staleKey`. */
  expectedKaval?: z.infer<typeof PtyHostIdentitySchema>;
}

export const koluBuildInfo = defineBuildInfo<KoluBuildInfo>({
  schema: z.object({
    commit: z.string(),
    version: z.string().optional(),
    expectedKaval: PtyHostIdentitySchema.optional(),
  }),
  default: { commit: "" },
});

// ── The surfaces ──────────────────────────────────────────────────────
//
// kolu now serves TWO sibling surfaces over one transport (kolu#1197):
//
//   - `koluSurface` — every primitive kolu OWNS (preferences, activityFeed,
//     session, terminalList; terminalMetadata; the git/fs streams; the
//     terminalExit event). Served under the `kolu` key.
//   - `surfaceAppSurface_kolu` — surface-app's COMPLETE surface (the
//     build-identity `buildInfo` cell extended with kolu's `expectedKaval`
//     axis, plus the `identity.info` restart probe). Served under the `surfaceApp`
//     key. Its wire path is `surface.surfaceApp.{buildInfo,identity}`.
//
// They are NOT merged — `composeSurfaceContracts` / `implementSurfaces` /
// `surfaceClients` multiplex them, each namespaced by its key. surface-app is
// already a complete surface; we serve it as a sibling rather than splicing its
// halves into kolu's own surface.

/** surface-app served as a sibling, extended with kolu's build identity. */
export const surfaceAppSurface_kolu = surfaceAppSurfaceWith(koluBuildInfo);

/** Every primitive kolu OWNS — its own cells, collection, streams, and event.
 *  surface-app's buildInfo/identity ride the sibling surface above, not here. */
export const koluSurface = defineSurface({
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

    /** Live process-memory readout (server + kaval RSS) for the rail. The
     *  server's periodic sampler is the sole writer (`surfaceCtx.cells.
     *  processMemory.set`); clients read-only. `kavalMemory` is `absent` until
     *  the first daemon poll, and whenever the daemon is down. */
    processMemory: {
      schema: ProcessMemorySchema,
      default: {
        serverRssBytes: 0,
        kavalMemory: { status: "absent" },
      } satisfies z.infer<typeof ProcessMemorySchema>,
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

    /** Per-host pty-host daemon (kaval) status, keyed by hostId — a map of one
     *  (`local`) today, host-count-agnostic by construction for R-2's ssh hosts.
     *  The supervisor's endpoint is the sole writer (server-internal); the rail
     *  and DegradedCanvas subscribe so the UI never lies about the daemon. */
    daemonStatus: {
      keySchema: z.string(),
      schema: DaemonStatusSchema,
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

/** The two siblings, keyed — the single browser-safe source of which surfaces
 *  exist under which keys. `composeSurfaceContracts(surfaces)` (contract),
 *  `surfaceClients(link, surfaces)` (client), and `implementSurfaces(surfaces, …)`
 *  (server) all read this one map, so the keys can't drift across the three. */
export const surfaces = {
  kolu: koluSurface,
  surfaceApp: surfaceAppSurface_kolu,
} as const;

// ── Inferred runtime types — surface-bound, via SurfaceTypes ──────────
// `Surface` lifts `z.infer<schema>` over the spec so consumers reach for
// `Surface["cells"]["preferences"]["Value"]` etc. The flat aliases below
// are the conventional re-exports for the surface entries that Kolu code
// references by name across packages.

export type Surface = SurfaceTypes<typeof koluSurface.spec>;

export type Preferences = Surface["cells"]["preferences"]["Value"];
export type PreferencesPatch = Surface["cells"]["preferences"]["Patch"];
export type ActivityFeed = Surface["cells"]["activityFeed"]["Value"];
export type TerminalMetadata =
  Surface["collections"]["terminalMetadata"]["Value"];
export type TerminalInfo = z.infer<typeof TerminalInfoSchema>;
export type SavedSession = z.infer<typeof SavedSessionSchema>;

/** Narrow a terminal (or a possibly-absent one) to its active arm, or
 *  `undefined` when it is sleeping/absent. The single seam presence surfaces use
 *  to read a live field off the `Terminal` sum — `activeArm(meta)?.agent`,
 *  `activeArm(meta)?.foreground`, `activeArm(meta)?.pr`. A sleeping terminal has
 *  no live overlay, so the optional chain yields the same "absent" a live
 *  terminal with no agent/foreground already carries. Accepts null/undefined so
 *  a caller can thread `store.getMetadata(id)` / `activeMeta()` straight through
 *  one call (TS can't narrow a repeated `getMetadata(id).state` across two
 *  calls; this binds the value once).
 *
 *  This reader deliberately collapses "sleeping" and "absent" into one
 *  `undefined` — exactly what a live-field optional-chain wants. A *sleeping-
 *  specific* consumer (a ☾ badge, a `sleptAt` line) must NOT widen this to a
 *  three-way; it gets its own sibling projection (e.g. `sleepingArm`) so the
 *  active/sleeping/absent distinction is preserved at that seam rather than
 *  re-scattering `state` checks. */
export function activeArm(
  m: TerminalMetadata | null | undefined,
): ActiveTerminal | undefined {
  return m?.state === "active" ? m : undefined;
}

/** Narrow a terminal to its SLEEPING arm, or `undefined` when it is active /
 *  absent. The sibling projection `activeArm`'s doc anticipates: a sleeping-
 *  SPECIFIC consumer — the ☾ dock bucket, the moonlit minimap/switcher pip, the
 *  DormantTileBody's `sleptAt` — reads THIS rather than re-scattering
 *  `state === "sleeping"` checks, so the one discriminant has exactly one reader
 *  per arm and "is this tile sleeping?" is greppable across every LIVE-metadata
 *  presence surface. (Persistence-typed readers that hold a `SavedTerminal`
 *  rather than `TerminalMetadata` — e.g. session restore — narrow `state`
 *  directly, since this accessor only accepts the live union.) Truthiness alone
 *  answers presence; the returned arm exposes `sleptAt` for the "asleep 3d"
 *  label. */
export function sleepingArm(
  m: TerminalMetadata | null | undefined,
): SleepingTerminal | undefined {
  return m?.state === "sleeping" ? m : undefined;
}

/** The resolved PR of a terminal, if it is active AND its PR resolution is `ok`,
 *  else `null`. The single accessor for 'is it active and does it have a resolved
 *  PR' — the active narrow (`activeArm`) and the `ok`-arm projection (`prValue`)
 *  composed once, so value sites read one accessor instead of re-wiring the two
 *  primitives (and don't leak the `false` an `arm && prValue(arm.pr)` chain
 *  returns). JSX sites that narrow the arm to read BOTH `prValue` and
 *  `prUnavailableSource` off it keep the `activeArm` narrow — this value
 *  projection only collapses the `PrInfo | null` reads. */
export function activePr(
  m: TerminalMetadata | null | undefined,
): PrInfo | null {
  const arm = activeArm(m);
  return arm ? prValue(arm.pr) : null;
}

// ── Saved-terminal backfills (legacy → current shape) ─────────────────
//
// Pure record transforms that bring a legacy on-disk `SavedTerminal` up to the
// current `SavedTerminalSchema`, one per schema bump that added a now-required
// field. They live HERE, beside the schema they restore, because TWO callers
// run them on the SAME blob: the server's versioned migration ladder
// (`state.ts`, keyed per `SCHEMA_VERSION` step) AND the client's diagnostic
// "Import session" hatch (`sessionTransfer.ts`), which ingests an exported
// `kolu-session.json` that may predate any of these fields. A second hand-rolled
// backfill on the import side would be a parallel source of truth — the bug
// codex flagged in the Phase-1 review — so the import path composes these same
// functions via `backfillSavedSession` instead.
//
// Each is idempotent and keyed on the field's presence, never its value, so the
// composed pass is order-independent and safe to re-run on already-current data.

/** Backfill `git.remoteUrl = null` on a saved terminal whose `git` record
 *  predates the field (#1244). Sessions saved between the 1.18 migration and
 *  1.25 carry a populated `git` with no `remoteUrl`, which the now-required
 *  `GitInfoSchema` field rejects. The live git watcher re-resolves the real
 *  value on first restore. Idempotent: a `git` that already has `remoteUrl` —
 *  or a null `git` — passes through untouched. */
export function backfillRemoteUrl(
  t: Record<string, unknown>,
): Record<string, unknown> {
  const git = t.git;
  if (!git || typeof git !== "object") return t;
  if ("remoteUrl" in git) return t;
  return {
    ...t,
    git: { ...(git as Record<string, unknown>), remoteUrl: null },
  };
}

/** Backfill `location = { kind: "local" }` on a saved terminal from before
 *  `location` became a required field (#1398). Every terminal that could have
 *  been persisted before then was an in-process (local) PTY — remote terminals
 *  do not yet exist — so the only honest backfill is the local variant.
 *  Idempotent: a record that already carries a `location` (a future remote
 *  terminal, or a re-run) is left untouched. */
export function backfillLocation(
  t: Record<string, unknown>,
): Record<string, unknown> {
  if ("location" in t) return t;
  return { ...t, location: LOCAL_LOCATION };
}

/** Backfill `state: "active"` on a saved terminal from before `SavedTerminal`
 *  became a `discriminatedUnion` on `state` (the sleeping-terminals redesign,
 *  Phase 1). Every pre-discriminant terminal was an attached, live PTY — no
 *  sleeping record was ever persisted — so the only honest backfill is the
 *  active arm. Idempotent and keyed on the discriminant KEY, not its value: a
 *  record that already carries a `state` (a future `state: "sleeping"` record
 *  with its `sleptAt`, or a re-run) passes through untouched. */
export function backfillTerminalState(
  t: Record<string, unknown>,
): Record<string, unknown> {
  if ("state" in t) return t;
  return { ...t, state: "active" };
}

/** Bring one legacy saved-terminal record up to the current
 *  `SavedTerminalSchema` by composing every field backfill above. Order-free
 *  (each is idempotent + presence-keyed); spelled in ladder order for reading. */
export function backfillSavedTerminal(
  t: Record<string, unknown>,
): Record<string, unknown> {
  return backfillTerminalState(backfillLocation(backfillRemoteUrl(t)));
}

/** Bring a parsed-but-unvalidated saved-session blob up to the current schema
 *  by backfilling each terminal, so a `kolu-session.json` exported before a
 *  schema bump survives re-import (the recovery hatch its `sessionTransfer.ts`
 *  callers exist to provide). A non-object, or one with no `terminals` array,
 *  is returned untouched for `SavedSessionSchema` to reject with its own error.
 *  Pure — no validation here; the caller validates the result. */
export function backfillSavedSession(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object") return parsed;
  const session = parsed as Record<string, unknown>;
  if (!Array.isArray(session.terminals)) return parsed;
  return {
    ...session,
    terminals: session.terminals.map((t) =>
      t && typeof t === "object"
        ? backfillSavedTerminal(t as Record<string, unknown>)
        : t,
    ),
  };
}
