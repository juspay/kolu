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
 * terminal identity) are OWNED by `@kolu/terminal-workspace/schema` (P1a) and
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
  AgentKindSchema,
  AgentMemorySchema,
  type TerminalSnapshot,
  TerminalSnapshotSchema,
  RestoreTargetSchema,
  seedMemory,
  TerminalIdSchema,
} from "@kolu/terminal-workspace/schema";
import { terminalWorkspaceSurface } from "@kolu/terminal-workspace/surface";
import { exactRestoreTarget } from "anyagent/cli";
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
import { match } from "ts-pattern";
import { z } from "zod";

// ── Re-exports — the awareness domain moved to @kolu/terminal-workspace (P1a) ──
//
// The generic `TerminalSnapshot` (terminal identity, agent status, PR resolution,
// foreground) is OWNED by `@kolu/terminal-workspace/schema` now. kolu-common
// EXTENDS that base — adding `location`, the client/UI fields, and kolu's
// remembered `AgentMemory` below — and re-exports the moved symbols so existing
// `kolu-common/surface` import sites are unchanged: the schema home inverted, the
// consumers didn't move.
export {
  AgentIdentitySchema,
  AgentInfoSchema,
  AgentKindSchema,
  AgentMemorySchema,
  ForegroundSchema,
  TerminalSnapshotSchema,
  PrResultSchema,
  PrUnavailableSourceSchema,
  prUnavailableReason,
  prUnavailableSource,
  reasonForSource,
  resumableCommand,
  RestoreTargetSchema,
} from "@kolu/terminal-workspace/schema";
export type {
  AgentIdentity,
  AgentInfo,
  AgentKind,
  AgentMemory,
  ClaudeCodeInfo,
  CodexInfo,
  Foreground,
  TerminalSnapshot,
  OpenCodeInfo,
  PrResult,
  PrUnavailableSource,
  RestoreTarget,
  TerminalId,
} from "@kolu/terminal-workspace/schema";
export { TerminalIdSchema };

// The renderer-agnostic agent-state projection (bucket · urgency · needs-you
// rank) is OWNED by `@kolu/terminal-workspace/agentProjection` — the ONE source
// pulam-tui and pulam-web already share. The kolu client reaches it through the
// SAME door it already uses for the awareness schema (this module) rather than a
// second, direct `@kolu/terminal-workspace` edge, so the Dock joins as a third
// consumer of the same definition instead of re-deriving "needs-you".
export {
  agentBucket,
  agentPaintClass,
  agentUrgency,
  alertClass,
  URGENCY_RANK,
} from "@kolu/terminal-workspace/agentProjection";
export type {
  AgentPaintClass,
  AlertClass,
  Urgency,
} from "@kolu/terminal-workspace/agentProjection";

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

// ── Terminal metadata fields, organized by who OBSERVES vs who REMEMBERS ──
//
// After the awareness-derive-store cutover (PR #1621) a terminal's metadata has
// three sources, joined at the client by `composeTerminalMetadata`:
//   - the OBSERVATION (`@kolu/terminal-workspace`'s `TerminalSnapshot`: cwd · git · pr
//     · agent · foreground) — what a memoryless host re-observes, served on the
//     `terminalWorkspace.snapshots` collection and held in `entry.snapshot`;
//   - kolu's AUTHORED record (`entry.meta`): the kolu-owned `location`, the
//     client/UI fields, the two REMEMBERED `AgentMemory` facts (`lastActivityAt`
//     /`lastAgentCommand`, written ONLY by the fold's `updateMemory`), and the
//     active|sleeping discriminant;
//   - the discriminant `state`/`sleptAt`.
//
// The producer cannot CONSTRUCT memory (its emit type is `TerminalSnapshot`), so "two
// writers of a remembered fact" is unrepresentable — the fence is the type, not a
// runtime mutator split. Adding a field: an OBSERVABLE one belongs in
// `TerminalSnapshot` (terminal-workspace); a kolu-REMEMBERED one in `AgentMemory`; a
// client-owned one in `ClientPersistedTerminalFieldsSchema` below.

