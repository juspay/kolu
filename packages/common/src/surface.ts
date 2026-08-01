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
 * terminal identity) are OWNED by `@kolu/terminal-vocab/schema` (P1a) and
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

// The host-daemon inventory shapes live in @kolu/padi's OWN surface vocabulary — padi
// owns the daemon domain (a kaval gate pid is a padi-domain fact, not terminal
// awareness). kolu-common's `daemonInventory` cell composes them here via the established
// `kolu-common → @kolu/padi` direction (the same edge `surfacesWithPadi`/`contract` use);
// the seal forbids the REVERSE (padi importing kolu). Types re-exported below so existing
// `kolu-common/surface` importers are unchanged.
import {
  HostDaemonInventorySchema,
  type NewTerminalPolicy,
  type ToastOnlyPolicy,
} from "@kolu/padi/surface";
import {
  defineSurfaceWithPolicy,
  type SurfaceTypes,
} from "@kolu/surface/define";
import {
  type BuildInfo,
  defineBuildInfo,
  surfaceAppSurfaceWith,
} from "@kolu/surface-app/surface";
// The honest three-way process-RSS union — composed below into `ProcessMemorySchema`.
// Owned by the shared browser-safe leaf so both sides of the padi seal read one
// declaration; its `ProcessRss` type is re-exported above for this module's importers.
import {
  type ProcessRss,
  ProcessRssSchema,
  TcpPortSchema,
} from "@kolu/terminal-vocab/schema";
// The host key, from its own padi-LESS module — the forward vocabulary below is
// keyed by it, so a row can be filtered to a terminal's host without parsing an
// ssh string. `./hostKey.ts` imports nothing of padi, so this keeps the seal.
import { HostKeySchema } from "./hostKey.ts";
import type { TaskProgressSchema } from "anyagent/schemas";
import { match } from "ts-pattern";
import { z } from "zod";

// The host-daemon inventory row TYPES are re-exported from @kolu/padi/surface (their
// home) so existing `kolu-common/surface` importers (the client dialogs) keep resolving
// them here — the schema home moved to the daemon-domain package, the consumers didn't.
export type { RunningKaval, RunningPadi } from "@kolu/padi/surface";
// kolu's app-owned client-error-policy union (SR11) — its home is `@kolu/padi`
// (so `padiSurface`'s members can reference it without the seal-forbidden
// `@kolu/padi → kolu-common` import); re-exported HERE so `koluSurface` above and
// the kolu client (`interpretClientError` in `wire.ts`) reach it through their
// usual `kolu-common/surface` door.
export type { ClientErrorPolicy, ToastOnlyPolicy } from "@kolu/padi/surface";
// The RESOLVED new-terminal theme policy — same seal reason as the error policy
// above: it types a `padiSurface` cell, so it is DECLARED in `@kolu/padi`
// (`newTerminalPolicy.ts`) and reaches `koluSurface`'s derivation below, and the
// kolu client, through this door.
export {
  DEFAULT_NEW_TERMINAL_POLICY,
  type NewTerminalPolicy,
  NewTerminalPolicySchema,
} from "@kolu/padi/surface";
export type {
  AgentPaintClass,
  AlertClass,
  AttentionClass,
  Urgency,
} from "@kolu/terminal-vocab/agentProjection";
// The renderer-agnostic agent-state projection (bucket · urgency · needs-you
// rank) is OWNED by `@kolu/terminal-vocab/agentProjection` — the ONE source
// padi-tui and downstream dashboards (drishti) already share. The kolu client reaches it through the
// SAME door it already uses for the awareness schema (this module) rather than a
// second, direct `@kolu/terminal-vocab` edge, so the Dock joins as a third
// consumer of the same definition instead of re-deriving "needs-you".
export {
  agentBucket,
  agentPaintClass,
  agentUrgency,
  alertClass,
  ATTENTION_CLASSES,
  attentionActive,
  attentionClass,
  attentionCounted,
  DASH,
  paintClassOf,
  URGENCY_RANK,
} from "@kolu/terminal-vocab/agentProjection";
export type {
  AgentIdentity,
  AgentInfo,
  AgentKind,
  AgentMemory,
  ClaudeCodeInfo,
  CodexInfo,
  Foreground,
  GrokInfo,
  OpenCodeInfo,
  PortInfo,
  ProcessRss,
  PrResult,
  PrUnavailableSource,
  RestoreTarget,
  TerminalId,
  TerminalSnapshot,
} from "@kolu/terminal-vocab/schema";
// ── Re-exports — the awareness domain moved to @kolu/terminal-vocab (P1a) ──
//
// The generic `TerminalSnapshot` (terminal identity, agent status, PR resolution,
// foreground) is OWNED by `@kolu/terminal-vocab/schema` now. kolu-common
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
  foldPorts,
  knownPorts,
  type PortFamily,
  PortFamilySchema,
  type PortReach,
  type TerminalPorts,
  portReach,
  preferredFamily,
  samePortList,
  TcpPortSchema,
  PrResultSchema,
  PrUnavailableSourceSchema,
  prUnavailableReason,
  prUnavailableSource,
  RestoreTargetSchema,
  reasonForSource,
  resumableCommand,
  TERMINAL_IDLE_AFTER_MS,
  TerminalIdSchema,
  TerminalSnapshotSchema,
} from "@kolu/terminal-vocab/schema";

// ── User preferences (server-side, shared with client) ────────────────

export const ColorSchemeSchema = z.enum(["light", "dark", "system"]);

