import {
  type AgentDistroListing,
  AgentDistroListingSchema,
} from "@kolu/agent-distro/listing";
import { mibOf } from "@kolu/byte-units";

import {
  HostDaemonInventorySchema,
  type NewTerminalPolicy,
  type ToastOnlyPolicy,
} from "@kolu/padi-client/surface";
import {
  type AgentProfiles,
  AgentProfilesSchema,
  AgentDistroSettingSchema,
} from "@kolu/agent-distro/schema";
import {
  defineSurfaceWithPolicy,
  type SurfaceTypes,
} from "@kolu/surface/define";
import {
  type BuildInfo,
  defineBuildInfo,
  surfaceAppSurfaceWith,
} from "@kolu/surface-app/surface";
import {
  type ProcessRss,
  ProcessRssSchema,
  TcpPortSchema,
} from "@kolu/terminal-vocab/schema";
import type { TaskProgressSchema } from "anyagent/schemas";
import { Schema, Struct } from "effect";
import { match } from "ts-pattern";
import { WorkMemberSchema, WorkSchema } from "kolu-work";
import { HostKeySchema } from "./hostKey.ts";
import {
  DEFAULT_CONDUCTOR_STATE,
  ConductorAnswerInputSchema,
  ConductorAnswerOutputSchema,
  ConductorAnswerWorkInputSchema,
  ConductorWorkInputSchema,
  ConductorAnswerWorkOutputSchema,
  ConductorAttachInputSchema,
  ConductorAttachOutputSchema,
  ConductorEmptySchema,
  ConductorFrameSchema,
  ConductorPromptInputSchema,
  ConductorPromptOutputSchema,
  ConductorRecoverInputSchema,
  ConductorRecoverOutputSchema,
  ConductorSetOptionInputSchema,
  ConductorSignInInputSchema,
  ConductorSignInOutputSchema,
  ConductorStateSchema,
  ConductorTerminalInputSchema,
  ConductorTextInputSchema,
} from "./conductorSchema.ts";
import { ConductorRefused, ConductorUnavailable } from "./conductorErrors.ts";
export * from "./conductorSchema.ts";
export * from "./conductorErrors.ts";
import { MemberReadingSchema } from "./worksSchema.ts";
export * from "./worksSchema.ts";

export type {
  ClientErrorPolicy,
  RunningKaval,
  RunningPadi,
  ToastOnlyPolicy,
} from "@kolu/padi-client/surface";
export {
  DEFAULT_NEW_TERMINAL_POLICY,
  type NewTerminalPolicy,
  NewTerminalPolicySchema,
  newTerminalPolicyEqual,
} from "@kolu/padi-client/surface";
export type {
  AgentPaintClass,
  AlertClass,
  AttentionClass,
  Urgency,
} from "@kolu/terminal-vocab/agentProjection";
export {
  ATTENTION_CLASSES,
  agentBucket,
  agentPaintClass,
  agentUrgency,
  alertClass,
  attentionActive,
  attentionClass,
  attentionCounted,
  DASH,
  paintClassOf,
  URGENCY_RANK,
} from "@kolu/terminal-vocab/agentProjection";
export type {
  AttentionFrame,
  AttentionTransition,
  AttentionTransitions,
} from "@kolu/terminal-vocab/attentionTransitions";
export { createAttentionTransitions } from "@kolu/terminal-vocab/attentionTransitions";
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
export {
  AgentIdentitySchema,
  AgentInfoSchema,
  AgentKindSchema,
  AgentMemorySchema,
  ForegroundSchema,
  foldPorts,
  type HostListeners,
  type HostPort,
  knownPorts,
  type ListenerAt,
  listenerAt,
  type PortFamily,
  PortFamilySchema,
  type PortReach,
  PrResultSchema,
  PrUnavailableSourceSchema,
  portReach,
  preferredFamily,
  prUnavailableReason,
  prUnavailableSource,
  RestoreTargetSchema,
  reasonForSource,
  resumableCommand,
  samePortList,
  TcpPortSchema,
  TERMINAL_IDLE_AFTER_MS,
  TerminalIdSchema,
  type TerminalPorts,
  TerminalSnapshotSchema,
  UNKNOWN_HOST_LISTENERS,
  type PortBind,
} from "@kolu/terminal-vocab/schema";

export const ColorSchemeSchema = Schema.Literals(["light", "dark", "system"]);