/** The PERSISTED (restore-relevant) projection of an `TerminalSnapshot` — what rides to
 *  disk and what a DORMANT tile shows: `cwd · git · pr`. No churny `foreground`,
 *  and NO agent detail (lie-when-dead). `pr` is restore-relevant now (true-when-
 *  dead, persisted like `git`), so it survives on a dormant tile from HERE — the
 *  old frozen-`pr`-on-the-sleeping-arm special case is gone. The agent the terminal
 *  will RESUME rides the authored record's `restoreTarget` (the discriminated resume
 *  value, carrying the agent IDENTITY on its `exact` arm), not this projection — a
 *  full `TerminalSnapshot`'s live agent can't survive a server restart as anything but its
 *  identity, and that identity is the kolu-owned resume target, not a snapshot field.
 *  `SavedTerminalSchema.parse` reduces a full
 *  `TerminalSnapshot` to this at the disk-persist seam (it drops agent + foreground
 *  structurally). */
export const PersistedSnapshotSchema = TerminalSnapshotSchema.pick({
  cwd: true,
  git: true,
  pr: true,
});
export type PersistedSnapshot = z.infer<typeof PersistedSnapshotSchema>;

/**
 * Client-persisted fields — written by client RPCs (via
 * `updateClientMetadata`, or direct mutation for paths that intentionally
 * skip the publish like sub-panel state) and round-tripped through disk.
 * The "client-writes + persisted" intersection, declared structurally.
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
 * Client write fence — the mutator passed to `updateClientMetadata` is
 * narrowed to this shape, so RPC handlers cannot accidentally overwrite
 * provider-owned state. Exactly the client-persisted base.
 */
export const TerminalClientMetadataSchema = ClientPersistedTerminalFieldsSchema;

// ── The active | sleeping sum ─────────────────────────────────────────
//
// A terminal is a discriminated union on `state`. An ACTIVE terminal carries the
// FULL live `TerminalSnapshot` (agent detail + foreground); a SLEEPING terminal carries
// only the restore-relevant `PersistedSnapshot` (its PTY/xterm/agent released,
// so the live detail is stale) plus `sleptAt`. Both arms carry the AUTHORED record
// (location + memory + client fields).
//
// `state` and `sleptAt` are persisted DISCRIMINANT fields, composed ABOVE the
// observation/authored split: a flat `sleptAt` would leak onto the active arm, and
// `state` must gate the live overlay. Presence consumers (canvas, dock, minimap,
// arrange, cycle, switcher) read the union; any consumer that touches a live field
// (full agent / foreground) must first narrow `state === "active"`. `state` never
// crosses the awareness wire (pulam/kaval never see a sleeping arm).

const ActiveDiscriminantSchema = z.object({ state: z.literal("active") });
const SleepingDiscriminantSchema = z.object({
  state: z.literal("sleeping"),
  /** Epoch-millis the terminal was put to sleep. The sleeping arm's analogue
   *  of the live overlay — the one scalar an active terminal doesn't carry. The
   *  frozen-`pr` field that used to live here is GONE: `pr` is restore-relevant
   *  now, so it rides the persisted observation and survives on the dormant tile
   *  from there (no special case). */
  sleptAt: z.number(),
});

// ── The AUTHORED family — what rides `entry.meta` after the cutover ───────
//
// The terminal record is bisected: the OBSERVATION (cwd · git · pr · agent ·
// foreground) rides the registry entry's own `awareness` field, folded by kolu
// from the producer's stream. What rides `entry.meta` is the AUTHORED record: the
// kolu-owned `location`, the client/UI fields, the two REMEMBERED `AgentMemory`
// facts (`lastActivityAt`/`lastAgentCommand`, written only by the fold's
// `updateMemory`), and the active|sleeping discriminant.
//
// The authored TYPE names no OBSERVED field, so `entry.meta.cwd = x` is a COMPILE
// ERROR — "two writers of the observation" is unrepresentable. The unified
// `TerminalMetadata` is recomposed from the two halves at the CLIENT read (and at
// disk persist) via `composeTerminalMetadata` (below).

/** kolu's server-written authored fields — `location` (set once at spawn), the two
 *  remembered `AgentMemory` facts, and the `restoreTarget` (all written by the
 *  fold's `updateMemory`). Memory is FLAT here, so the on-disk JSON path is
 *  unchanged and `composeTerminalMetadata` spreads it straight onto the joined
 *  record. */
