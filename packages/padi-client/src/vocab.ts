import { TerminalAgentsSchema } from "@kolu/agent-distro/schema";
import type { WireSchema } from "@kolu/surface/define";
import type { DaemonLifetimeInfo } from "@kolu/surface-daemon/lifetime";
import {
  ENDPOINT_STATES,
  type EndpointState,
} from "@kolu/surface-daemon-supervisor/states";
import {
  AgentKindSchema,
  AgentMemorySchema,
  type ProcessRss,
  ProcessRssSchema,
  RestoreTargetSchema,
  seedMemory,
  type TerminalId,
  TerminalIdSchema,
  type TerminalSnapshot,
  TerminalSnapshotSchema,
} from "@kolu/terminal-vocab/schema";
import { identityOnlyTarget } from "anyagent/schemas";
import { type PrInfo, prValue } from "anyforge/schemas";
import { Effect, Result, Schema, Struct } from "effect";
import {
  CanvasLayoutSchema,
  RightPanelPerTerminalStateSchema,
  SubPanelStateSchema,
} from "./chromeVocab.ts";

export const HostLocationSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("local") }),
  Schema.Struct({
    kind: Schema.Literal("remote"),
    hostId: Schema.String.check(Schema.isMinLength(1)),
  }),
]);

export type HostLocation = typeof HostLocationSchema.Type;

export const LOCAL_LOCATION: HostLocation = Object.freeze({
  kind: "local",
} as const);

const REMOTE_LOCATION_WIRE_PREFIX = "remote:";

export function encodeHostLocation(l: HostLocation): string {
  return l.kind === "local"
    ? "local"
    : `${REMOTE_LOCATION_WIRE_PREFIX}${l.hostId}`;
}

export function decodeHostLocation(s: string): HostLocation {
  if (s === "local") return LOCAL_LOCATION;
  if (s.startsWith(REMOTE_LOCATION_WIRE_PREFIX)) {
    const hostId = s.slice(REMOTE_LOCATION_WIRE_PREFIX.length);
    if (hostId.length > 0) return { kind: "remote", hostId };
  }
  throw new Error(
    `decodeHostLocation: "${s}" is not a canonical host location (expected "local" or "remote:<hostId>")`,
  );
}

export const PersistedSnapshotSchema = TerminalSnapshotSchema.mapFields(
  Struct.pick(["cwd", "git", "pr"]),
);
export type PersistedSnapshot = typeof PersistedSnapshotSchema.Type;

export const ClientPersistedTerminalFieldsSchema = Schema.Struct({
  themeName: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
  /** If set, this terminal is a sub-terminal of the given parent. */
  parentId: Schema.optionalKey(Schema.String),
  /** Canvas tile position/size — client-reported, used for session restore. */
  canvasLayout: Schema.optionalKey(CanvasLayoutSchema),
  /** Sub-panel collapsed/size state — client-reported, used for session restore. */
  subPanel: Schema.optionalKey(SubPanelStateSchema),
  rightPanel: Schema.optionalKey(RightPanelPerTerminalStateSchema),
  intent: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
});

export const TerminalClientMetadataSchema = ClientPersistedTerminalFieldsSchema;

const ActiveDiscriminantSchema = Schema.Struct({
  state: Schema.Literal("active"),
});
const SleepingDiscriminantSchema = Schema.Struct({
  state: Schema.Literal("sleeping"),
  sleptAt: Schema.Number,
});

const KoluAuthoredServerFieldsSchema = Schema.Struct({
  location: HostLocationSchema,
  restoreTarget: Schema.optionalKey(RestoreTargetSchema),
  agents: Schema.optionalKey(TerminalAgentsSchema),
  ...AgentMemorySchema.fields,
});

export const KoluAuthoredFieldsSchema = Schema.Struct({
  ...KoluAuthoredServerFieldsSchema.fields,
  ...ClientPersistedTerminalFieldsSchema.fields,
});

/** The authored ACTIVE arm — `location` + memory + client fields + `state:
 *  "active"`. No snapshot field. */
export const AuthoredActiveSchema = Schema.Struct({
  ...KoluAuthoredFieldsSchema.fields,
  ...ActiveDiscriminantSchema.fields,
});