/** Which way the viewer's OS is leaning — the raw `prefers-color-scheme` media
 *  query answer, nothing folded in. An OBSERVATION, not a preference: the user
 *  never sets it, the browser reports it, and it matters only when
 *  `colorScheme === "system"` (see {@link resolveIsDark}). */
export const ViewerModeSchema = Schema.Literals(["dark", "light"]);

/** How a newly created terminal gets its theme. `inherit` copies the active
 *  terminal's theme; `shuffle` auto-picks a distinct tint via
 *  {@link ShuffleBehaviorSchema}. */
export const NewTerminalThemeSchema = Schema.Literals(["inherit", "shuffle"]);

/** Which themes a *shuffle* draws from — both a `shuffle` new terminal and the
 *  ⌘⇧J "Shuffle theme" action. `random` spreads across the whole catalogue;
 *  `dark`/`light` restrict to that luminance family; `auto` tracks the app's
 *  resolved light/dark mode; `colourful` prefers saturated (non-grey) tints
 *  across light and dark. */
export const ShuffleBehaviorSchema = Schema.Literals([
  "random",
  "dark",
  "light",
  "auto",
  "colourful",
]);

export const RightPanelPrefsSchema = Schema.Struct({
  size: Schema.Number,
  /** Vertical split fraction (0–1) inside the Code tab: tree pane occupies
   *  this share, content pane gets the rest. */
  codeTabTreeSize: Schema.Number,
});

/** The Agents setting — whether new terminals get agent-distro's harnesses on
 *  their PATH (`enabled`), and the profiles stacked over them (`profiles`, an
 *  ordered list of references; empty is the harnesses as they ship). */
export const AgentDistroPrefsSchema = AgentDistroSettingSchema;

export {
  type AgentDistroListing,
  AgentDistroListingSchema,
  type AgentProfiles,
  AgentProfilesSchema,
};

export const PreferencesSchema = Schema.Struct({
  seenTips: Schema.Array(Schema.String),
  startupTips: Schema.Boolean,
  newTerminalTheme: NewTerminalThemeSchema,
  /** Whether a NEW terminal opens with its right panel collapsed. */
  newTerminalCollapsed: Schema.Boolean,
  shuffleBehavior: ShuffleBehaviorSchema,
  scrollLock: Schema.Boolean,
  attentionAlerts: Schema.Boolean,
  colorScheme: ColorSchemeSchema,
  /** Renderer policy. `auto` lets the system choose (WebGL on the focused+
   *  visible tile, DOM elsewhere). `webgl` forces WebGL on every tile. `dom`
   *  forces DOM everywhere. */
  terminalRenderer: Schema.Literals(["auto", "webgl", "dom"]),
  rightPanel: RightPanelPrefsSchema,
  /** The Agents setting — see {@link AgentDistroPrefsSchema}. `null` until
   *  someone chooses: "never chosen" is the absence of a value, and it behaves
   *  as off (`agentDistroSettingOf` in `@kolu/agent-distro/status` is the one
   *  fold to the effective setting). */
  agentDistro: Schema.NullOr(AgentDistroPrefsSchema),
  /** The profile references the user added before, most recent first, at
   *  most eight (`rememberProfiles` in `@kolu/agent-distro/status`). */
  agentProfilesRecent: Schema.Array(Schema.String),
  /** The tile tip's size: the full bar under the title bar (`false`), or a
   *  small tab hanging from its bottom-right edge (`true`). */
  tipBarCollapsed: Schema.Boolean,
  /** The user's HOST TAB arrangement — CANONICAL encoded host keys
   *  (`encodeHostKey`) in the order their tabs should sit. The LOCAL host is
   *  pinned first and so is never stored here, the same rule
   *  `PersistedHostsSchema` applies to the persisted fleet. */
  hostOrder: Schema.Array(Schema.String),
});

export const PreferencesPatchSchema = PreferencesSchema.mapFields(
  Struct.omit(["rightPanel", "agentDistro"]),
)
  .mapFields(Struct.map(Schema.optionalKey))
  .mapFields(
    Struct.assign({
      rightPanel: Schema.optionalKey(
        RightPanelPrefsSchema.mapFields(Struct.map(Schema.optionalKey)),
      ),
      agentDistro: Schema.optionalKey(AgentDistroPrefsSchema),
    }),
  );

export type ColorScheme = typeof ColorSchemeSchema.Type;
export type NewTerminalTheme = typeof NewTerminalThemeSchema.Type;
export type ShuffleBehavior = typeof ShuffleBehaviorSchema.Type;
export type ViewerMode = typeof ViewerModeSchema.Type;
export type AgentDistroPrefs = typeof AgentDistroPrefsSchema.Type;