const KoluAuthoredServerFieldsSchema = z
  .object({
    /** Where this terminal's endpoint lives — `{ kind: "local" }` for an in-process
     *  PTY, `{ kind: "remote", hostId }` for a dialed host. Non-optional and explicit
     *  by construction: a terminal's host is the value of this field, never the
     *  *absence* of a host id, so any code that constructs a terminal's metadata must
     *  name its host (a dropped location is a compile error, not a silent local
     *  respawn against the wrong machine). Set once at spawn, never mutated. */
    location: HostLocationSchema,
    /** The fold-derived RESTORE TARGET — kolu's discriminated answer to "what does
     *  waking this terminal do?" (`{@link RestoreTargetSchema}`): `exact` resumes the
     *  EXACT conversation that was live by id (#1495), `none` wakes to a bare shell
     *  (#1492), `legacyMostRecent` resumes most-recent for migrated pre-1.29 records.
     *  Produced by `restoreTargetOf` and written by the fold's `updateMemory`; it
     *  rides the AUTHORED record (not the observation) because a server restart keeps
     *  only the agent's IDENTITY, never its lie-when-dead detail. ABSENT reads as
     *  `none` (a fresh terminal with no agent), never as "resume something" — the
     *  discriminant is what `resumeFormFor` switches on, so an absent field can't be
     *  misread as the most-recent fallback the old bare `resumeAgent` left ambiguous. */
    restoreTarget: RestoreTargetSchema.optional(),
  })
  .merge(AgentMemorySchema);

const KoluAuthoredFieldsSchema = KoluAuthoredServerFieldsSchema.merge(
  ClientPersistedTerminalFieldsSchema,
);

/** The authored ACTIVE arm — `location` + memory + client fields + `state:
 *  "active"`. No snapshot field. */
export const AuthoredActiveSchema = KoluAuthoredFieldsSchema.merge(
  ActiveDiscriminantSchema,
);

/** The authored SLEEPING arm — `location` + memory + client fields + `sleptAt`.
 *  No snapshot field, and no frozen `pr`: `pr` is restore-relevant now and rides
 *  the persisted observation, so the dormant tile reads it from there. */
export const AuthoredSleepingSchema = KoluAuthoredFieldsSchema.merge(
  SleepingDiscriminantSchema,
);

/** The authored terminal as a sum — `entry.meta`'s static type. Discriminated on
 *  `state`, naming no snapshot field. */
export const AuthoredTerminalSchema = z.discriminatedUnion("state", [
  AuthoredActiveSchema,
  AuthoredSleepingSchema,
]);

export type AuthoredActiveTerminal = z.infer<typeof AuthoredActiveSchema>;
export type AuthoredSleepingTerminal = z.infer<typeof AuthoredSleepingSchema>;
export type AuthoredTerminal = z.infer<typeof AuthoredTerminalSchema>;

/** An active terminal — the FULL live `TerminalSnapshot` joined with the authored
 *  active arm. The only live arm; narrowing `state === "active"` yields the full
 *  agent detail + foreground. */
export const ActiveTerminalSchema =
  TerminalSnapshotSchema.merge(AuthoredActiveSchema);

/** A sleeping terminal — the restore-relevant `PersistedSnapshot` (agent
 *  identity, no foreground) joined with the authored sleeping arm. Its PTY/agent
 *  are released, so it carries only what survives the release. */
export const SleepingTerminalSchema = PersistedSnapshotSchema.merge(
  AuthoredSleepingSchema,
);

/** The on-disk persisted core, both arms share — the `PersistedSnapshot` +
 *  the authored fields. The saved active arm adds `state: "active"`; the saved
 *  sleeping arm adds `sleptAt`. Both add `id`. */
const SavedPersistedCoreSchema = PersistedSnapshotSchema.merge(
  KoluAuthoredFieldsSchema,
);

/**
 * The terminal as a sum — `Terminal = active | sleeping`, discriminated on
 * `state`. The shape the CLIENT reconstructs by joining the AUTHORED record
 * (`kolu.authored`) with the AWARENESS value (`terminalWorkspace.snapshots`) via
 * `composeTerminalMetadata` — it is never a server-served collection of its own.
 * Presence reads the union; liveness narrows to the `active` arm. Code that only
 * needs one half should import the sub-schema so the dependency is explicit.
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
 *  flows through the `authored` collection joined with `awareness` at the
 *  client. */
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

/** The active arm of the on-disk record (persisted-observation base + authored +
 *  `state: "active"` + id) — the shape restore/adoption produce. The agent is its
 *  IDENTITY only (no lie-when-dead detail) and foreground is absent: the
 *  restore-relevant projection, not the full live `TerminalSnapshot`. Exported so the
 *  adoption round-trip test can assert it carries every persisted key. */