/** The authored SLEEPING arm — `location` + memory + client fields + `sleptAt`.
 *  No snapshot field, and no frozen `pr`: `pr` is restore-relevant now and rides
 *  the persisted observation, so the dormant tile reads it from there. */
export const AuthoredSleepingSchema = Schema.Struct({
  ...KoluAuthoredFieldsSchema.fields,
  ...SleepingDiscriminantSchema.fields,
});

export const ParkedDiscriminantSchema = Schema.Struct({
  state: Schema.Literal("parked"),
  /** Epoch-millis padi parked this record at boot reconcile. */
  parkedAt: Schema.Number,
});

export const AuthoredParkedSchema = Schema.Struct({
  ...KoluAuthoredFieldsSchema.fields,
  ...ParkedDiscriminantSchema.fields,
});
export type AuthoredParkedTerminal = RegistryWritable<
  typeof AuthoredParkedSchema.Type
>;

/** The authored terminal as a sum — `entry.meta`'s static type. Discriminated on
 *  `state`, naming no snapshot field. */
export const AuthoredTerminalSchema = Schema.Union([
  AuthoredActiveSchema,
  AuthoredSleepingSchema,
]);

type RegistryWritable<T> = { -readonly [K in keyof T]: T[K] };

export type AuthoredActiveTerminal = RegistryWritable<
  typeof AuthoredActiveSchema.Type
>;
export type AuthoredSleepingTerminal = RegistryWritable<
  typeof AuthoredSleepingSchema.Type
>;
export type AuthoredTerminal = RegistryWritable<
  typeof AuthoredTerminalSchema.Type
>;

/** An active terminal — the FULL live `TerminalSnapshot` joined with the authored
 *  active arm. The only live arm; narrowing `state === "active"` yields the full
 *  agent detail + foreground. */
export const ActiveTerminalSchema = Schema.Struct({
  ...TerminalSnapshotSchema.fields,
  ...AuthoredActiveSchema.fields,
});

/** A sleeping terminal — the restore-relevant `PersistedSnapshot` (agent
 *  identity, no foreground) joined with the authored sleeping arm. Its PTY/agent
 *  are released, so it carries only what survives the release. */
export const SleepingTerminalSchema = Schema.Struct({
  ...PersistedSnapshotSchema.fields,
  ...AuthoredSleepingSchema.fields,
});

/** The on-disk persisted core, both arms share — the `PersistedSnapshot` +
 *  the authored fields. The saved active arm adds `state: "active"`; the saved
 *  sleeping arm adds `sleptAt`. Both add `id`. */
const SavedPersistedCoreSchema = Schema.Struct({
  ...PersistedSnapshotSchema.fields,
  ...KoluAuthoredFieldsSchema.fields,
});

export const TerminalMetadataSchema = Schema.Union([
  ActiveTerminalSchema,
  SleepingTerminalSchema,
]);

export const PLACEMENT_REQUIRED =
  'a create must state its `placement` — there is no default. Spell it `{"kind":"toplevel"}` for a tile of its own, or `{"kind":"child-of","parentId":"<terminal id>"}` to open it as a split inside that terminal. The canvas and the Dock read this edge as who-works-for-whom, so a guessed default would silently flatten the hierarchy.';

export const TerminalPlacementSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("toplevel") }),
  Schema.Struct({
    kind: Schema.Literal("child-of"),
    parentId: TerminalIdSchema,
  }),
]).annotate({ message: PLACEMENT_REQUIRED });

export type TerminalPlacement = typeof TerminalPlacementSchema.Type;

export const TOPLEVEL_PLACEMENT: TerminalPlacement = Object.freeze({
  kind: "toplevel",
} as const);

export const parentIdOf = (
  placement: TerminalPlacement,
): TerminalId | undefined =>
  placement.kind === "child-of" ? placement.parentId : undefined;

export const CreateTerminalInputSchema = Schema.Struct({
  themeName: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
  canvasLayout: Schema.optionalKey(CanvasLayoutSchema),
  subPanel: Schema.optionalKey(SubPanelStateSchema),
  rightPanel: Schema.optionalKey(RightPanelPerTerminalStateSchema),
  intent: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
});