/** Which way the viewer's OS is leaning — the raw `prefers-color-scheme` media
 *  query answer, nothing folded in. An OBSERVATION, not a preference: the user
 *  never sets it, the browser reports it, and it matters only when
 *  `colorScheme === "system"` (see {@link resolveIsDark}). Kept RAW on the wire
 *  so the resolution against `colorScheme` happens in exactly one place. */
export const ViewerModeSchema = z.enum(["dark", "light"]);

/** How a newly created terminal gets its theme. `inherit` copies the active
 *  terminal's theme (like new terminals inherit its size — set one theme once
 *  and every new terminal follows; the first terminal seeds from the server
 *  default); `shuffle` auto-picks a distinct tint via {@link ShuffleBehaviorSchema}. */
export const NewTerminalThemeSchema = z.enum(["inherit", "shuffle"]);

/** Which themes a *shuffle* draws from — both a `shuffle` new terminal and the
 *  ⌘⇧J "Shuffle theme" action. `random` spreads across the whole catalogue;
 *  `dark`/`light` restrict to that luminance family; `auto` tracks the app's
 *  resolved light/dark mode; `colourful` prefers saturated (non-grey) tints
 *  across light and dark. */
export const ShuffleBehaviorSchema = z.enum([
  "random",
  "dark",
  "light",
  "auto",
  "colourful",
]);

/** Right-panel preferences — workspace-level layout chrome: the panel's width
 *  and the Code-tab tree/content split. Both are viewer density taste — tuned
 *  once and left put, with real writers (`setPanelSize`/`setCodeTabTreeSize`).
 *  The LIVE per-panel `collapsed` state follows the terminal (#959) on
 *  `RightPanelPerTerminalStateSchema`; the new-terminal collapsed DEFAULT is the
 *  top-level `newTerminalCollapsed` preference (beside `newTerminalTheme`), NOT
 *  a field here — so this record carries only live-written geometry. Everything
 *  else *about* what each terminal is doing (active tab, code sub-mode, selected
 *  file) lives on the per-terminal record, not here. */
