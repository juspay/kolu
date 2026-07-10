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
import { HostDaemonInventorySchema } from "@kolu/padi/surface";
import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import {
  type BuildInfo,
  defineBuildInfo,
  surfaceAppSurfaceWith,
} from "@kolu/surface-app/surface";
// The honest three-way process-RSS union — composed below into `ProcessMemorySchema`.
// Owned by the shared browser-safe leaf so both sides of the padi seal read one
// declaration; its `ProcessRss` type is re-exported above for this module's importers.
import { ProcessRssSchema } from "@kolu/terminal-vocab/schema";
import type { TaskProgressSchema } from "anyagent/schemas";
import { match } from "ts-pattern";
import { z } from "zod";

// The host-daemon inventory row TYPES are re-exported from @kolu/padi/surface (their
// home) so existing `kolu-common/surface` importers (the client dialogs) keep resolving
// them here — the schema home moved to the daemon-domain package, the consumers didn't.
export type { RunningKaval, RunningPadi } from "@kolu/padi/surface";
export type {
  AgentPaintClass,
  AlertClass,
  Urgency,
} from "@kolu/terminal-vocab/agentProjection";
// The renderer-agnostic agent-state projection (bucket · urgency · needs-you
// rank) is OWNED by `@kolu/terminal-vocab/agentProjection` — the ONE source
// pulam-tui and pulam-web already share. The kolu client reaches it through the
// SAME door it already uses for the awareness schema (this module) rather than a
// second, direct `@kolu/terminal-vocab` edge, so the Dock joins as a third
// consumer of the same definition instead of re-deriving "needs-you".
export {
  agentBucket,
  agentPaintClass,
  agentUrgency,
  alertClass,
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

/** A STANDING, user-visible convergence anomaly the (remote) binder entered — the dialog
 *  shows it so nothing is "magically swallowed" into server logs. `null`/absent = the
 *  healthy converged case (no banner). Rides {@link DaemonInventorySchema.boundPadi}
 *  because that is the ONE binder→dialog channel orthogonal to the liveness gate: an
 *  `adopted-stale` keeps the connection `connected` (canvas alive) yet must still say WHY,
 *  which the connection cell (gated to `state === "connected"`) structurally cannot.
 *
 *  A DISCRIMINATED UNION, not a flat struct with nullable build fields: only
 *  `adopted-stale` is ABOUT a specific running-vs-expected build mismatch (the producer,
 *  `remotePadiBinding.ts`'s `adoptStale`, is the one arm that ever has both builds in
 *  hand); `skew-refused` / `unconverged` / `link-failed` are reasons that never carry a
 *  build pair. A flat struct let `{ state: "link-failed", runningBuild: "…" }` typecheck
 *  even though no producer ever means that — the union makes it UNREPRESENTABLE instead.
 *  Every non-`adopted-stale` variant still DECLARES `runningBuild`/`expectedBuild` as the
 *  literal `null` (rather than omitting the keys) so a consumer that reads
 *  `conv.runningBuild` unconditionally (the dialog banner shows the build pair only under
 *  `<Show when={state === "adopted-stale"}>`, but the accessor itself isn't narrowed by
 *  that boolean) keeps seeing the same `string | null` it always has — the illegal
 *  PAIRING is what's excluded, not the field's presence. */
export const PadiConvergenceSchema = z.discriminatedUnion("state", [
  z.object({
    /** A build-mismatched survivor we could not drain-replace within the M1 budget (a
     *  contested host respawning the old build) — we RIDE it, canvas works. */
    state: z.literal("adopted-stale"),
    /** The bound padi's ACTUAL build (`hello.buildId`) — always known for this state. */
    runningBuild: z.string(),
    /** The build kolu-server EXPECTED (its baked `PADI_BUILD_ID`) — always known too. */
    expectedBuild: z.string(),
    /** A human-readable reason for the dialog banner. */
    detail: z.string(),
  }),
  z.object({
    /** An incompatible padiSurface contract (binder older) we won't adopt. */
    state: z.literal("skew-refused"),
    /** No build pair for this reason — literal `null`, not omitted (see class doc). */
    runningBuild: z.null(),
    expectedBuild: z.null(),
    detail: z.string(),
  }),
  z.object({
    /** A newer-contract drain that never provably took (canvas dead). */
    state: z.literal("unconverged"),
    runningBuild: z.null(),
    expectedBuild: z.null(),
    detail: z.string(),
  }),
  z.object({
    /** The ssh link gave up (host unreachable / provisioning failed). */
    state: z.literal("link-failed"),
    runningBuild: z.null(),
    expectedBuild: z.null(),
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

    /** Live process-memory readout (kolu-server + padi + kaval RSS) for the rail.
     *  The server's periodic sampler is the sole writer
     *  (`koluSurfaceCtx.cells.processMemory.set`); clients read-only. It samples
     *  kolu-server's own RSS and FOLDS IN padi's `{ padi, kaval }` reading off the
     *  re-served padi surface — `padi`/`kaval` are `absent` until the first fold,
     *  and whenever padi is down. */
    processMemory: {
      schema: ProcessMemorySchema,
      default: {
        serverRssBytes: 0,
        padi: { status: "absent" },
        kaval: { status: "absent" },
      } satisfies z.infer<typeof ProcessMemorySchema>,
      verbs: ["get"],
    },

    /** kolu-server's live view of its binding to the local padi (see
     *  {@link PadiLinkSchema}). Server-authored — kolu-server is the sole writer,
     *  driving it off the bound padi session's connection state
     *  (`server/src/index.ts` via `koluSurfaceCtx.cells.padiLink.set`); clients
     *  read-only. The client folds it into the warming/degraded canvas so a padi drop
     *  shows an honest connecting state, never a frozen-but-live-looking world (#1034).
     *  Gate-closed default `connecting`, so a fresh subscription reads "coming up"
     *  before the first transition rather than a premature `connected`. */
    padiLink: {
      schema: PadiLinkSchema,
      default: "connecting" satisfies PadiLink,
      verbs: ["get"],
    },

    /** Live boot-time readout (kolu-server + padi) for the rail's uptime (see
     *  {@link ProcessStartedAtSchema}). Server-authored — kolu-server drives it off
     *  the bound padi session's connection state, the SAME `onState` that drives
     *  `padiLink` (`server/src/index.ts` via `koluSurfaceCtx.cells.processStartedAt.set`);
     *  clients read-only. The `{ server: null, padi: null }` default is the honest
     *  pre-yield "unknown" for BOTH legs — no `0` sentinel (the rail gates a `null` out
     *  rather than rendering a bogus uptime off a fabricated boot time). */
    processStartedAt: {
      schema: ProcessStartedAtSchema,
      default: { server: null, padi: null } satisfies z.infer<
        typeof ProcessStartedAtSchema
      >,
      verbs: ["get"],
    },

    /** The host-daemon inventory — every running kaval + padi on this host, each
     *  marked whether kolu's bound padi owns it (see {@link DaemonInventorySchema}).
     *  Server-authored diagnostic readout (a dedicated read-only enumerator is the
     *  sole writer via `koluSurfaceCtx.cells.daemonInventory.set`); clients read-only.
     *  The Kaval/Padi dialogs list it so a LEAKED post-upgrade daemon — invisible in
     *  the UI before, surfaced only by a `kaval-tui` CLI error — is diagnosable at a
     *  glance. Presentation data, so it rides koluSurface like memory/uptime — NOT a
     *  padiSurface member. Empty-lists default is the honest pre-sample "unknown". */
    daemonInventory: {
      schema: DaemonInventorySchema,
      default: DEFAULT_DAEMON_INVENTORY,
      verbs: ["get"],
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