export const RestoreOnlyMetadataSchema = Schema.Struct({
  lastActivityAt: Schema.optionalKey(Schema.Number),
  promptedAt: Schema.optionalKey(Schema.Number),
  restoreTarget: Schema.optionalKey(RestoreTargetSchema),
});

export const InitialTerminalMetadataSchema = Schema.Struct({
  ...CreateTerminalInputSchema.fields,
  ...RestoreOnlyMetadataSchema.fields,
});

/** Wire shape for a terminal's identity — the `id`+`pid` padiSurface's
 *  `lifecycle.create` / `kill` / `wake` return. Identity only; a terminal's
 *  metadata rides padi's `terminals` collection. */
export const TerminalInfoSchema = Schema.Struct({
  id: TerminalIdSchema,
  pid: Schema.Number,
});

export const TerminalOnExitOutputSchema = Schema.Number;

export const RecentRepoSchema = Schema.Struct({
  repoRoot: Schema.String,
  repoName: Schema.String,
  lastSeen: Schema.Number,
});

export const RecentAgentSchema = Schema.Struct({
  kind: Schema.String,
  /** The live process's `stableFlags`-filtered argv tokens. */
  argv: Schema.Array(Schema.String),
  lastSeen: Schema.Number,
});

/** Server-derived activity feed: recent repos cd'd into and recent agents
 *  detected live. Server is sole writer; client is read-only. */
export const ActivityFeedSchema = Schema.Struct({
  recentRepos: Schema.Array(RecentRepoSchema),
  recentAgents: Schema.Array(RecentAgentSchema),
});

/**
 * On-disk snapshot of a terminal — the persisted projection of the `Terminal`
 * sum plus a stable `id`. Same discriminant as `TerminalMetadataSchema`, minus
 * the live overlay (live fields never ride to disk): an active saved record is
 * the persisted base + id; a sleeping one adds `sleptAt`. A legacy record with
 * no `state` key is rejected on read, which `backfillTerminalState` repairs.
 */
const SavedTerminalIdSchema = Schema.Struct({
  id: TerminalIdSchema,
});

export const SavedActiveTerminalSchema = Schema.Struct({
  ...SavedPersistedCoreSchema.fields,
  ...ActiveDiscriminantSchema.fields,
  ...SavedTerminalIdSchema.fields,
});

/** The sleeping arm of the on-disk record (persisted-observation base + authored +
 *  `sleptAt` + id) — the shape a slept terminal persists. Named symmetrically with
 *  `SavedActiveTerminalSchema` so the saved sum reads as two equally-named arms. */
export const SavedSleepingTerminalSchema = Schema.Struct({
  ...SavedPersistedCoreSchema.fields,
  ...SleepingDiscriminantSchema.fields,
  ...SavedTerminalIdSchema.fields,
});

export const SavedTerminalSchema = Schema.Union([
  SavedActiveTerminalSchema,
  SavedSleepingTerminalSchema,
]);

export const SavedSessionSchema = Schema.Struct({
  terminals: Schema.Array(SavedTerminalSchema),
  activeTerminalId: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  savedAt: Schema.Number,
  resumableIds: Schema.optionalKey(Schema.Array(Schema.String)),
});

export type TerminalClientMetadata = RegistryWritable<
  typeof TerminalClientMetadataSchema.Type
>;
/** The base create input — what every ordinary caller and the wire spell. */
export type CreateTerminalInput = typeof CreateTerminalInputSchema.Type;
/** The three restore-only facts — only `restoreSpawn` (from the saved blob) spells them. */
export type RestoreOnlyMetadata = typeof RestoreOnlyMetadataSchema.Type;
export type InitialTerminalMetadata = typeof InitialTerminalMetadataSchema.Type;
/** The active arm of the `Terminal` sum — what `createMetadata` builds and the
 *  only arm Phase 1 constructs. Narrowing `state === "active"` yields this. */
export type ActiveTerminal = typeof ActiveTerminalSchema.Type;
/** The sleeping arm of the `Terminal` sum — persisted-observation base + memory +
 *  `sleptAt`. */