/** The candidate-pool filter a shuffle should apply, from the
 *  `shuffleBehavior` preference and the app's resolved dark mode.
 *  `undefined` means no restriction (`random` — the whole catalogue).
 *  Otherwise `"light"` / `"dark"` / `"colourful"` — the same literals
 *  `pickTheme`'s `mode` accepts (`ThemePickMode` in terminal-themes). */
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
 *  viewer's raw OS reading. */
export function resolveIsDark(
  colorScheme: ColorScheme,
  prefersDark: boolean,
): boolean {
  return colorScheme === "dark" || (colorScheme === "system" && prefersDark);
}

/** The RESOLVED new-terminal theme policy kolu-server pushes into padi's
 *  `newTerminalPolicy` cell. `"auto"` is spent here and never crosses the
 *  wire; `shuffleMode`'s `undefined` (no family restriction) becomes the
 *  policy's explicit `"random"`, because a wire union does not get to say
 *  "absent". */
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

export type TaskProgress = typeof TaskProgressSchema.Type;

export const DEFAULT_PREFERENCES: typeof PreferencesSchema.Type = {
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
  agentDistro: null,
  agentProfilesRecent: [],
  tipBarCollapsed: false,
  hostOrder: [],
};

type _Preferences = typeof PreferencesSchema.Type;
type _PreferencesPatch = typeof PreferencesPatchSchema.Type;

/** Pure merge of a `PreferencesPatch` into the current preferences.
 *  `rightPanel` is deep-merged so callers can patch a single nested field
 *  without supplying the rest of the object; `agentDistro` is replaced whole. */
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
 *  three server-side processes the rail names. `serverRssBytes` is the kolu-server
 *  process (a plain number — always present, it is measuring ITSELF). `padi` +
 *  `kaval` are the padi PROCESS and its kaval daemon. Each is the honest
 *  {@link ProcessRssSchema} three-way so the rail can tell "the process
 *  is down" (`absent`) apart from "its RSS read failed" (`error`), never a fake
 *  zero — when padi is down both read `absent`. */
export const ProcessMemorySchema = Schema.Struct({
  serverRssBytes: Schema.Number,
  padi: ProcessRssSchema,
  kaval: ProcessRssSchema,
});
export type ProcessMemory = typeof ProcessMemorySchema.Type;

/** kolu-server's live view of its binding to the local padi.
 *
 *    - `connecting` — the binding is (re)establishing (boot, or reconnecting after a drop);
 *    - `connected`  — kolu-server is bound to a live padi;
 *    - `degraded`   — the binding dropped (padi is down / the reconnect loop is re-dialing). */
export const PadiLinkSchema = Schema.Literals([
  "connecting",
  "connected",
  "degraded",
]);
export type PadiLink = typeof PadiLinkSchema.Type;

/** Live boot-time readout for the identity rail's uptime — kolu-server's OWN boot
 *  time and the bound padi's; readers render `now − startedAt`. `server` is
 *  `null` until the first server yield and `padi` is `null` whenever padi is
 *  unbound — an honest "unknown", never a fake `0`. */
export const ProcessStartedAtSchema = Schema.Struct({
  server: Schema.NullOr(Schema.Number),
  padi: Schema.NullOr(Schema.Number),
});
export type ProcessStartedAt = typeof ProcessStartedAtSchema.Type;

export const DaemonBuildSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("known"), id: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("off-nix") }),
]);
export type DaemonBuildWire = typeof DaemonBuildSchema.Type;

export const ConvergenceIdentitySchema = Schema.Struct({
  contractVersion: Schema.String,
  build: DaemonBuildSchema,
});
export type ConvergenceIdentityWire = typeof ConvergenceIdentitySchema.Type;

/** Drain-budget instance key on the wire — named instance or `pre-instance`
 *  (absent startedAt = older daemon). Never an overloaded null. */
export const InstanceKeySchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("instance"),
    key: Schema.Union([Schema.String, Schema.Number]),
  }),
  Schema.Struct({ kind: Schema.Literal("pre-instance") }),
]);
export type InstanceKeyWire = typeof InstanceKeySchema.Type;

/** A STANDING, user-visible convergence anomaly the (remote) binder entered — the dialog
 *  shows it so nothing is "magically swallowed" into server logs. `null`/absent = the
 *  healthy converged case (no banner).
 *
 *  Each arm carries its own typed evidence. Discriminant is `kind` (same as the
 *  framework). A UI must never parse `detail`; it reads the typed fields. */