export const SavedActiveTerminalSchema = SavedPersistedCoreSchema.merge(
  ActiveDiscriminantSchema,
).merge(SavedTerminalIdSchema);

/** The sleeping arm of the on-disk record (persisted-observation base + authored +
 *  `sleptAt` + id) — the shape a slept terminal persists. Named symmetrically with
 *  `SavedActiveTerminalSchema` so the saved sum reads as two equally-named arms. */
export const SavedSleepingTerminalSchema = SavedPersistedCoreSchema.merge(
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

/** How a newly created terminal gets its theme. `inherit` copies the active
 *  terminal's theme (like new terminals inherit its size — set one theme once
 *  and every new terminal follows; the first terminal seeds from the server
 *  default); `shuffle` auto-picks a distinct tint via {@link ShuffleBehaviorSchema}. */
export const NewTerminalThemeSchema = z.enum(["inherit", "shuffle"]);

/** Which themes a *shuffle* draws from — both a `shuffle` new terminal and the
 *  ⌘⇧J "Shuffle theme" action. `random` spreads across the whole catalogue;
 *  `dark`/`light` restrict to that luminance family; `auto` tracks the app's
 *  resolved light/dark mode. */
export const ShuffleBehaviorSchema = z.enum([
  "random",
  "dark",
  "light",
  "auto",
]);

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
  /** How a new terminal gets its theme (inherit the active one, or shuffle a
   *  distinct tint) — see {@link NewTerminalThemeSchema}. */
  newTerminalTheme: NewTerminalThemeSchema,
  /** Which themes any shuffle draws from — a `shuffle` new terminal and the
   *  ⌘⇧J action alike — see {@link ShuffleBehaviorSchema}. */
  shuffleBehavior: ShuffleBehaviorSchema,
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
export type TerminalClientMetadata = z.infer<
  typeof TerminalClientMetadataSchema
>;
export type InitialTerminalMetadata = z.infer<
  typeof InitialTerminalMetadataSchema
>;
/** The active arm of the `Terminal` sum — what `createMetadata` builds and the
 *  only arm Phase 1 constructs. Narrowing `state === "active"` yields this. */
export type ActiveTerminal = z.infer<typeof ActiveTerminalSchema>;
/** The sleeping arm of the `Terminal` sum — persisted-observation base + memory +
 *  `sleptAt`. */
export type SleepingTerminal = z.infer<typeof SleepingTerminalSchema>;
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
export type NewTerminalTheme = z.infer<typeof NewTerminalThemeSchema>;
export type ShuffleBehavior = z.infer<typeof ShuffleBehaviorSchema>;

/** The luminance family a shuffle should restrict its candidate pool to, from
 *  the `shuffleBehavior` preference and the app's resolved dark mode.
 *  `undefined` means no restriction (`random` — the whole catalogue). The
 *  single source of truth for every shuffle: a `shuffle` new terminal AND the
 *  ⌘⇧J action both resolve their pool through here. */
export function shuffleMode(
  behavior: ShuffleBehavior,
  isDark: boolean,
): "light" | "dark" | undefined {
  return match(behavior)
    .with("random", () => undefined)
    .with("dark", () => "dark" as const)
    .with("light", () => "light" as const)
    .with("auto", () => (isDark ? ("dark" as const) : ("light" as const)))
    .exhaustive();
}

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
  newTerminalTheme: "shuffle",
  shuffleBehavior: "auto",
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
// kolu now serves THREE sibling surfaces over one transport (kolu#1197, R8):
//
//   - `koluSurface` — every primitive kolu OWNS (preferences, activityFeed,
//     session, terminalList; the per-terminal `authored` record; the git/fs
//     streams; the terminalExit event). Served under the `kolu` key. The eight
//     AWARENESS fields are NOT here — they ride `terminalWorkspace.snapshots`,
//     and the client JOINS the two halves at read time (no fused record on the
//     wire).
//   - `surfaceAppSurface_kolu` — surface-app's COMPLETE surface (the
//     build-identity `buildInfo` cell extended with kolu's `expectedKaval`
//     axis, plus the `identity.info` restart probe). Served under the `surfaceApp`
//     key. Its wire path is `surface.surfaceApp.{buildInfo,identity}`.
//   - `terminalWorkspaceSurface` — the GENERIC `@kolu/terminal-workspace` surface
//     (awareness collection + version cell + activity flow + fs/git procedures &
//     watcher streams), served under the `terminalWorkspace` key so a viewer reads
//     the same surface `pulam` serves. Its `awareness` collection is projected
//     off each registry entry's `awareness` field (Design-S; the sensor sink is
//     the sole writer, see `server/src/terminal-registry.ts`). kolu's OWN
//     client reads this collection too, joining each value with the matching
//     `kolu.authored` record — so R9 (remote awareness) is a pure backing-swap
//     behind this one collection, with no second read path to migrate.
//
// They are NOT merged — `composeSurfaceContracts` / `implementSurfaces` /
// `surfaceClients` multiplex them, each namespaced by its key. Each is already a
// complete surface; we serve them as siblings rather than splicing their halves
// into one surface.

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
    /** Per-terminal AUTHORED record — the kolu-owned half of a terminal:
     *  `location` + memory + the `restoreTarget` + client/UI chrome + the
     *  active|sleeping discriminant. The five OBSERVED awareness fields (cwd · git ·
     *  pr · agent · foreground) ride the GENERIC
     *  `terminalWorkspace.snapshots` collection, NOT here — the client JOINS the
     *  two halves at read time via `composeTerminalMetadata`
     *  (`useTerminalMetadata`), so there is no server-side re-fusion and no fused
     *  record on the wire. Each terminal is independently observable; mutations
     *  come from server-side providers writing through the publisher channel —
     *  clients don't call `upsert` on this collection directly. */
    authored: {
      keySchema: TerminalIdSchema,
      schema: AuthoredTerminalSchema,
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

/** The three siblings, keyed — the single browser-safe source of which surfaces
 *  exist under which keys. `composeSurfaceContracts(surfaces)` (contract),
 *  `surfaceClients(link, surfaces)` (client), and `implementSurfaces(surfaces, …)`
 *  (server) all read this one map, so the keys can't drift across the three. */
export const surfaces = {
  kolu: koluSurface,
  surfaceApp: surfaceAppSurface_kolu,
  // The generic `@kolu/terminal-workspace` surface, served as a third sibling
  // (R8): the `awareness` collection (projected off each registry entry's
  // `awareness` field — kolu's fold is the sole writer), the `version`
  // handshake cell, the live `activity` flow, and the Code tab's fs/git
  // procedures + watcher streams. `composeSurfaceContracts`
  // / `surfaceClients` / `implementSurfaces` pick it up from this one map, so it
  // is served at `surface.terminalWorkspace.*` automatically. Its value schema is
  // the GENERIC `TerminalSnapshot` — no `location`, no kolu UI fields, no memory.
  terminalWorkspace: terminalWorkspaceSurface,
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
/** The unified terminal record — NOT a served collection value (the wire
 *  carries the `authored` + `awareness` halves separately). This is the shape
 *  `composeTerminalMetadata` reconstructs at the client read and at disk
 *  persist, and the type the ~20 `getMetadata` consumers see. */
export type TerminalMetadata = z.infer<typeof TerminalMetadataSchema>;
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

/** Build a fresh AUTHORED active record for a newly-spawned terminal — the
 *  kolu-owned `location`, empty memory from the canonical `seedMemory` home
 *  (recency at 0, no command), and the active discriminant. The observation half is
 *  seeded SEPARATELY via `seedSnapshot`; this names none of it. The single seam
 *  every live terminal's authored record is born through (spawn / orphan adoption),
 *  and the memory default lives ONCE in `seedMemory`, so a future memory field is
 *  added there and rides here for free. */
export function createAuthoredActive(
  location: HostLocation,
): AuthoredActiveTerminal {
  return { location, ...seedMemory(), state: "active" };
}

/** Join the two halves of a terminal into the unified `TerminalMetadata` — the
 *  ONE join function, applied at exactly two sites: the CLIENT reader
 *  (`useTerminalMetadata`, ephemeral, recomputed per render) and DISK persist
 *  (`snapshotSession`, a save-time snapshot). It is NEVER served as a collection
 *  of its own: the wire carries the two halves separately (`kolu.authored` +
 *  `terminalWorkspace.snapshots`) and the join lives at the reader. The authored
 *  record (`entry.meta`) carries location + memory + client fields + the
 *  discriminant; the observation carries the five snapshot fields. Reusing one
 *  join at both the read and the persist site keeps disk and the client read from
 *  ever diverging.
 *
 *  Spread order is LOAD-BEARING: observation FIRST, authored LAST. The authored
 *  record names no snapshot field, so it never clobbers the observation. The
 *  active path takes the full `TerminalSnapshot` as-is: TS verifies the spread IS an
 *  `ActiveTerminal` structurally, with no parse on the per-render hot path.
 *
 *  The sleeping path takes ONLY the restore-relevant projection — `foreground` is
 *  dropped and the agent reduced to its identity via `PersistedSnapshotSchema.
 *  parse`. `pr` rides that projection (restore-relevant now), so the dormant tile
 *  surfaces its last-known PR from there — no frozen-`pr` special case. */
export function composeTerminalMetadata(
  authored: AuthoredTerminal,
  observation: TerminalSnapshot,
): TerminalMetadata {
  return authored.state === "active"
    ? { ...observation, ...authored }
    : SleepingTerminalSchema.parse({
        ...PersistedSnapshotSchema.parse(observation),
        ...authored,
      });
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

/** Backfill the awareness-derive-store cutover (PR #1621): `pr` became a PERSISTED
 *  (restore-relevant) field, and the old sticky `agentSession` ref + the implicit
 *  "`lastAgentCommand` ⇒ resume most-recent" rule collapsed into one discriminated
 *  `restoreTarget` (`{@link RestoreTargetSchema}`). A pre-cutover record:
 *   - lacks `pr` (it was a never-persisted live field) → backfill `{ kind: "absent"
 *     }` so the now-persisted field parses; the live PR sensor re-resolves on
 *     restore. A frozen sleeping-arm `pr` already satisfies it and passes through;
 *   - is given a `restoreTarget` from what it remembered, so the OLD resume behavior
 *     is preserved as a NAMED value rather than re-derived from field absence:
 *       · `agentSession { kind, id }` + a `lastAgentCommand` → `{ kind: "exact",
 *         command, agent: { kind, sessionId: id } }` (the EXACT conversation, #1495);
 *       · a `lastAgentCommand` but no `agentSession` → `{ kind: "legacyMostRecent",
 *         command }` (the old most-recent fallback, kept for already-saved sessions);
 *       · no `lastAgentCommand` → no `restoreTarget` (absent ≡ `none`, a bare shell).
 *  `agentSession` is dropped either way. Idempotent and presence-keyed: a record
 *  that already has `pr` and a `restoreTarget` passes through untouched. */
export function backfillSnapshotCutover(
  t: Record<string, unknown>,
): Record<string, unknown> {
  const { agentSession, ...rest } = t;
  const next: Record<string, unknown> = { ...rest };
  if (!("pr" in next)) next.pr = { kind: "absent" };
  if (!("restoreTarget" in next)) {
    const command =
      typeof next.lastAgentCommand === "string"
        ? next.lastAgentCommand
        : undefined;
    if (command !== undefined) {
      // Validate the captured ref's VALUE types, not just key presence: a corrupt
      // on-disk `agentSession` (a non-`AgentKind` `kind`, a non-string `id`) must NOT
      // build an `exact` target that fails `RestoreTargetSchema` and drops the whole
      // terminal at the read boundary. A bad ref falls to `legacyMostRecent` (resume
      // most-recent — still valid, the same degraded behavior the pre-cutover record
      // already had).
      const ref =
        agentSession && typeof agentSession === "object"
          ? (agentSession as Record<string, unknown>)
          : null;
      const kind = ref ? AgentKindSchema.safeParse(ref.kind) : null;
      // Route through `exactRestoreTarget` so the SAME command/agent-kind consistency
      // gate the live fold enforces also applies here: a migrated record whose old
      // `agentSession.kind` disagrees with the remembered `lastAgentCommand`'s agent
      // kind (corrupt / hand-edited / cross-agent) falls to `legacyMostRecent` rather
      // than building a mismatched `exact` that would silently resume the wrong agent.
      const exact =
        ref && kind?.success && typeof ref.id === "string"
          ? exactRestoreTarget(command, { kind: kind.data, sessionId: ref.id })
          : null;
      next.restoreTarget = exact ?? { kind: "legacyMostRecent", command };
    }
  }
  return next;
}

/** Bring one legacy saved-terminal record up to the current
 *  `SavedTerminalSchema` by composing every field backfill above. Order-free
 *  (each is idempotent + presence-keyed); spelled in ladder order for reading. */
export function backfillSavedTerminal(
  t: Record<string, unknown>,
): Record<string, unknown> {
  return backfillSnapshotCutover(
    backfillTerminalState(backfillLocation(backfillRemoteUrl(t))),
  );
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