export type SleepingTerminal = typeof SleepingTerminalSchema.Type;
export type RecentRepo = typeof RecentRepoSchema.Type;
export type RecentAgent = typeof RecentAgentSchema.Type;
export type SavedTerminal = typeof SavedTerminalSchema.Type;
/** The active arm of `SavedTerminal` — what restore/adoption produce and the
 *  only on-disk arm Phase 1 writes. The whole-record adoption path is typed to
 *  this (a sleeping record has no live PTY to adopt). */
export type SavedActiveTerminal = typeof SavedActiveTerminalSchema.Type;
/** The sleeping arm of `SavedTerminal` — persisted base + `sleptAt` + id. What a
 *  slept terminal persists and what the boot seed / restore card read back. */
export type SavedSleepingTerminal = typeof SavedSleepingTerminalSchema.Type;

export const PtyHostIdentitySchema = Schema.Struct({
  staleKey: Schema.String,
  navigableCommit: Schema.String,
});

export const DaemonLifetimeInfoSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("forever") }),
  Schema.Struct({ kind: Schema.Literal("idleTimeout"), ms: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("boundToPid"), pid: Schema.Number }),
]) satisfies WireSchema<DaemonLifetimeInfo>;

// `Schema.optionalKey(Schema.Never)` is the anti-field spelling, verified
// against effect@4.1.4: a MISSING key decodes fine, a PRESENT value —
// including an explicit `undefined` — is REJECTED.
const NON_CONNECTED_ENDPOINT_STATES = ENDPOINT_STATES.filter(
  (state): state is Exclude<EndpointState, "connected" | "incompatible"> =>
    state !== "connected" && state !== "incompatible",
) as [
  Exclude<EndpointState, "connected" | "incompatible">,
  ...Exclude<EndpointState, "connected" | "incompatible">[],
];

export const KavalSkewVersionsSchema = Schema.Struct({
  /** The contract version the daemon actually speaks. */
  daemonVersion: Schema.String,
  /** The contract version this kolu's build requires. */
  requiredVersion: Schema.String,
});
export type KavalSkewVersions = typeof KavalSkewVersionsSchema.Type;

const CONNECTED_ONLY_ABSENT = {
  identity: Schema.optionalKey(Schema.Never),
  contractVersion: Schema.optionalKey(Schema.Never),
  startedAt: Schema.optionalKey(Schema.Never),
  adopted: Schema.optionalKey(Schema.Never),
  adoptedAt: Schema.optionalKey(Schema.Never),
  autoRecoveredAt: Schema.optionalKey(Schema.Never),
  linkRestoredAt: Schema.optionalKey(Schema.Never),
  lifetime: Schema.optionalKey(Schema.Never),
};

export const DaemonStatusSchema = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("connected"),
    identity: Schema.optionalKey(PtyHostIdentitySchema),
    /** The pty-host wire contract this daemon reported at handshake. Kaval's
     *  build identity is `identity.navigableCommit`; this is the protocol version
     *  kolu-server must agree on before talking to it. */
    contractVersion: Schema.String,
    /** Daemon boot time (ms epoch) — the rail's KAVAL uptime is derived from it. */
    startedAt: Schema.Number,
    adopted: Schema.optionalKey(Schema.Number),
    adoptedAt: Schema.optionalKey(Schema.Number),
    autoRecoveredAt: Schema.optionalKey(Schema.Number),
    linkRestoredAt: Schema.optionalKey(Schema.Number),
    /** The local kaval's unix socket path (`$XDG_RUNTIME_DIR/kaval-<port>/pty-host.sock`)
     *  — surfaced for the kaval dialog to show where this daemon listens (the
     *  path `kaval-tui` auto-discovers). kolu's soul (a server fact the client
     *  can't construct — it doesn't know the server's `XDG_RUNTIME_DIR`); set
     *  once at boot, constant for the daemon's life. Optional + additive. */
    socketPath: Schema.optionalKey(Schema.String),
    lifetime: Schema.optionalKey(DaemonLifetimeInfoSchema),
    daemonVersion: Schema.optionalKey(Schema.Never),
    requiredVersion: Schema.optionalKey(Schema.Never),
  }),
  Schema.Struct({
    state: Schema.Literal("incompatible"),
    ...KavalSkewVersionsSchema.fields,
    ...CONNECTED_ONLY_ABSENT,
    socketPath: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    state: Schema.Literals(NON_CONNECTED_ENDPOINT_STATES),
    ...CONNECTED_ONLY_ABSENT,
    daemonVersion: Schema.optionalKey(Schema.Never),
    requiredVersion: Schema.optionalKey(Schema.Never),
    /** The local kaval's unix socket path (`$XDG_RUNTIME_DIR/kaval-<port>/pty-host.sock`)
     *  — surfaced for the kaval dialog to show where this daemon listens (the
     *  path `kaval-tui` auto-discovers). */
    socketPath: Schema.optionalKey(Schema.String),
  }),
]);
export type DaemonStatus = typeof DaemonStatusSchema.Type;
export type DaemonState = DaemonStatus["state"];