export const PadiConvergenceSchema = Schema.Union([
  Schema.Struct({
    /** A build-mismatched survivor we could not drain-replace within the budget —
     *  we RIDE it, canvas works. Evidence: running + expected identities. */
    kind: Schema.Literal("adopted-stale"),
    running: ConvergenceIdentitySchema,
    expected: ConvergenceIdentitySchema,
    detail: Schema.String,
  }),
  Schema.Struct({
    /** An incompatible padiSurface contract (binder older) we won't adopt. */
    kind: Schema.Literal("skew-refused"),
    running: ConvergenceIdentitySchema,
    expected: ConvergenceIdentitySchema,
    detail: Schema.String,
  }),
  Schema.Struct({
    /** Drain/budget give-up that left canvas dead — typed cause evidence. */
    kind: Schema.Literal("unconverged"),
    /** null when running identity is honestly unknown (e.g. initial probe failed). */
    running: Schema.NullOr(ConvergenceIdentitySchema),
    expected: ConvergenceIdentitySchema,
    cause: Schema.Union([
      Schema.Struct({
        kind: Schema.Literal("budget-exhausted"),
        axis: Schema.Literals(["contract", "build"]),
        attempts: Schema.Number.check(Schema.isInt()),
        maxAttempts: Schema.Number.check(Schema.isInt()),
      }),
      Schema.Struct({
        kind: Schema.Literal("drain-not-taken"),
        axis: Schema.Literals(["contract", "build"]),
        ceilingMs: Schema.Number,
        rejection: Schema.NullOr(Schema.String),
      }),
      Schema.Struct({
        kind: Schema.Literal("adopt-bind-failed"),
        axis: Schema.NullOr(Schema.Literals(["contract", "build"])),
      }),
      Schema.Struct({ kind: Schema.Literal("identity-unverifiable") }),
      Schema.Struct({
        kind: Schema.Literal("probe-failed"),
        message: Schema.String,
      }),
      Schema.Struct({
        /** The daemon at our rendezvous speaks a protocol EPOCH this supervisor
         *  cannot decode — an explicit first-frame decode failure from a peer
         *  whose gate file is ours and whose pid we verified. */
        kind: Schema.Literal("unspeakable-protocol"),
        socketPath: Schema.String,
        gatePath: Schema.String,
        pid: Schema.Number.check(Schema.isInt()),
      }),
    ]),
    detail: Schema.String,
  }),
  Schema.Struct({
    /** Another supervisor is respawning this host's padi — fail-honest, never ride
     *  a contested build. Evidence: drained + observed instance keys. */
    kind: Schema.Literal("cross-supervisor"),
    drained: InstanceKeySchema,
    observed: InstanceKeySchema,
    running: ConvergenceIdentitySchema,
    detail: Schema.String,
  }),
  Schema.Struct({
    /** The ssh link gave up for good. App-only; not a framework convergence
     *  verdict. WHY it gave up (stalled vs setup kept failing) is the session's
     *  own `cause` on its `failed` state — read there, never copied here. */
    kind: Schema.Literal("link-failed"),
    detail: Schema.String,
  }),
]);
export type PadiConvergence = typeof PadiConvergenceSchema.Type;

/** Where kolu-server's padi is bound — and, when that is NOT the machine kolu-server
 *  itself runs on, its own-machine scan. */
export const DaemonBindingSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("local") }),
  Schema.Struct({
    kind: Schema.Literal("remote"),
    /** The ssh host the padi is bound to (`KOLU_PADI_HOST`). */
    host: Schema.String,
    /** kolu-server's scan of the machine it ITSELF runs on — NOT the bound host, so a
     *  leaked daemon on the box you're actually using stays visible. */
    localScan: HostDaemonInventorySchema,
  }),
]);
export type DaemonBinding = typeof DaemonBindingSchema.Type;