export const RightPanelPrefsSchema = z.object({
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
  /** Whether a NEW terminal opens with its right panel collapsed. A
   *  copy-on-create seed: it lives here (a top-level new-terminal default,
   *  same seed shape as `newTerminalTheme`) rather than on `rightPanel`, whose
   *  fields are all live-written geometry. `freshPerTerminalState` reads it
   *  through when seeding a terminal's per-terminal record; the terminal owns
   *  its own `collapsed` thereafter (a toggle writes the terminal's record,
   *  never this). Read-through, not baked-at-create — and there is no settings
   *  UI to write it yet, so in production it stays the default. */
  newTerminalCollapsed: z.boolean(),
  /** Which themes any shuffle draws from — a `shuffle` new terminal and the
   *  ⌘⇧J action alike — see {@link ShuffleBehaviorSchema}. */
  shuffleBehavior: ShuffleBehaviorSchema,
  scrollLock: z.boolean(),
  attentionAlerts: z.boolean(),
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

export type ColorScheme = z.infer<typeof ColorSchemeSchema>;
export type NewTerminalTheme = z.infer<typeof NewTerminalThemeSchema>;
export type ShuffleBehavior = z.infer<typeof ShuffleBehaviorSchema>;
export type ViewerMode = z.infer<typeof ViewerModeSchema>;

/** The candidate-pool filter a shuffle should apply, from the
 *  `shuffleBehavior` preference and the app's resolved dark mode.
 *  `undefined` means no restriction (`random` — the whole catalogue).
 *  Otherwise `"light"` / `"dark"` / `"colourful"` — the same literals
 *  `pickTheme`'s `mode` accepts (`ThemePickMode` in terminal-themes). The
 *  single source of truth for every shuffle: a `shuffle` new terminal AND the
 *  ⌘⇧J action both resolve their pool through here. */
export function shuffleMode(
  behavior: ShuffleBehavior,
  isDark: boolean,
): "light" | "dark" | "colourful" | undefined {
  return match(behavior)
    .with("random", () => undefined)
    .with("dark", () => "dark" as const)
    .with("light", () => "light" as const)
    .with("auto", () => (isDark ? ("dark" as const) : ("light" as const)))
    .with("colourful", () => "colourful" as const)
    .exhaustive();
}

/** Is the app in dark mode — the `colorScheme` preference folded against the
 *  viewer's raw OS reading. The ONE resolution: the client's `isDark` memo
 *  (`settings/useColorScheme.ts`) and kolu-server's policy derivation below both
 *  call it, so a browser and the daemon can never disagree about what "system"
 *  currently means. */
export function resolveIsDark(
  colorScheme: ColorScheme,
  prefersDark: boolean,
): boolean {
  return colorScheme === "dark" || (colorScheme === "system" && prefersDark);
}

/** The RESOLVED new-terminal theme policy kolu-server pushes into padi's
 *  `newTerminalPolicy` cell — the ONE point where the three preferences and the
 *  viewer's OS mode fold into a fact padi can act on without knowing any of them.
 *  `"auto"` is spent here and never crosses the wire; `shuffleMode`'s
 *  `undefined` (no family restriction) becomes the policy's explicit `"random"`,
 *  because a wire union does not get to say "absent". */
export function resolveNewTerminalPolicy(
  prefs: Pick<
    Preferences,
    "newTerminalTheme" | "shuffleBehavior" | "colorScheme"
  >,
  viewerMode: ViewerMode,
): NewTerminalPolicy {
  return match(prefs.newTerminalTheme)
    .with("inherit", () => ({ kind: "inherit" }) as const)
    .with(
      "shuffle",
      () =>
        ({
          kind: "shuffle",
          mode:
            shuffleMode(
              prefs.shuffleBehavior,
              resolveIsDark(prefs.colorScheme, viewerMode === "dark"),
            ) ?? "random",
        }) as const,
    )
    .exhaustive();
}

export type TaskProgress = z.infer<typeof TaskProgressSchema>;

/** Default preference values — single source of truth for server and client. */
export const DEFAULT_PREFERENCES: z.infer<typeof PreferencesSchema> = {
  seenTips: [],
  startupTips: true,
  newTerminalTheme: "shuffle",
  newTerminalCollapsed: false,
  shuffleBehavior: "auto",
  scrollLock: true,
  attentionAlerts: true,
  colorScheme: "dark",
  terminalRenderer: "auto",
  rightPanel: {
    size: 0.25,
    codeTabTreeSize: 0.35,
  },
};

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

/** Live process-memory readout for the chrome bar's identity rail — the RSS of the
 *  three server-side processes the rail names. The CLIENT's own JS-heap figure is
 *  NOT here: it's a browser-local fact read off `performance.memory` in the client
 *  (no wire round-trip), so this cell carries only what the client can't measure
 *  itself.
 *
 *  `serverRssBytes` is the kolu-server process (a plain number — always present, it
 *  is measuring ITSELF). `padi` + `kaval` are the padi PROCESS and its kaval daemon
 *  — a SEPARATE process pair kolu-server no longer runs in-process (W2.2). padi
 *  serves its OWN `{ padi, kaval }` readout on `padiSurface.processMemory`; the
 *  server's sampler folds that reading in here so the rail reads one cell. Each is
 *  the honest {@link ProcessRssSchema} three-way so the rail can tell "the process
 *  is down" (`absent`) apart from "its RSS read failed" (`error`), never a fake
 *  zero — when padi is down both read `absent`. */
export const ProcessMemorySchema = z.object({
  serverRssBytes: z.number(),
  padi: ProcessRssSchema,
  kaval: ProcessRssSchema,
});
export type ProcessMemory = z.infer<typeof ProcessMemorySchema>;

/** kolu-server's live view of its binding to the local padi — the client folds this
 *  into the warming/degraded canvas so a padi drop shows an honest connecting state,
 *  never a frozen-but-live-looking world (#1034). Server-authored (kolu-server drives
 *  it off the bound padi session's connection state); clients read-only.
 *
 *    - `connecting` — the binding is (re)establishing (boot, or reconnecting after a drop);
 *    - `connected`  — kolu-server is bound to a live padi;
 *    - `degraded`   — the binding dropped (padi is down / the reconnect loop is re-dialing).
 *
 *  The kaval `daemonStatus` the canvas reads rides padi's RE-SERVED surface, whose
 *  value-fold HOLDS STALE while padi is unbound — so the client floors that status on
 *  THIS leg too (padiLink === "connected"), exactly as it already floors on the
 *  browser↔server ws liveness, and treats a not-`connected` link as the honest "coming
 *  up" (warming) rather than trusting the frozen re-served state. */
export const PadiLinkSchema = z.enum(["connecting", "connected", "degraded"]);
export type PadiLink = z.infer<typeof PadiLinkSchema>;

/** Live boot-time readout for the identity rail's uptime — kolu-server's OWN boot
 *  time and the bound padi's. Server-authored (kolu-server stamps its own boot at
 *  module init and reads padi's honest `startedAt` off the bound session's control-core
 *  `hello`); clients read-only and render `now − startedAt`. kaval's boot time is NOT
 *  here — it already rides `daemonStatus.startedAt` (the Kaval dialog's uptime source),
 *  so this cell carries only the two processes that lacked one.
 *
 *  Honesty (#1034): `server` is `null` until the first server yield — an epoch of `0`
 *  is a real (if absurd) timestamp, not a safe in-band "unknown" sentinel, so the
 *  pre-yield state is the same honest `null` its `padi` sibling already uses, never a
 *  bogus multi-decade uptime climbing off `now − 0`. `padi` is `null` whenever padi is
 *  unbound (the (re)connecting / dropped binding) — an honest "unknown", never a fake
 *  `0`, and it re-reads a FRESH boot time when a respawned padi (a new process) binds. */
export const ProcessStartedAtSchema = z.object({
  server: z.number().nullable(),
  padi: z.number().nullable(),
});
export type ProcessStartedAt = z.infer<typeof ProcessStartedAtSchema>;

/**
 * Wire-facing convergence identity — the same two axes the framework's
 * `ConvergenceIdentity` uses (`@kolu/surface-daemon`). Carried as data on every
 * arm that has a running/expected daemon; never padded with `z.null()`.
 */
export const DaemonBuildSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("known"), id: z.string() }),
  z.object({ kind: z.literal("off-nix") }),
]);
export type DaemonBuildWire = z.infer<typeof DaemonBuildSchema>;

export const ConvergenceIdentitySchema = z.object({
  contractVersion: z.string(),
  build: DaemonBuildSchema,
});
export type ConvergenceIdentityWire = z.infer<typeof ConvergenceIdentitySchema>;

/**
 * Drain-budget instance key on the wire — named instance or `pre-instance`
 * (absent startedAt = older daemon). Never an overloaded null.
 */
export const InstanceKeySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("instance"),
    key: z.union([z.string(), z.number()]),
  }),
  z.object({ kind: z.literal("pre-instance") }),
]);
export type InstanceKeyWire = z.infer<typeof InstanceKeySchema>;