export { type ProcessRss, ProcessRssSchema };

export const PadiProcessMemorySchema = Schema.Struct({
  padi: ProcessRssSchema,
  kaval: ProcessRssSchema,
});
export type PadiProcessMemory = typeof PadiProcessMemorySchema.Type;

/** The value a fresh `processMemory` subscriber sees before padi's first sample —
 *  both processes' RSS unknown (the honest `absent`, never a fake zero). */
export const DEFAULT_PADI_PROCESS_MEMORY: PadiProcessMemory = {
  padi: { status: "absent" },
  kaval: { status: "absent" },
};

/** Server-derived activity feed — derived off its schema directly now that the
 *  cell rides `padiSurface` (no longer a `koluSurface` cell). */
export type ActivityFeed = typeof ActivityFeedSchema.Type;
/** The unified terminal record — NOT a served collection value (the wire
 *  carries the `authored` + `awareness` halves separately). This is the shape
 *  `composeTerminalMetadata` reconstructs at the client read and at disk
 *  persist, and the type the ~20 `getMetadata` consumers see. */
export type TerminalMetadata = typeof TerminalMetadataSchema.Type;
export type TerminalInfo = typeof TerminalInfoSchema.Type;
export type SavedSession = typeof SavedSessionSchema.Type;

export function activeArm(
  m: TerminalMetadata | null | undefined,
): ActiveTerminal | undefined {
  return m?.state === "active" ? m : undefined;
}

export function sleepingArm(
  m: TerminalMetadata | null | undefined,
): SleepingTerminal | undefined {
  return m?.state === "sleeping" ? m : undefined;
}

export function createAuthoredActive(
  location: HostLocation,
): AuthoredActiveTerminal {
  return { location, ...seedMemory(), state: "active" };
}

const decodePersistedSnapshot = Schema.decodeUnknownSync(
  PersistedSnapshotSchema,
);
const decodeSleepingTerminal = Schema.decodeUnknownSync(SleepingTerminalSchema);

/** Join a terminal's authored half and its observation into the unified
 *  {@link TerminalMetadata}. The sleeping arm keeps only the restore-relevant
 *  projection of the observation. Throws on a value that is not a terminal
 *  record. */
export function composeTerminalMetadata(
  authored: AuthoredTerminal,
  observation: TerminalSnapshot,
): TerminalMetadata {
  return authored.state === "active"
    ? { ...observation, ...authored }
    : decodeSleepingTerminal({
        ...decodePersistedSnapshot(observation),
        ...authored,
      });
}

export function activePr(
  m: TerminalMetadata | null | undefined,
): PrInfo | null {
  const arm = activeArm(m);
  return arm ? prValue(arm.pr) : null;
}

export function backfillRemoteUrl(
  t: Record<string, unknown>,
): Record<string, unknown> {
  const git = t.git;
  if (!git || typeof git !== "object") return t;
  if ("kind" in git || "remoteUrl" in git) return t;
  return {
    ...t,
    git: { ...(git as Record<string, unknown>), remoteUrl: null },
  };
}