export const DaemonInventorySchema = Schema.Struct({
  binding: DaemonBindingSchema,
  /** The BOUND padi's honest identity off its control-core `hello` — `surfaceVersion` +
   *  `buildCommit` — for BOTH arms (local socket OR remote ssh). `null` before the
   *  first sample / while padi is unbound with nothing to report. */
  boundPadi: Schema.NullOr(
    Schema.Struct({
      surfaceVersion: Schema.NullOr(Schema.String),
      buildCommit: Schema.NullOr(Schema.String),
      /** A STANDING convergence anomaly (adopted-stale / skew-refused / unconverged /
       *  link-failed), or null when converged/healthy. Non-null even when the identity
       *  above is null (a refused/failed bind has a reason but no adopted identity). */
      convergence: Schema.NullOr(PadiConvergenceSchema),
    }).check(
      Schema.makeFilter((v) =>
        v.surfaceVersion !== null ||
        v.buildCommit !== null ||
        v.convergence !== null
          ? undefined
          : "boundPadi: nothing to report is the top-level null, not an inner object with every field null",
      ),
    ),
  ),
});
export type DaemonInventory = typeof DaemonInventorySchema.Type;

/** WHY a forward exists, which is the whole of its death policy.
 *
 *  `auto` — kolu opened it because someone clicked a port chip. It is a
 *  convenience attached to a listener the scanner can see, so when the scanner
 *  reports that listener gone the door has nothing left behind it and closes.
 *  `manual` — someone asked for this target by name (⌘K, or the Inspector's
 *  "Forward a port…" row). It may point at something no scanner watches — a port
 *  outside every terminal's subtree, a service started before kolu — so nothing
 *  but an explicit cancel or the host's departure may close it. */
export const ForwardOriginSchema = Schema.Literals(["auto", "manual"]);
export type ForwardOrigin = typeof ForwardOriginSchema.Type;

/** One live forward, as every kolu surface renders it. */
export const KoluForwardSchema = Schema.Struct({
  /** The forward map's own key, and the handle `forwards.cancel` takes. Opaque
   *  to the client on purpose: it is the library's identity for this target, so
   *  a row cancels exactly what it displays with no re-derivation in between. */
  key: Schema.String,
  host: HostKeySchema,
  /** The port on `host` that the forward points at. */
  remotePort: TcpPortSchema,
  /** The port it answers on, on every interface of the KOLU SERVER's host —
   *  the number that goes in the URL. */
  localPort: TcpPortSchema,
  origin: ForwardOriginSchema,
  /** Epoch ms when the listener came up — what an "up 12m" column renders. */
  createdAt: Schema.Number,
});
export type KoluForward = typeof KoluForwardSchema.Type;

/** Every live forward, oldest first. */
export const ForwardsSchema = Schema.Array(KoluForwardSchema);
export type Forwards = typeof ForwardsSchema.Type;

/** What `forwards.create` takes. `origin` is the CALLER's to declare because only
 *  the caller knows why it is asking — a chip click is `auto`, a typed target is
 *  `manual` — and that reason is what decides whether the forward may be closed
 *  without being asked. */
export const ForwardCreateInputSchema = Schema.Struct({
  host: HostKeySchema,
  port: TcpPortSchema,
  origin: ForwardOriginSchema,
});
export type ForwardCreateInput = typeof ForwardCreateInputSchema.Type;

/** What `forwards.cancel` takes — the key off the row being cancelled. */
export const ForwardCancelInputSchema = Schema.Struct({ key: Schema.String });

type ForwardKeyDeterminedByKey = "host" | "remotePort";

type ComparedForwardKeys = {
  readonly [K in Exclude<
    keyof KoluForward,
    ForwardKeyDeterminedByKey
  >]: KoluForward[K] extends string | number | boolean ? true : never;
};

const FORWARD_COMPARED = {
  key: true,
  localPort: true,
  origin: true,
  createdAt: true,
} satisfies ComparedForwardKeys;

const FORWARD_KEYS = Object.keys(
  FORWARD_COMPARED,
) as (keyof ComparedForwardKeys)[];

export function sameForwards(a: Forwards, b: Forwards): boolean {
  return (
    a.length === b.length &&
    a.every((f, i) => {
      const g = b[i];
      if (g === undefined) return false;
      return FORWARD_KEYS.every((k) => f[k] === g[k]);
    })
  );
}

export const DEFAULT_DAEMON_INVENTORY: DaemonInventory = {
  binding: { kind: "local" },
  boundPadi: null,
};

function rssMiBEqual(a: ProcessRss, b: ProcessRss): boolean {
  if (a.status !== b.status) return false;
  if (a.status === "ok" && b.status === "ok") {
    return mibOf(a.rssBytes, 0) === mibOf(b.rssBytes, 0);
  }
  return true;
}

/** Two readouts are equal when all three processes render the same whole-MiB figure
 *  — the `processMemory` cell's `equals`, so a sub-MiB RSS wobble never re-publishes
 *  to every connected client. */