/** A STANDING, user-visible convergence anomaly the (remote) binder entered — the dialog
 *  shows it so nothing is "magically swallowed" into server logs. `null`/absent = the
 *  healthy converged case (no banner). Rides {@link DaemonInventorySchema.boundPadi}
 *  because that is the ONE binder→dialog channel orthogonal to the liveness gate: an
 *  `adopted-stale` keeps the connection `connected` (canvas alive) yet must still say WHY,
 *  which the connection cell (gated to `state === "connected"`) structurally cannot.
 *
 *  The wire shape **is** the framework's `ConvergenceAnomaly` union (plus app-only
 *  `link-failed`). Each arm carries its own typed evidence — no `z.null()` padding,
 *  no converter that throws facts away. Discriminant is `kind` (same as the framework).
 *  A UI must never parse `detail`; it reads the typed fields. */
export const PadiConvergenceSchema = z.discriminatedUnion("kind", [
  z.object({
    /** A build-mismatched survivor we could not drain-replace within the budget —
     *  we RIDE it, canvas works. Evidence: running + expected identities. */
    kind: z.literal("adopted-stale"),
    running: ConvergenceIdentitySchema,
    expected: ConvergenceIdentitySchema,
    detail: z.string(),
  }),
  z.object({
    /** An incompatible padiSurface contract (binder older) we won't adopt. */
    kind: z.literal("skew-refused"),
    running: ConvergenceIdentitySchema,
    expected: ConvergenceIdentitySchema,
    detail: z.string(),
  }),
  z.object({
    /** Drain/budget give-up that left canvas dead — typed cause evidence. */
    kind: z.literal("unconverged"),
    /** null when running identity is honestly unknown (e.g. initial probe failed). */
    running: ConvergenceIdentitySchema.nullable(),
    expected: ConvergenceIdentitySchema,
    cause: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("budget-exhausted"),
        axis: z.enum(["contract", "build"]),
        attempts: z.number().int(),
        maxAttempts: z.number().int(),
      }),
      z.object({
        kind: z.literal("drain-not-taken"),
        axis: z.enum(["contract", "build"]),
        ceilingMs: z.number(),
        rejection: z.string().nullable(),
      }),
      z.object({
        kind: z.literal("adopt-bind-failed"),
        axis: z.enum(["contract", "build"]).nullable(),
      }),
      z.object({ kind: z.literal("identity-unverifiable") }),
      z.object({
        kind: z.literal("probe-failed"),
        message: z.string(),
      }),
    ]),
    detail: z.string(),
  }),
  z.object({
    /** Another supervisor is respawning this host's padi — fail-honest, never ride
     *  a contested build. Evidence: drained + observed instance keys. */
    kind: z.literal("cross-supervisor"),
    drained: InstanceKeySchema,
    observed: InstanceKeySchema,
    running: ConvergenceIdentitySchema,
    detail: z.string(),
  }),
  z.object({
    /** The ssh link gave up (host unreachable / provisioning failed). App-only;
     *  not a framework convergence verdict. */
    kind: z.literal("link-failed"),
    detail: z.string(),
  }),
]);
export type PadiConvergence = z.infer<typeof PadiConvergenceSchema>;

/** Where kolu-server's padi is bound — and, when that is NOT the machine kolu-server
 *  itself runs on, its own-machine scan. The discriminant makes the coupling a TYPE, not
 *  prose: `local` carries no scan (kolu is bound to the local padi, whose `hostInventory`
 *  member already describes this machine — a second copy would show two lists for one
 *  truth), and `remote` ALWAYS carries both the `host` and the `localScan`. The illegal
 *  pairings — a local binding with a scan, or a remote binding missing its host/scan — are
 *  UNREPRESENTABLE, so a future writer cannot drift them apart. The BOUND host's own
 *  daemons never ride this cell either way: they ride padiSurface's `hostInventory` member
 *  (works local and remote). `local` is the honest pre-first-sample default. */
export const DaemonBindingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local") }),
  z.object({
    kind: z.literal("remote"),
    /** The ssh host the padi is bound to (`KOLU_PADI_HOST`) — drives the dialog's
     *  machine labels ("daemons on <host>" + "this machine, not the bound host"). */
    host: z.string(),
    /** kolu-server's scan of the machine it ITSELF runs on — NOT the bound host, so a
     *  leaked daemon on the box you're actually using stays visible. The same @kolu/padi
     *  scanner the member uses, marking NONE active (kolu is bound elsewhere). */
    localScan: HostDaemonInventorySchema,
  }),
]);
export type DaemonBinding = z.infer<typeof DaemonBindingSchema>;