export function backfillGitFact(
  t: Record<string, unknown>,
): Record<string, unknown> {
  if (!("git" in t)) return t;
  const git = t.git;
  if (git === null) return { ...t, git: { kind: "unresolved" } };
  if (typeof git === "object" && !("kind" in git))
    return { ...t, git: { kind: "repo", info: git } };
  return t;
}

export function backfillLocation(
  t: Record<string, unknown>,
): Record<string, unknown> {
  if ("location" in t) return t;
  return { ...t, location: LOCAL_LOCATION };
}

export function backfillTerminalState(
  t: Record<string, unknown>,
): Record<string, unknown> {
  if ("state" in t) return t;
  return { ...t, state: "active" };
}

const decodeAgentKindResult = Schema.decodeUnknownResult(AgentKindSchema);

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
      const ref =
        agentSession && typeof agentSession === "object"
          ? (agentSession as Record<string, unknown>)
          : null;
      const kind = ref ? decodeAgentKindResult(ref.kind) : null;
      const exact =
        ref !== null &&
        kind !== null &&
        Result.isSuccess(kind) &&
        typeof ref.id === "string" &&
        ref.id.length > 0
          ? {
              kind: "exact",
              command,
              agent: {
                kind: kind.success,
                sessionId: ref.id,
                resumeRef: ref.id,
              },
            }
          : { kind: "legacyMostRecent", command };
      next.restoreTarget = exact;
    }
  }
  return next;
}

export function backfillRestoreTargetArgv(
  t: Record<string, unknown>,
): Record<string, unknown> {
  const { lastAgentCommand: _dropped, ...next } = t;
  const target = next.restoreTarget;
  if (!target || typeof target !== "object") return next;
  const shaped = target as Record<string, unknown>;
  switch (shaped.kind) {
    case "none":
      return next;
    case "legacyMostRecent":
      return { ...next, restoreTarget: { kind: "none" } };
    case "exact": {
      if ("argv" in shaped) return next;
      const agent = shaped.agent;
      if (!agent || typeof agent !== "object") return next;
      return {
        ...next,
        restoreTarget: { kind: "exact", agent, argv: [] },
      };
    }
    default:
      return next;
  }
}

export function backfillAgentsStamp(
  t: Record<string, unknown>,
): Record<string, unknown> {
  const agents = t.agents;
  if (
    agents === undefined ||
    (typeof agents === "object" && agents !== null && "profiles" in agents)
  )
    return t;
  const { agents: _legacy, ...rest } = t;
  return rest;
}

export function backfillPrDraft(
  t: Record<string, unknown>,
): Record<string, unknown> {
  const pr = t.pr;
  if (!pr || typeof pr !== "object") return t;
  const shaped = pr as Record<string, unknown>;
  if (shaped.kind !== "ok") return t;
  const value = shaped.value;
  if (!value || typeof value !== "object" || "isDraft" in value) return t;
  return { ...t, pr: { kind: "pending" } };
}

/** Bring one legacy saved-terminal record up to the current
 *  `SavedTerminalSchema` by composing every field backfill above. Order-free
 *  (each is idempotent + presence-keyed); spelled in ladder order for reading. */
export function backfillSavedTerminal(
  t: Record<string, unknown>,
): Record<string, unknown> {
  return backfillPrDraft(
    backfillAgentsStamp(
      backfillRestoreTargetArgv(
        backfillSnapshotCutover(
          backfillTerminalState(
            backfillLocation(backfillGitFact(backfillRemoteUrl(t))),
          ),
        ),
      ),
    ),
  );
}

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

export function backfillActivityFeed(value: unknown): ActivityFeed {
  const feed =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const repos = Array.isArray(feed.recentRepos) ? feed.recentRepos : [];
  return {
    recentRepos: repos.filter(isRecentRepoRow),
    recentAgents: [],
  };
}

const isRecentRepoRow = Schema.is(RecentRepoSchema);

export function stripImportedTargetArgv(session: SavedSession): SavedSession {
  return {
    ...session,
    terminals: session.terminals.map((terminal) => {
      const target = terminal.restoreTarget;
      return target?.kind === "exact"
        ? { ...terminal, restoreTarget: identityOnlyTarget(target.agent) }
        : terminal;
    }),
  };
}