export function processMemoryMiBEqual(
  a: ProcessMemory,
  b: ProcessMemory,
): boolean {
  return (
    mibOf(a.serverRssBytes, 0) === mibOf(b.serverRssBytes, 0) &&
    rssMiBEqual(a.padi, b.padi) &&
    rssMiBEqual(a.kaval, b.kaval)
  );
}

export interface KoluBuildInfo extends BuildInfo {
  /** App version (X.Y.Z) — the rail's `srv` column shows it as `vX.Y.Z` beside the
   *  commit. Optional only in the library-seeded default (`{ commit }`); once
   *  the async buildInfo patch resolves it's always present. */
  version?: string;
}

export const koluBuildInfo = defineBuildInfo<KoluBuildInfo>({
  schema: Schema.Struct({
    commit: Schema.String,
    version: Schema.optionalKey(Schema.String),
  }),
  default: { commit: "" },
});

export const surfaceAppSurface_kolu = surfaceAppSurfaceWith(koluBuildInfo);

export const koluSurface = defineSurfaceWithPolicy<ToastOnlyPolicy>()({
  cells: {
    /** User preferences — local-authority on the client; server-canonical
     *  on disk. Storage is flat (no discriminated-union subtrees), so the
     *  spec's `patch` is the only merge path. */
    preferences: {
      schema: PreferencesSchema,
      default: DEFAULT_PREFERENCES,
      patchSchema: PreferencesPatchSchema,
      patch: applyPreferencesPatch,
      verbs: ["get", "patch", "test__set"],
      client: {
        authority: "local",
        coalesceMs: 150,
        onError: { kind: "toast", label: "Preferences" },
      },
    },

    /** The viewer's raw OS light/dark reading (see {@link ViewerModeSchema}) —
     *  published by the browser, remembered on disk by kolu-server, and consulted
     *  ONLY when `colorScheme === "system"`. */
    viewerMode: {
      schema: ViewerModeSchema,
      default: "dark" satisfies ViewerMode,
      equals: (a, b) => a === b,
      verbs: ["get", "set"],
      client: { onError: { kind: "toast", label: "Viewer mode" } },
    },

    /** The harnesses agent-distro's package brings (see
     *  {@link AgentDistroListingSchema}). Read-only on the client. */
    agentDistroListing: {
      schema: AgentDistroListingSchema,
      default: { kind: "unavailable" } satisfies AgentDistroListing,
      verbs: ["get"],
      client: { onError: { kind: "toast", label: "Agents listing" } },
    },

    /** Whether each profile of the Agents setting builds (see
     *  {@link AgentProfilesSchema}) — kolu-server's answer from locking and
     *  building it for its own system: pending, resolved (its name,
     *  description and locked revision) or failed (Nix's own words).
     *  Read-only on the client. */
    agentProfiles: {
      schema: AgentProfilesSchema,
      default: [] satisfies AgentProfiles,
      verbs: ["get"],
      client: { onError: { kind: "toast", label: "Agents profiles" } },
    },

    processMemory: {
      schema: ProcessMemorySchema,
      default: {
        serverRssBytes: 0,
        padi: { status: "absent" },
        kaval: { status: "absent" },
      } satisfies typeof ProcessMemorySchema.Type,
      equals: processMemoryMiBEqual,
      verbs: ["get"],
      client: { onError: { kind: "toast", label: "Memory readout" } },
    },

    padiLink: {
      schema: PadiLinkSchema,
      default: "connecting" satisfies PadiLink,
      equals: (a, b) => a === b,
      verbs: ["get"],
      client: { onError: { kind: "toast", label: "padi link status" } },
    },

    processStartedAt: {
      schema: ProcessStartedAtSchema,
      default: {
        server: null,
        padi: null,
      } satisfies typeof ProcessStartedAtSchema.Type,
      equals: (a, b) => a.server === b.server && a.padi === b.padi,
      verbs: ["get"],
      client: { onError: { kind: "toast", label: "Uptime readout" } },
    },

    daemonInventory: {
      schema: DaemonInventorySchema,
      default: DEFAULT_DAEMON_INVENTORY,
      equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
      verbs: ["get"],
      client: { onError: { kind: "toast", label: "Daemon inventory" } },
    },

    /** Every port forward this kolu server currently holds open — see
     *  {@link KoluForwardSchema}. Clients are read-only: mutations go
     *  through the `forwards.create` / `forwards.cancel` procedures below. */
    forwards: {
      schema: ForwardsSchema,
      default: [] satisfies Forwards,
      equals: sameForwards,
      arrayKey: "key",
      verbs: ["get"],
      client: { onError: { kind: "toast", label: "Port forwards" } },
    },
    /** THE CONDUCTOR — kolu's one ACP conversation, as a value. Read-only on
     *  the client: every write goes through the `conductor` procedure
     *  namespace, because a conversation is a thing you ask rather than a
     *  value you set. */
    conductor: {
      schema: ConductorStateSchema,
      default: DEFAULT_CONDUCTOR_STATE,
      verbs: ["get"],
      client: { onError: { kind: "toast", label: "Conductor" } },
    },
  },

  collections: {
    /** THE WORKS — every piece of work the Conductor opened, as kolu stores
     *  it, keyed by work id. Read-only: the record is written by the
     *  Conductor's open/join calls and by what kolu observes. */
    works: {
      keySchema: Schema.String,
      schema: WorkSchema,
      verbs: ["keys", "get"],
      client: { onError: { kind: "toast", label: "Works" } },
    },
    /** WHICH WORK EACH MEMBER TERMINAL IS IN — one entry per member, keyed by
     *  its `<host>/<id>` ref, holding the work it belongs to, its role, when
     *  it joined and where it is working. A terminal with no row is a
     *  terminal no work has. */
    workMembers: {
      keySchema: Schema.String,
      schema: WorkMemberSchema,
      verbs: ["keys", "get"],
      client: { onError: { kind: "toast", label: "Works" } },
    },
    /** HOW EACH MEMBER TERMINAL STANDS — one entry per terminal the watch has
     *  read in THIS process, keyed by its `<host>/<id>` ref. Runtime only and
     *  never stored: an absent key is "not read yet", never "0s". */
    memberReadings: {
      keySchema: Schema.String,
      schema: MemberReadingSchema,
      verbs: ["keys", "get"],
      client: { onError: { kind: "toast", label: "Works" } },
    },
  },
  streams: {
    /** The conductor's transcript — an EXPLICITLY discriminated
     *  snapshot-then-deltas feed. */
    conductorTranscript: {
      inputSchema: Schema.Struct({}),
      outputSchema: ConductorFrameSchema,
    },
  },

  procedures: {
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
    agentDistro: {
      /** Deliver the newest agents now — to `host`, or to every connected host
       *  for `null` — reading upstream's index and locking every profile
       *  afresh. Answers once the delivery has started; each host's padi cells
       *  say how it ends. A host already being delivered to keeps its delivery.
       *  A no-op while agents are off, or on a kolu built without agents. */
      deliver: {
        input: Schema.Struct({ host: Schema.NullOr(HostKeySchema) }),
      },
    },
    /** `prompt` never refuses for being busy: the queue is the AGENT'S, so a
     *  message sent mid-turn goes out immediately as a plain `session/prompt`
     *  and waits there — nothing is held on this side, which is also why
     *  `cancel` has nothing to throw away. */
    conductor: {
      prompt: {
        input: ConductorPromptInputSchema,
        output: ConductorPromptOutputSchema,
        error: Schema.Union([ConductorUnavailable, ConductorRefused]),
      },
      /** ONE CHUNK of a file on its way up, ahead of the `prompt` that names
       *  it. Refusable because every reason to say no here is one a person
       *  must read — an id that is not a filename, an `appendTo` that points
       *  outside the attachments directory, or a file that grew past the
       *  per-attachment cap as it was written. */
      attach: {
        input: ConductorAttachInputSchema,
        output: ConductorAttachOutputSchema,
        error: Schema.Union([ConductorUnavailable, ConductorRefused]),
      },
      cancel: {
        input: ConductorEmptySchema,
        error: Schema.Union([ConductorUnavailable, ConductorRefused]),
      },
      /** Settle one ask. `answers: null` DECLINES it. Refusable: two tabs
       *  looking at the same conversation settle the same ask, and the loser
       *  is told the agent is no longer asking. */
      answer: {
        input: ConductorAnswerInputSchema,
        output: ConductorAnswerOutputSchema,
        error: Schema.Union([ConductorUnavailable, ConductorRefused]),
      },
      /** ANSWER ONE OF KOLU'S OWN QUESTIONS ABOUT A PIECE OF WORK — from the
       *  card, the chat, the reader or its pop-out window. The decision is
       *  written on the work and the conversation is WOKEN with what was
       *  said; nothing was waiting on it, so nothing is released.
       *
       *  Answering the same ask twice is NOT a refusal: the loser is told
       *  `settled: false`, because two tabs (or a card and a pop-out) looking
       *  at the same question is the ordinary thing. */
      answerWork: {
        input: ConductorAnswerWorkInputSchema,
        output: ConductorAnswerWorkOutputSchema,
        error: Schema.Union([ConductorRefused]),
      },
      signIn: {
        input: ConductorSignInInputSchema,
        output: ConductorSignInOutputSchema,
        error: Schema.Union([ConductorUnavailable, ConductorRefused]),
      },
      /** One line into a running `terminal`-kind sign-in — the code box. */
      signInInput: {
        input: ConductorTextInputSchema,
        error: Schema.Union([ConductorUnavailable, ConductorRefused]),
      },
      signInCancel: {
        input: ConductorEmptySchema,
        error: Schema.Union([ConductorUnavailable]),
      },
      /** A PERSON ASKS TO SIGN IN — signed in or not: a limit reached, the
       *  wrong account, a login that went stale. Puts the sign-in row on
       *  screen with the methods the agent's handshake advertised (or the
       *  sentence saying it advertised none). */
      askSignIn: {
        input: ConductorEmptySchema,
        error: Schema.Union([ConductorUnavailable]),
      },
      /** PICK UP A SIGN-IN MADE ELSEWHERE — restart the agent so it reads the
       *  signature afresh, back into the same conversation. A running agent
       *  keeps the credential it started with. */
      reloadAgent: {
        input: ConductorEmptySchema,
        error: Schema.Union([ConductorUnavailable, ConductorRefused]),
      },
      /** Change one adapter-advertised option (the model included — it is just
       *  the option whose id the agent's leg names). A refusal leaves the
       *  confirmed value where it was. */
      setOption: {
        input: ConductorSetOptionInputSchema,
        error: Schema.Union([ConductorUnavailable, ConductorRefused]),
      },
      /** Start a fresh conversation OVER the transcript: the old one is left,
       *  the rows stay, the break gains a `— new session —` divider, and the
       *  standing prompt is taught again. */
      newSession: {
        input: ConductorEmptySchema,
        error: Schema.Union([ConductorUnavailable, ConductorRefused]),
      },
      /** Start a fresh conversation AND EMPTY IT: the rows, the record, the
       *  files those rows named and the fleet the conversation remembered all
       *  go. It leaves no divider behind — there is nothing above the break to
       *  divide from. */
      clearSession: {
        input: ConductorEmptySchema,
        error: Schema.Union([ConductorUnavailable, ConductorRefused]),
      },
      /** TAKE A DRIVEN TERMINAL OFF THE CONDUCTOR — the person is typing into
       *  it now. Appends the act to the work, and wakes the conversation so
       *  the agent stops sending that terminal input. `terminal` is the
       *  `<host>/<id>` ref. */
      takeOver: {
        input: ConductorTerminalInputSchema,
        error: Schema.Union([ConductorRefused]),
      },
      /** ... and give it back: the Conductor drives it again, and is woken to
       *  say so. */
      handBack: {
        input: ConductorTerminalInputSchema,
        error: Schema.Union([ConductorRefused]),
      },
      /** STOP A PIECE OF WORK — the work ends `stopped by you`, its members
       *  leave with it and its open questions are dropped. */
      stopWork: {
        input: ConductorWorkInputSchema,
        error: Schema.Union([ConductorRefused]),
      },
      /** ... and bring one back: Ended → Open, every decision and the whole
       *  timeline kept, a `reopened` line on it. The same work — never a
       *  second card for the same branch. */
      reopenWork: {
        input: ConductorWorkInputSchema,
        error: Schema.Union([ConductorRefused]),
      },
      /** PUT A RECORD KOLU CANNOT READ BACK IN A STATE IT CAN. `how: "backup"`
       *  restores the newest state-backup snapshot whose store decodes;
       *  `how: "empty"` keeps the unreadable value aside in a file of its own
       *  and starts that record empty. The running server re-reads its records
       *  afterwards — no restart — and the answer says which snapshot it took
       *  or where the value was kept. */
      recoverStore: {
        input: ConductorRecoverInputSchema,
        output: ConductorRecoverOutputSchema,
        error: Schema.Union([ConductorRefused]),
      },
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

export type Surface = SurfaceTypes<typeof koluSurface.spec>;

export type Preferences = Surface["cells"]["preferences"]["Value"];
export type PreferencesPatch = Surface["cells"]["preferences"]["Patch"];