export const DaemonInventorySchema = z.object({
  /** The binding + (remote-only) own-machine scan — see {@link DaemonBindingSchema}. */
  binding: DaemonBindingSchema,
  /** The BOUND padi's honest identity off its control-core `hello` — `surfaceVersion` +
   *  `buildCommit` — for BOTH arms (local socket OR remote ssh). The Padi dialog's
   *  version chip + build-commit row read THIS, not the local-scan `active` row: under a
   *  remote binding no locally-discovered padi is kolu's active one, so that row is null
   *  and the identity must instead ride the bound session's readouts (which work over
   *  ssh). `null` before the first sample / while padi is unbound with nothing to report.
   *
   *  There is EXACTLY ONE way to say "nothing to report": the top-level `null` above —
   *  never the inner object with all three of `surfaceVersion`/`buildCommit`/`convergence`
   *  also null. Without the `.refine` below, both shapes typecheck and mean the same
   *  thing, so a future writer could drift between them for no reason; the publisher
   *  (`server/src/padi/daemonInventory.ts`) already special-cases "all three null → publish
   *  `null` itself" for exactly this reason — the refine makes that the ONLY legal
   *  encoding rather than a convention a future call site could quietly break. */
  boundPadi: z
    .object({
      surfaceVersion: z.string().nullable(),
      buildCommit: z.string().nullable(),
      /** A STANDING convergence anomaly (adopted-stale / skew-refused / unconverged /
       *  link-failed), or null when converged/healthy. So the dialog surfaces a degraded
       *  bind — build mismatch, contract skew, drain-failure, provisioning failure — as a
       *  visible state, not just server logs. Non-null even when the identity above is null
       *  (a refused/failed bind has a reason but no adopted identity). */
      convergence: PadiConvergenceSchema.nullable(),
    })
    .refine(
      (v) =>
        v.surfaceVersion !== null ||
        v.buildCommit !== null ||
        v.convergence !== null,
      {
        message:
          "boundPadi: nothing to report is the top-level null, not an inner object with every field null",
      },
    )
    .nullable(),
});
export type DaemonInventory = z.infer<typeof DaemonInventorySchema>;

// ── Port forwards (PRT2) ──────────────────────────────────────────────
//
// The doors kolu's server holds open so a port that answers only on some other
// machine's loopback answers on the name in the viewer's address bar. The
// MECHANISM is `@kolu/port-forward` (an ssh child per remote forward, an
// in-process relay for the kolu host's own loopback); what lives here is only
// the wire shape kolu's UI renders and acts on.
//
// They ride koluSurface rather than padi's, and that is the honest home: the
// listener is on the KOLU SERVER's machine, opened by the kolu server process,
// and dies with it. A forward for a remote host's port is not a fact about that
// host — it is a fact about this server.

/** WHY a forward exists, which is the whole of its death policy.
 *
 *  `auto` — kolu opened it because someone clicked a port chip. It is a
 *  convenience attached to a listener the scanner can see, so when the scanner
 *  reports that listener gone the door has nothing left behind it and closes.
 *  `manual` — someone asked for this target by name (⌘K, or the Inspector's
 *  "Forward a port…" row). It may point at something no scanner watches — a port
 *  outside every terminal's subtree, a service started before kolu — so nothing
 *  but an explicit cancel or the host's departure may close it. Guessing here
 *  would silently close the forward a user deliberately set up. */
export const ForwardOriginSchema = z.enum(["auto", "manual"]);
export type ForwardOrigin = z.infer<typeof ForwardOriginSchema>;

/** One live forward, as every kolu surface renders it. */
export const KoluForwardSchema = z.object({
  /** The forward map's own key, and the handle `forwards.cancel` takes. Opaque
   *  to the client on purpose: it is the library's identity for this target, so
   *  a row cancels exactly what it displays with no re-derivation in between. */
  key: z.string(),
  /** WHOSE host the far end is on — the kolu host key, not an ssh string, so a
   *  row can be filtered to the active terminal's host without parsing. */
  host: HostKeySchema,
  /** The port on `host` that the forward points at. */
  remotePort: TcpPortSchema,
  /** The port it answers on, on every interface of the KOLU SERVER's host —
   *  the number that goes in the URL. */
  localPort: TcpPortSchema,
  origin: ForwardOriginSchema,
  /** Epoch ms when the listener came up — what an "up 12m" column renders. */
  createdAt: z.number(),
});
export type KoluForward = z.infer<typeof KoluForwardSchema>;

/** Every live forward, oldest first. A plain array rather than a collection:
 *  the whole set is a handful of rows, every consumer renders all of them
 *  (filtered by host at most), and there is no per-key subscription anyone
 *  wants. */
export const ForwardsSchema = z.array(KoluForwardSchema);
export type Forwards = z.infer<typeof ForwardsSchema>;

/** What `forwards.create` takes. `origin` is the CALLER's to declare because only
 *  the caller knows why it is asking — a chip click is `auto`, a typed target is
 *  `manual` — and that reason is what decides whether the forward may be closed
 *  without being asked. */
export const ForwardCreateInputSchema = z.object({
  host: HostKeySchema,
  port: TcpPortSchema,
  origin: ForwardOriginSchema,
});
export type ForwardCreateInput = z.infer<typeof ForwardCreateInputSchema>;

/** What `forwards.cancel` takes — the key off the row being cancelled. */
export const ForwardCancelInputSchema = z.object({ key: z.string() });

/** Fields `key` already determines, so comparing them adds nothing: `targetKey`
 *  encodes `local:<port>` / `remote:<host>:<port>`, so two rows agreeing on
 *  `key` cannot disagree on either.
 *
 *  Excluding them is what keeps the read-off-the-schema promise below TRUE.
 *  `host` is the one object-valued field, and comparing it needed a hand-coded
 *  arm — which quietly made the promise false, because the NEXT object-valued
 *  field would fall through to `===`, compare by reference across freshly minted
 *  rows, never match, and silently stop the dedup with nothing to report why. */
const FORWARD_KEYS_DETERMINED_BY_KEY = new Set(["host", "remotePort"]);

/** The comparison keys, READ OFF the schema so a new `KoluForward` field is
 *  compared with no second edit here — the `PORT_INFO_KEYS` mechanism
 *  (`@kolu/terminal-vocab` ports vocabulary), for its reason: this is a DEDUP gate, so a field it
 *  does not compare is a field whose changes are swallowed, with nothing anywhere
 *  to report why the row never updated. */
const FORWARD_KEYS = Object.keys(KoluForwardSchema.shape).filter(
  (k) => !FORWARD_KEYS_DETERMINED_BY_KEY.has(k),
) as (keyof KoluForward)[];

/** Are two forward lists the same fact? The cell's wire dedup point: the list is
 *  republished whenever the map moves, and a re-publish that changes nothing
 *  would tick every reader. Field-wise rather than `JSON.stringify` because key
 *  order in a serialization is not a fact. */
export function sameForwards(a: Forwards, b: Forwards): boolean {
  return (
    a.length === b.length &&
    a.every((f, i) => {
      // `noUncheckedIndexedAccess` types `b[i]` as possibly `undefined`; the
      // guard below is what makes that honest rather than a `b[i]!` the
      // compiler can't verify — `a.length === b.length` (checked above) means
      // it never actually fires, but the type system has no way to know that.
      const g = b[i];
      if (g === undefined) return false;
      // Every compared field is a PRIMITIVE, which is what makes the
      // read-off-the-schema promise true: a new field is covered here with no
      // second edit. `host` and `remotePort` are deliberately not in the set —
      // both are fully determined by `key` (`targetKey` encodes
      // `local:<port>` / `remote:<host>:<port>`), so comparing them adds
      // nothing, and `host` being an object needed a hand-coded arm that
      // quietly made the promise false: the NEXT object-valued field would
      // have fallen through to `===`, compared by reference across freshly
      // minted rows, never matched, and silently stopped the dedup.
      return FORWARD_KEYS.every((k) => f[k] === g[k]);
    })
  );
}

/** The honest pre-sample default — `local` binding (no own-machine scan to show yet),
 *  `boundPadi` null. The sampler's T+0 tick replaces it with the real binding at once; a
 *  fresh subscription renders no fabricated daemons until then. */
export const DEFAULT_DAEMON_INVENTORY: DaemonInventory = {
  binding: { kind: "local" },
  boundPadi: null,
};

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

/** Two per-process RSS readings render the same whole-MB figure — same status and,
 *  when `ok`, the same whole megabytes (an `absent`/`error` pair carries no number
 *  to compare). */
function rssMbEqual(a: ProcessRss, b: ProcessRss): boolean {
  if (a.status !== b.status) return false;
  if (a.status === "ok" && b.status === "ok") {
    return bytesToWholeMB(a.rssBytes) === bytesToWholeMB(b.rssBytes);
  }
  return true;
}

/** Two readouts are equal when all three processes render the same whole-MB figure
 *  — the `processMemory` cell's `equals`, so a sub-MB RSS wobble never re-publishes
 *  to every connected client. Declared HERE at the spec (the derived poll cell is
 *  the one writer, per the reactive bridge's "equals lives at the member, once"
 *  law) and built on the shared {@link bytesToWholeMB} so the dedup boundary and the
 *  client's rendered figure are one computation. */
export function processMemoryMbEqual(
  a: ProcessMemory,
  b: ProcessMemory,
): boolean {
  return (
    bytesToWholeMB(a.serverRssBytes) === bytesToWholeMB(b.serverRssBytes) &&
    rssMbEqual(a.padi, b.padi) &&
    rssMbEqual(a.kaval, b.kaval)
  );
}

export interface KoluBuildInfo extends BuildInfo {
  /** App version (X.Y.Z) — the rail's `srv` column shows it as `vX.Y.Z` beside the
   *  commit. Optional only in the library-seeded default (`{ commit }`); once
   *  the async buildInfo patch resolves it's always present — `pkg.version`,
   *  even in dev. The `expectedKaval` axis this cell once carried moved to padi's
   *  `status` cell in W1.R7 (so a kaval read no longer crosses `packages/server`). */
  version?: string;
}

export const koluBuildInfo = defineBuildInfo<KoluBuildInfo>({
  schema: z.object({
    commit: z.string(),
    version: z.string().optional(),
  }),
  default: { commit: "" },
});

// ── The surfaces ──────────────────────────────────────────────────────
//
// kolu serves TWO sibling surfaces over one transport (kolu#1197, R8) — plus the
// `padi` sibling kolu-server adds locally (`server/src/surface.ts`):
//
//   - `koluSurface` — the primitives kolu OWNS that are NOT part of the terminal
//     domain: the `preferences` + `processMemory` + `padiLink` + `processStartedAt`
//     cells. Served under the `kolu` key. Every terminal-DERIVED member (`activityFeed`, `session`,
//     the `terminalExit` event, the per-terminal record, urgency, daemon status,
//     the expected-kaval axis) relocated to `@kolu/padi` (the package-boundary
//     seal) — so koluSurface has NO collections and NO events, and the terminal
//     RECORD rides padi's `terminals` collection, not here.
//   - `surfaceAppSurface_kolu` — surface-app's COMPLETE surface (the
//     build-identity `buildInfo` cell — `commit` + `version` — plus the
//     `identity.info` restart probe). Served under the `surfaceApp` key. Its wire
//     path is `surface.surfaceApp.{buildInfo,identity}`. The `expectedKaval` axis
//     it once extended `buildInfo` with moved to padi's `status` cell (W1.R7).
//
// The GENERIC `@kolu/terminal-vocab` surface is no longer served here: kolu's
// own client reads padi's server-composed `terminals` collection, so kolu-server's
// dormant `terminalWorkspace` sibling had zero consumers and was retired (W1.R7).
// Its `terminalWorkspaceSurface` — and the `pulam` daemon that once served it —
// were BURIED at padi W2.3; the per-host terminal surface is `padiSurface` now.
//
// They are NOT merged — `composeSurfaceContracts` / `implementSurfaces` /
// `surfaceClients` multiplex them, each namespaced by its key. Each is already a
// complete surface; we serve them as siblings rather than splicing their halves
// into one surface.

/** surface-app served as a sibling, extended with kolu's build identity. */
export const surfaceAppSurface_kolu = surfaceAppSurfaceWith(koluBuildInfo);

/** The primitives kolu OWNS that are NOT part of the terminal domain —
 *  `preferences` (local-authority user prefs), `processMemory` (the live
 *  server+kaval RSS rail metric), `padiLink` (kolu-server's live view of its
 *  binding to padi — a #1034 canvas-honesty leg), and `processStartedAt` (the
 *  server + padi boot times the rail renders as uptime). Every terminal-DERIVED wire member —
 *  `activityFeed`, `session`, the `terminalExit` event, the terminal record,
 *  urgency, daemon status — now rides `padiSurface` (the package-boundary seal):
 *  only the conf-store STORAGE for session/activityFeed stays kolu-server-side
 *  (injected INTO padi at boot) until W2.2 gives padi its own state-root. So this
 *  surface serves NO collections and NO events. surface-app's buildInfo/identity
 *  ride the sibling surface above, not here. */
export const koluSurface = defineSurfaceWithPolicy<ToastOnlyPolicy>()({
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
      // Local-authority on the client (optimistic writes, server-canonical on disk);
      // the coalesce window trailing-debounces size drags (#1041). NO `initial` — the
      // local store seeds from the mandatory `default` above. `onError` covers both a
      // subscription drop and a coalesced-flush failure.
      client: {
        authority: "local",
        coalesceMs: 150,
        onError: { kind: "toast", label: "Preferences" },
      },
    },

    /** The viewer's raw OS light/dark reading (see {@link ViewerModeSchema}) —
     *  published by the browser, remembered on disk by kolu-server, and consulted
     *  ONLY when `colorScheme === "system"`. It rides beside `preferences`
     *  because it is the other input to {@link resolveNewTerminalPolicy}, but it
     *  is deliberately NOT a preference field: nobody chooses it, and a headless
     *  face (MCP, CLI) has no reading of its own to offer — it uses the last one a
     *  browser reported. Server-authority (a scalar cell cannot be
     *  local-authority) and writable, so the browser publishes with a plain `set`.
     *  `default: "dark"` matches `DEFAULT_PREFERENCES.colorScheme`, so a server
     *  that has never seen a browser resolves exactly as a default install does. */
    viewerMode: {
      schema: ViewerModeSchema,
      default: "dark" satisfies ViewerMode,
      // The one wire dedup point: a browser re-publishing the same reading (every
      // reconnect does) never re-notifies, and never re-fires the policy push.
      equals: (a, b) => a === b,
      verbs: ["get", "set"],
      client: { onError: { kind: "toast", label: "Viewer mode" } },
    },

    /** Live process-memory readout (kolu-server + padi + kaval RSS) for the rail.
     *  A DERIVED poll cell (`derived.cell(source(...))` in `server/src/index.ts`), so
     *  the reactor graph is the one writer — no ctx `.set`; clients read-only. It
     *  samples kolu-server's own RSS and FOLDS IN padi's `{ padi, kaval }` reading off
     *  the re-served padi surface — `padi`/`kaval` are `absent` until the first fold,
     *  and whenever padi is down. */
    processMemory: {
      schema: ProcessMemorySchema,
      default: {
        serverRssBytes: 0,
        padi: { status: "absent" },
        kaval: { status: "absent" },
      } satisfies z.infer<typeof ProcessMemorySchema>,
      // Whole-MB dedup — a DERIVED poll cell (`derived.cell(source(...))` in
      // `server/src/index.ts`), so the graph is the one writer and `equals` is the
      // ONE wire dedup point, declared here at the member (the reactive bridge's law).
      // A sub-MB RSS wobble never re-publishes to every connected client.
      equals: processMemoryMbEqual,
      verbs: ["get"],
      client: { onError: { kind: "toast", label: "Memory readout" } },
    },

    /** kolu-server's live view of its binding to the local padi (see
     *  {@link PadiLinkSchema}). Server-authored — a DERIVED PUSH cell scanning the bound
     *  padi's `onState` (`server/src/surface.ts`), so the reactor graph is the one writer
     *  (no ctx `.set`); clients read-only. The client folds it into the warming/degraded
     *  canvas so a padi drop shows an honest connecting state, never a frozen-but-live
     *  world (#1034). Gate-closed default `connecting`, so a fresh subscription reads
     *  "coming up" before the first transition rather than a premature `connected`. */
    padiLink: {
      schema: PadiLinkSchema,
      default: "connecting" satisfies PadiLink,
      // The derived cell's one wire dedup point: a repeated same-link transition
      // (onState fires once per endpoint status, several map to the same padiLink) never
      // re-publishes to every connected client.
      equals: (a, b) => a === b,
      verbs: ["get"],
      client: { onError: { kind: "toast", label: "padi link status" } },
    },

    /** Live boot-time readout (kolu-server + padi) for the rail's uptime (see
     *  {@link ProcessStartedAtSchema}). Server-authored — a DERIVED PUSH cell scanning the
     *  SAME padi `onState` that drives `padiLink` (`server/src/surface.ts`), so the graph
     *  is the one writer (no ctx `.set`); clients read-only. The `{ server: null, padi:
     *  null }` default is the honest pre-yield "unknown" for BOTH legs — no `0` sentinel
     *  (the rail gates a `null` out rather than rendering a bogus uptime off a fabricated
     *  boot time). */
    processStartedAt: {
      schema: ProcessStartedAtSchema,
      default: { server: null, padi: null } satisfies z.infer<
        typeof ProcessStartedAtSchema
      >,
      // The derived cell's one wire dedup point: a transition that leaves both boot times
      // unchanged never re-publishes.
      equals: (a, b) => a.server === b.server && a.padi === b.padi,
      verbs: ["get"],
      client: { onError: { kind: "toast", label: "Uptime readout" } },
    },

    /** The host-daemon inventory — every running kaval + padi on this host, each
     *  marked whether kolu's bound padi owns it (see {@link DaemonInventorySchema}).
     *  Server-authored diagnostic readout — a DERIVED poll cell
     *  (`derived.cell(source(...))` in `server/src/index.ts`), so the reactor graph is
     *  the one writer (no ctx `.set`); clients read-only.
     *  The Kaval/Padi dialogs list it so a LEAKED post-upgrade daemon — invisible in
     *  the UI before, surfaced only by a `kaval-tui` CLI error — is diagnosable at a
     *  glance. Presentation data, so it rides koluSurface like memory/uptime — NOT a
     *  padiSurface member. Empty-lists default is the honest pre-sample "unknown". */
    daemonInventory: {
      schema: DaemonInventorySchema,
      default: DEFAULT_DAEMON_INVENTORY,
      // Structural dedup — a DERIVED poll cell (`derived.cell(source(...))` in
      // `server/src/index.ts`), so the graph is the one writer and `equals` is the
      // ONE wire dedup point, declared here at the member (the reactive bridge's law).
      // A steady-state re-enumeration (the daemon set changes rarely) never
      // re-publishes to every connected client — a shallow JSON compare is fine (the
      // lists are tiny, a handful of daemons at most).
      equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
      verbs: ["get"],
      client: { onError: { kind: "toast", label: "Daemon inventory" } },
    },

    /** Every port forward this kolu server currently holds open (PRT2) — see
     *  {@link KoluForwardSchema}. Server-authored: a DERIVED POLL cell scanning
     *  the forward map's own change feed (`server/src/surface.ts`), so the
     *  reactor graph is the one writer and clients are read-only. Mutations go
     *  through the `forwards.create` / `forwards.cancel` procedures below.
     *
     *  Empty-list default is the honest pre-first-frame state AND the honest
     *  steady state — unlike a port SAMPLE there is no "we could not look" arm to
     *  miss, because this is not an observation of the world: it is this
     *  process's own map, which it always knows exactly. */
    forwards: {
      schema: ForwardsSchema,
      default: [] satisfies Forwards,
      // The derived cell's one wire dedup point, declared at the member (the
      // reactive bridge's law). The map republishes on every move; a move that
      // leaves the rendered list identical never reaches a client.
      equals: sameForwards,
      verbs: ["get"],
      client: { onError: { kind: "toast", label: "Port forwards" } },
    },
  },

  procedures: {
    /** Open and close forwards. These are kolu-server's own acts on its own
     *  machine — no host is asked for permission, because the listener is HERE —
     *  which is why they sit on koluSurface beside the cell they move, rather
     *  than on the per-host padi surface. */
    forwards: {
      /** Open a forward for `(host, port)`, or return the live one if there
       *  already is one. Idempotent by target, so a double-clicked chip opens one
       *  door. Rejects if the door cannot be opened, with the mechanism's own
       *  reason (a refused host, no ssh on PATH, a tunnel that never came up). */
      create: {
        input: ForwardCreateInputSchema,
        output: KoluForwardSchema,
      },
      /** Take down the forward with this key. Rejects if there is no such key —
       *  nothing is "already fine" about cancelling a forward that was never
       *  there; it means the caller's view of the list disagrees with the map. */
      cancel: { input: ForwardCancelInputSchema },
    },
  },
});

/** The two siblings, keyed — the single browser-safe source of which surfaces
 *  exist under which keys. `composeSurfaceContracts(surfaces)` (contract),
 *  `surfaceClients(link, surfaces)` (client), and `implementSurfaces(surfaces, …)`
 *  (server) all read this one map, so the keys can't drift across the three.
 *  kolu-server adds the `padi` sibling on top locally (`server/src/surface.ts`).
 *  The generic `@kolu/terminal-vocab` sibling was retired here — it had zero
 *  consumers once the client moved onto padi's `terminals` collection. */
export const surfaces = {
  kolu: koluSurface,
  surfaceApp: surfaceAppSurface_kolu,
} as const;

// The padi-FUL composed registry (`surfacesWithPadi = { ...surfaces, padi }`)
// lives in the sibling `./surfacesWithPadi.ts`, NOT here: it imports `padiSurface`
// from `@kolu/padi`, and keeping THAT import out of this heavily-imported module
// means `kolu-common/surface` stays free of the `@kolu/padi` dependency (only the
// client `wire.ts` + server `surface.ts` — the two that dial/serve the combined
// map — reach for it).

// ── Inferred runtime types — surface-bound, via SurfaceTypes ──────────
// `Surface` lifts `z.infer<schema>` over the spec so consumers reach for
// `Surface["cells"]["preferences"]["Value"]` etc. The flat aliases below
// are the conventional re-exports for the surface entries that Kolu code
// references by name across packages.

export type Surface = SurfaceTypes<typeof koluSurface.spec>;

export type Preferences = Surface["cells"]["preferences"]["Value"];
export type PreferencesPatch = Surface["cells"]["preferences"]["Patch"];
