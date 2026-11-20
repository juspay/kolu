import {
  composeSurfaceContracts,
  defineSurface,
  defineSurfaceWithPolicy,
  type Surface,
  type SurfaceTypes,
} from "@kolu/surface/define";
import { MAX_TIMER_MS } from "@kolu/surface/wait";
import {
  CONTROL_CORE_VERSION,
  type ControlCoreHello,
  ControlCoreHelloSchema,
  controlCoreProcedureSpec,
} from "@kolu/surface-daemon/control-core";
import {
  WAIT_STATES,
  WATCH_DEFAULT_STATES,
} from "@kolu/terminal-vocab/agentProjection";
import {
  FsFileInputSchema,
  FsReadFileTextOutputSchema,
  HostListenersSchema,
  hostListenersEqual,
  PrResultSchema,
  RepoChangePulseSchema,
  TerminalIdSchema,
  UNKNOWN_HOST_LISTENERS,
} from "@kolu/terminal-vocab/schema";
import { oduServiceSurface } from "@odu/service-client/surface";
import { Effect, Schema } from "effect";
import {
  FsListAllInputSchema,
  FsListAllOutputSchema,
  FsListDirectoryInputSchema,
  FsListDirectoryOutputSchema,
  FsListIgnoredInputSchema,
  FsListIgnoredOutputSchema,
  GitDiffInputSchema,
  GitDiffOutputSchema,
  GitStatusInputSchema,
  GitStatusOutputSchema,
  WorktreeCreateInputSchema,
  WorktreeCreateOutputSchema,
  WorktreeRemoveInputSchema,
} from "kolu-git/schemas";
import {
  CanvasLayoutSchema,
  RightPanelPerTerminalStateSchema,
} from "./chromeVocab.ts";
import { PadiDiagnosticsSchema } from "./diagnostics.ts";
import {
  AgentDistroReceiptSchema,
  AgentDistroSettingSchema,
  AgentDistroStatusSchema,
  agentDistroReceiptEqual,
  AgentDistroDeliveryReportSchema,
  agentDistroSettingEqual,
  agentDistroStatusEqual,
  DEFAULT_AGENT_DISTRO_SETTING,
  DEFAULT_AGENT_DISTRO_STATUS,
  EMPTY_AGENT_DISTRO_RECEIPT,
  TerminalAgentsSchema,
} from "@kolu/agent-distro/schema";
import {
  AgentLaunchSchema,
  AgentModelsSchema,
} from "@kolu/agent-distro/models";
import type { ClientErrorPolicy } from "./clientPolicy.ts";
import {
  AgentLaunchUnavailable,
  AgentModelsUnavailable,
  FsGitReadErrorSchema,
  GitBaseReadErrorSchema,
  KavalContractSkew,
  PreviewTooLarge,
  ScratchWriteRejected,
  TerminalGateErrorSchema,
  TerminalNotFound,
  TerminalParentCycle,
  TranscriptNoAgent,
  TranscriptNotFound,
  WatchSubscriptionNotFound,
  WorktreeCreateErrorSchema,
} from "./errors.ts";
import {
  DEFAULT_NEW_TERMINAL_POLICY,
  NewTerminalPolicySchema,
  newTerminalPolicyEqual,
} from "./newTerminalPolicy.ts";
import {
  ExportTranscriptHtmlInputSchema,
  ExportTranscriptHtmlOutputSchema,
} from "./transcriptSchema.ts";
import {
  ActiveTerminalSchema,
  ActivityFeedSchema,
  CreateTerminalInputSchema,
  DaemonLifetimeInfoSchema,
  DaemonStatusSchema,
  DEFAULT_PADI_PROCESS_MEMORY,
  KoluAuthoredFieldsSchema,
  PadiProcessMemorySchema,
  ParkedDiscriminantSchema,
  PersistedSnapshotSchema,
  PLACEMENT_REQUIRED,
  PtyHostIdentitySchema,
  SavedSessionSchema,
  SleepingTerminalSchema,
  TerminalInfoSchema,
  type TerminalMetadata,
  TerminalOnExitOutputSchema,
  TerminalPlacementSchema,
} from "./vocab.ts";

export * from "./chromeVocab.ts";
export * from "./diagnostics.ts";
export type { ClientErrorPolicy, ToastOnlyPolicy } from "./clientPolicy.ts";
export * from "./errors.ts";
export {
  DEFAULT_NEW_TERMINAL_POLICY,
  type NewTerminalPolicy,
  NewTerminalPolicySchema,
  newTerminalPolicyEqual,
} from "./newTerminalPolicy.ts";
export * from "./vocab.ts";
export * from "./transcriptSchema.ts";

/** The wire-shape `major.minor` this build of `padiSurface` serves and expects.
 *
 *  Additive growth — a new optional field, stream, procedure or cell that does
 *  not ride a shared whole-record client write — is a MINOR bump; a
 *  shape-breaking change, or a persisted-record field added to a client-written
 *  whole-record command, is a MAJOR, because only a major makes
 *  `isContractVersionCompatible` refuse the skew in BOTH directions. Distinct
 *  from {@link CONTROL_CORE_VERSION}, which is frozen so a contract-revving
 *  deploy can still reach the daemon's control core. */
export const PADI_SURFACE_VERSION = "7.12";

/** The `version` cell payload — padi's self-declared surface contract version. */
export const PadiVersionSchema = Schema.Struct({
  contractVersion: Schema.String,
});
export type PadiVersion = typeof PadiVersionSchema.Type;

/** The value a fresh `version` subscriber sees — this build's version. */
export const DEFAULT_PADI_VERSION: PadiVersion = {
  contractVersion: PADI_SURFACE_VERSION,
};

/** The `identity` cell payload — padi's own honest identity, PER HOST. padi is the
 *  sole authority on its own identity (P3): these are the EXACT facts it already
 *  advertises on the frozen control-core `hello` ({@link PadiHelloSchema}'s
 *  `commit`/`surfaceVersion`/`startedAt`, below) — re-served here, on `padiSurface`
 *  itself, so a per-host `padiMap` entry (W4's cross-host dock) can read the
 *  RUNNING padi's own identity directly instead of riding the single legacy bind
 *  (`daemonInventory.boundPadi` / `app.cells.padiLink`), which only ever describes
 *  whichever ONE padi kolu-server happens to be bound to — a wrong-host lie the
 *  instant a REMOTE host is active.
 *
 *  `commit` is DECLARED, not "absent until known": `null` means padi ITSELF has
 *  declared "no commit" (a dev/off-nix build with no `PADI_COMMIT_HASH`) — a real
 *  fact, rendered "—". This is NEVER the encoding for "the cell hasn't arrived over
 *  the wire yet" — that is the subscription's own pending state (the client reads
 *  `undefined`, not a synthesized `null`), so the two "unknown"s can't be conflated
 *  (see `padiPresentation.ts`'s `toPadiPresence` on the client). `surfaceVersion`
 *  and `startedAt` are likewise always DECLARED once the cell arrives — never
 *  optional-absent.
 *
 *  `startedAt` is padi's RAW boot epoch, stamped on padi's OWN clock — a consumer
 *  on a DIFFERENT host must reproject it through that entry's `clock.toLocal`
 *  before computing an uptime (never `browserNow − rawRemoteEpoch`, the
 *  metadata-boundary bug `useDaemonStatus.ts`'s `localDaemonStatus` already fixed
 *  for `daemonStatus.startedAt` — this cell's consumer must mirror it). */
export const PadiIdentitySchema = Schema.Struct({
  commit: Schema.NullOr(Schema.String),
  surfaceVersion: Schema.String,
  startedAt: Schema.Number,
  /** padi's lifetime policy (`forever` in production; `boundToPid` under a
   *  test/smoke run) — surfaced for the Padi dialog's lifetime row. A live padi
   *  seeds it synchronously at boot, so a subscriber sees the real value from the
   *  first frame; OPTIONAL only so a binder reading a survivor padi that predates
   *  the field parses without a forced drain (the reader falls back to "—"). */
  lifetime: Schema.optionalKey(DaemonLifetimeInfoSchema),
});
export type PadiIdentity = typeof PadiIdentitySchema.Type;

/** The pre-boot placeholder — practically unobservable: padi computes the real
 *  identity synchronously (no I/O) at surface-deps construction and seeds the
 *  store with it directly, so a fresh subscriber sees the real value from the
 *  first frame. Kept only because every cell needs a `default` (spec completeness,
 *  the `liveWhen`-adjacent contract every other cell here follows). */
export const DEFAULT_PADI_IDENTITY: PadiIdentity = {
  commit: null,
  surfaceVersion: PADI_SURFACE_VERSION,
  startedAt: 0,
  lifetime: { kind: "forever" },
};

/** The `status` cell payload — host-side facts the dock's kaval column reads
 *  that are NEITHER a daemon-liveness transition (that rides the `daemonStatus`
 *  collection) NOR a terminal record. Today just `expectedKaval` — the identity
 *  of the kaval THIS padi would spawn (its own baked closure `staleKey` + git
 *  `navigableCommit`), the *expected* operand of B3.4's read-site currency nudge
 *  (`expectedKaval.staleKey !== daemonStatus.identity.staleKey`). A build
 *  CONSTANT (never changes at runtime), so padi seeds it once at boot; off-nix
 *  the id is "" and the field is omitted, so the nudge stays silent. This is the
 *  member that lets the last kaval read leave `packages/server` (W1.R7 — the
 *  expected identity was the surface-app `buildInfo` cell's extra axis before). */
export const PadiStatusSchema = Schema.Struct({
  expectedKaval: Schema.optionalKey(PtyHostIdentitySchema),
});
export type PadiStatus = typeof PadiStatusSchema.Type;

/** The value a fresh `status` subscriber sees before padi seeds it — no expected
 *  kaval known yet. */
export const DEFAULT_PADI_STATUS: PadiStatus = {};

/** The `roster` cell payload — THE CENSUS OF THIS HOST'S TERMINALS, or the
 *  statement that there isn't one yet.
 *
 *  Not the rows (those are the `terminals` collection): WHICH IDS THIS HOST
 *  HAS, as one frame padi states about itself. padi serves its surface BEFORE
 *  it boots the kaval endpoint and reconciles the saved session, so its first
 *  frame is an information-free empty registry, and a kaval recycle empties the
 *  registry again between the drain and the re-park. In both windows "that id
 *  is not listed" means NOTHING HAS BEEN ADOPTED YET, not "that terminal is
 *  dead" — a distinction padi already draws for its own attention folds
 *  (`attention/fleetGate.ts`) and now states out loud, because every consumer
 *  of an absence needs it: kolu-server's Conductor watch (`gone` requires a
 *  Ready host), the client's per-terminal standing, the deep-link gone-verdict.
 *
 *  THE CENSUS RIDES THE SAME FRAME AS THE STANDING, and that is the point. A
 *  reader that takes the standing from one member and the list from another can
 *  be told "established" by one and an empty list by the other — which is
 *  exactly what a PROJECTION of this surface does, because kolu-server's
 *  per-host mirror marks a session connected on its first folded CELL frame
 *  while the `terminals` collection it mirrors has not folded yet. The
 *  Conductor's watch read that pair and recorded every member of every work
 *  `gone` on a redeploy whose terminals were adopted, alive, under the same ids
 *  (#2376). Two members cannot be made to arrive together; one member cannot be
 *  made to arrive apart. So the ids are HERE, and a census that has not been
 *  taken has nowhere to be written down.
 *
 *  A SUM, not a boolean: `established` carries WHEN the roster became
 *  authoritative, which is the one thing a reader debugging a false absence
 *  wants (and what distinguishes "established at boot" from "re-established
 *  after a recycle" in a log). There is nowhere to put a timestamp — or a
 *  census — on a `settling` roster, because there isn't one. */
export const PadiRosterSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("settling") }),
  Schema.Struct({
    kind: Schema.Literal("established"),
    at: Schema.Number,
    /** Every terminal id this host holds — the SAME keys the `terminals`
     *  collection carries records for, stated by the registry that is their
     *  authority. A record may still be on its way; membership is answered
     *  here. */
    ids: Schema.Array(TerminalIdSchema),
  }),
]);
export type PadiRoster = typeof PadiRosterSchema.Type;

/** The honest pre-adopt value, and the cell's default: a padi that has not said
 *  otherwise has not finished adopting. A fresh subscriber therefore learns
 *  "settling" rather than an empty roster it would read as an absence — the
 *  whole point of the member. */
export const DEFAULT_PADI_ROSTER: PadiRoster = { kind: "settling" };

/** Is this roster EVIDENCE — may a reader conclude that a terminal missing from
 *  it is really gone? The one fold both sides read, so the browser's standing
 *  and kolu-server's watch cannot answer it differently.
 *
 *  A PREDICATE, so a caller that goes on to read the census does not have to
 *  re-spell the arm test to get at it.
 */
export const rosterIsEstablished = (
  roster: PadiRoster,
): roster is Extract<PadiRoster, { readonly kind: "established" }> =>
  roster.kind === "established";

/** Does this host hold that terminal? `null` when the roster is settling — the
 *  question has no answer yet, which is NOT `false`. The one place a caller's
 *  "is it there?" is decided, so nobody re-derives it from a list that may be a
 *  projection's empty seed. */
export const rosterHolds = (roster: PadiRoster, id: string): boolean | null =>
  roster.kind === "established" ? roster.ids.some((held) => held === id) : null;

export const RunningKavalSchema = Schema.Struct({
  /** The rendezvous socket path — the pasteable `--socket` value. */
  socket: Schema.String,
  /** Discovery's human label ("standalone kaval" | "kolu @ <state-root>" |
   *  "kolu-server on port <port>"), decided at discovery's matching branch. */
  label: Schema.String,
  /** The structural kind: `stateRoot` (a padi's kaval — carries a state-root
   *  manifest, incl. an ADOPTED legacy-address kaval), `port` (an UN-adopted legacy
   *  `kaval-<port>/` with NO manifest — a genuine stray/leak), `standalone`, or
   *  `unknown`. */
  kind: Schema.Literals(["stateRoot", "port", "standalone", "unknown"]),
  /** The gate-holder pid (`kaval.pid`), or null if unreadable. */
  gatePid: Schema.NullOr(Schema.Int),
  /** Live terminal count from `terminal.list`, or null when the listener is honestly
   *  absent (never a fake 0 and never a swallowed protocol failure). */
  terminalCount: Schema.NullOr(Schema.Int),
  /** The kaval's build commit from the frozen `control.core.hello` identity fragment,
   *  or null for honest unknown (pre-fragment/off-Nix) or an absent listener. */
  buildCommit: Schema.NullOr(Schema.String),
  /** The pty-host contract version, or null when the listener is honestly absent. */
  contractVersion: Schema.NullOr(Schema.String),
  /** Whether the scanning host's kolu ACTIVELY owns this kaval ("in use by kolu"), and —
   *  when it does — whether it sits at the pre-padi LEGACY `kaval-<port>/` address (padi
   *  ADOPTED a live pre-W2.2 kaval on upgrade rather than leaking it — a KNOWN converging
   *  state, not a leak, until the next recycle spawns it at the digest address).
   *
   *  A discriminated pair, NOT two independent booleans: `atLegacyAddress` exists ONLY on
   *  the `active` arm, so the nonsense "legacy-but-not-owned" state is UNREPRESENTABLE
   *  (P4). Only the host serving its OWN `hostInventory` marks `active` — a local-machine
   *  scan under a remote binding is always `{ active: false }` (kolu is bound elsewhere). */
  held: Schema.Union([
    Schema.Struct({ active: Schema.Literal(false) }),
    Schema.Struct({
      active: Schema.Literal(true),
      atLegacyAddress: Schema.Boolean,
    }),
  ]),
});
export type RunningKaval = typeof RunningKavalSchema.Type;

export const RunningPadiSchema = Schema.Struct({
  /** padi's rendezvous socket path. */
  socket: Schema.String,
  /** padi's state-root (from the digest→root manifest), or null if unreadable. */
  stateRoot: Schema.NullOr(Schema.String),
  /** The gate-holder pid (`padi.pid`), or null if unreadable. */
  gatePid: Schema.NullOr(Schema.Int),
  /** True iff this is the padi the scanning host's kolu owns ("in use by kolu"). The
   *  active padi's contract version + build commit do NOT ride this row — padi cannot
   *  probe a foreign padi, so every non-active row would carry nulls; the one bound
   *  padi's identity is published once on `daemonInventory.boundPadi` (the honest
   *  fresh-each-tick live read that also works over ssh). */
  active: Schema.Boolean,
});
export type RunningPadi = typeof RunningPadiSchema.Type;

/** One host's daemon inventory — every running kaval + padi on a single machine. The ONE
 *  container both `padiSurface.hostInventory` (the bound host's own scan) and
 *  `kolu-common/surface`'s `daemonInventory.localScan` (kolu-server's local-machine scan)
 *  compose, so the scanner returns one neutral shape, not two lockstep copies. */
export const HostDaemonInventorySchema = Schema.Struct({
  kavals: Schema.Array(RunningKavalSchema),
  padis: Schema.Array(RunningPadiSchema),
});
export type HostDaemonInventory = typeof HostDaemonInventorySchema.Type;

/** The `hostInventory` cell payload — the bound padi's scan of its OWN host, riding the
 *  re-served surface so the dialog's bound-host list works identically local and remote.
 *  Structurally {@link HostDaemonInventorySchema} (the same shape kolu-server's local
 *  scan uses). */
export const PadiHostInventorySchema = HostDaemonInventorySchema;
export type PadiHostInventory = typeof PadiHostInventorySchema.Type;

/** The honest pre-sample value — empty lists, so a fresh subscriber renders no
 *  fabricated daemons until padi's first scan lands. */
export const DEFAULT_PADI_HOST_INVENTORY: PadiHostInventory = {
  kavals: [],
  padis: [],
};

/** RESERVED cross-host dock axis. Absent on every W1 record (one padi serves
 *  ONE host, so a canvas holds no foreign host to name), but present in the
 *  contract from 1.0 so the cross-host dock (W4) — foreign hosts' rows in the
 *  dock, click = switch + focus — lands without a contract break. Merged onto
 *  every arm so the dock projection reads one field regardless of record state. */
export const PadiHostAxisSchema = Schema.Struct({
  /** The host a dock row belongs to, for the cross-host dock. Undefined on a
   *  single-host canvas (W1–W3) — never populated until the W4 aggregation. */
  host: Schema.optionalKey(Schema.String),
});

/** The active arm — the full live `TerminalMetadata` active record + the
 *  reserved host axis. */
export const PadiActiveTerminalSchema = Schema.Struct({
  ...ActiveTerminalSchema.fields,
  ...PadiHostAxisSchema.fields,
});

/** The sleeping arm — the restore-relevant sleeping record + the host axis. */
export const PadiSleepingTerminalSchema = Schema.Struct({
  ...SleepingTerminalSchema.fields,
  ...PadiHostAxisSchema.fields,
});

/** The parked arm — the restore-relevant persisted projection + the shared
 *  authored fields + the `parked` discriminant + the host axis. Built from the
 *  SAME `PersistedSnapshotSchema` + `KoluAuthoredFieldsSchema` base the
 *  `sleeping` arm uses, so the three arms can't drift on the authored shape. */
export const PadiParkedTerminalSchema = Schema.Struct({
  ...PersistedSnapshotSchema.fields,
  ...KoluAuthoredFieldsSchema.fields,
  ...ParkedDiscriminantSchema.fields,
  ...PadiHostAxisSchema.fields,
});

/** The `parked` arm as a standalone type — the reboot-killed active record padi
 *  parks at boot. Exported so a client type-guard (`isParked` in
 *  `useTerminalMetadata.ts`) can narrow the composed `PadiTerminal` union to it
 *  at the single client bridge, instead of re-deriving a widened `.state` cast. */
export type PadiParkedTerminal = typeof PadiParkedTerminalSchema.Type;

/** The composed terminal record padi serves — `active | sleeping | parked`,
 *  discriminated on `state`. The server-side `authored ⋈ snapshot` join
 *  (`composeTerminalMetadata`) produces the `active`/`sleeping` arms; `parked`
 *  is reserved (W1.R produces it). Supersedes the client-side reader-join: one
 *  writer composes both halves, so no fold crosses a wire. */
export const PadiTerminalSchema = Schema.Union([
  PadiActiveTerminalSchema,
  PadiSleepingTerminalSchema,
  PadiParkedTerminalSchema,
]);
export type PadiTerminal = typeof PadiTerminalSchema.Type;

/** The active arm as a standalone type — the live record a WIRE reader gets. */
export type PadiActiveTerminal = typeof PadiActiveTerminalSchema.Type;

/** Narrow a WIRE terminal record to its ACTIVE arm, or `undefined` when it is
 *  sleeping / parked / absent — `activePadiTerminal(rec)?.ports`.
 *
 *  The wire twin of `vocab.ts`'s {@link activeArm}, and it exists for the same
 *  reason that one does: so "is this record live?" has exactly one spelling per
 *  seam rather than a `state === "active"` check scattered through every reader.
 *  Two of them rather than one because they narrow two genuinely different types
 *  — `activeArm` takes the composed `TerminalMetadata` a store holds, this takes
 *  the `PadiTerminal` a collection frame carries, and the union's PARKED arm
 *  exists only on the wire side. A single reader over both would have to widen to
 *  their intersection, which is the shape neither caller actually has. */
export function activePadiTerminal(
  record: PadiTerminal | null | undefined,
): PadiActiveTerminal | undefined {
  return record?.state === "active" ? record : undefined;
}

/** Is this wire record the PARKED arm — a reboot-killed record padi parked at
 *  boot, which is a restore-card row rather than a live terminal?
 *
 *  Exported (rather than left as each reader's `state === "parked"`) for the
 *  same reason {@link activePadiTerminal} is: so a narrowing of padi's wire
 *  union has one spelling per seam. kolu declared this guard privately in its
 *  own client bridge; an out-of-repo consumer holding the same three-arm union
 *  had no way to reach it, and no honest way past it. */
export function isParkedTerminal(
  record: PadiTerminal,
): record is PadiParkedTerminal {
  return record.state === "parked";
}

/** Narrow a wire record to the TILE record — the honest two-arm
 *  `TerminalMetadata` (`active | sleeping`) that every tile-rendering consumer
 *  expects — or `undefined` for a parked record or an absent one.
 *
 *  This is the ONE type bridge where padi's wire shape meets a client's domain
 *  type, and it belongs here rather than in each client. A parked record has no
 *  live arm and no `sleptAt`: it is not a tile, it is a row on a restore card,
 *  and every fold over a terminal's live state (`activeArm`, `sleepingArm`, a
 *  dock row's paint) is undefined for it — not by oversight, by what the record
 *  IS. A reader who has one and wants a tile wants exactly this answer.
 *
 *  It folds "has not arrived" and "arrived but parked" into one `undefined`,
 *  deliberately: both mean "there is no tile here", which is the only question
 *  the caller is asking. A caller that needs the census apart (kolu's does, to
 *  count parked records for its restore card) tests {@link isParkedTerminal}
 *  itself, on the raw record, before reaching for this.
 *
 *  NOTE — two unrelated things are called "parked" in this stack, and they are
 *  not the same fact. THIS one is padi's record state: the terminal is gone, its
 *  record persisted. The dock row's `parked` BUCKET is a staleness verdict
 *  (`isStale(recencyAt)` — the row fell outside the user's activity window) over
 *  a terminal that is perfectly alive. A row fold's `parked: boolean` parameter
 *  always means the second one. */
export function tileTerminalOf(
  record: PadiTerminal | null | undefined,
): TerminalMetadata | undefined {
  if (record === null || record === undefined) return undefined;
  return isParkedTerminal(record) ? undefined : record;
}

/** The recency-FREE urgency fold off the registry: how many terminals await
 *  the user, and which. The ONE thing kolu-server reads from every warm binding
 *  (for cross-host badge fan-in), so it deliberately carries ids and NO
 *  recency — nothing cross-host ever compares two hosts' clocks. No separate
 *  count: a count that could disagree with `awaitingIds` is a second source of
 *  truth for one fact, so the count is DERIVED at every read site as
 *  `awaitingIds.length` (see `HostSelectorStrip.tsx`'s `awaiting()`), never
 *  carried on the wire. */
export const PadiUrgencySchema = Schema.Struct({
  /** The ids of the terminals whose agent is awaiting the user
   *  (`awaiting_user`) — for a badge deep-link to focus one, and for the badge
   *  COUNT (`.length`), read at the consumer, never duplicated here. */
  awaitingIds: Schema.Array(TerminalIdSchema),
  /** The ids of the terminals whose agent just FINISHED its turn and is idling
   *  (`waiting`) — the other half of the attention model. Carried so the ONE
   *  cross-host attention owner (`useAttention`) applies the SAME rules to a
   *  finished agent on a background host as on the active one (fire once if
   *  unseen, quiet host-tab mark), instead of a finish being legible only on the
   *  host you're looking at. Recency-free like `awaitingIds`.
   *
   *  A DECODING DEFAULT for ROLLING-DEPLOY safety: a newer client reading an
   *  OLDER padi's `urgency` frame (which predates this field) parses it as `[]`
   *  rather than failing validation and breaking the whole cell — asking keeps
   *  working, and finishes light up the moment that host's padi catches up.
   *
   *  KEY-level (`withDecodingDefaultKey`, PLAN #17), which reproduces zod's
   *  `.default([])` in BOTH directions and is pinned by a byte fixture: a
   *  MISSING key decodes to `[]`, an explicit `undefined` is REJECTED (an older
   *  padi omits the key, it never sends `undefined`), and ENCODING always emits
   *  the key — so a frame this build serves is byte-identical to the zod-era
   *  one. `Effect.sync` (not `Effect.succeed`) so each decode gets its OWN
   *  array rather than one shared mutable instance. */
  finishedIds: Schema.Array(TerminalIdSchema).pipe(
    Schema.withDecodingDefaultKey(Effect.sync(() => [])),
  ),
  /** The ids of the terminals whose agent is WORKING (thinking / tools /
   *  background) — the third leg of the host-tab attention summary (working ·
   *  needs-you · unseen), carried so a background host's tab can say "3 agents
   *  in flight" without mirroring its full terminals collection. Ids, not a
   *  count, per the no-second-source law above (`.length` at the consumer).
   *  The same rolling-deploy decoding default as `finishedIds`. */
  workingIds: Schema.Array(TerminalIdSchema).pipe(
    Schema.withDecodingDefaultKey(Effect.sync(() => [])),
  ),
  /** The ids of the terminals whose agent ended its turn but has NOT yet gone
   *  effectively quiet (`waiting` ∧ ¬EF2) — the lingering tail an agent leaves
   *  while its last output is still landing. Carried because ACTIVITY, not
   *  `working`, is what every attention surface actually means: the pip keeps
   *  MOVING through this window (`attentionActive`'s `linger` leg), so a host tab that
   *  counted only `workingIds` would show nothing beside a terminal visibly
   *  still going — the exact paint/count disagreement this cell exists to
   *  prevent. Disjoint from `finishedIds` by construction (a waiting agent is
   *  in exactly one of the two), so a consumer can add the lists without
   *  de-duplicating. The same rolling-deploy decoding default. */
  lingerIds: Schema.Array(TerminalIdSchema).pipe(
    Schema.withDecodingDefaultKey(Effect.sync(() => [])),
  ),
  /** Whether this frame is EVIDENCE. `false` while padi has not finished
   *  looking: before it adopts kaval's terminals, while it reads each adopted
   *  survivor's agent for the first time, and through a kaval recycle's drain.
   *  The lists of an unsettled frame are empty because nobody has looked, not
   *  because nothing is happening, so a reader keeps what it last knew rather
   *  than taking them as fact. `true` for every frame padi folded from a fleet
   *  it has seen.
   *
   *  Decodes to `true` when ABSENT: a 7.11 padi never says, and every frame it
   *  served reads as it always did. */
  settled: Schema.Boolean.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(true)),
  ),
});
export type PadiUrgency = typeof PadiUrgencySchema.Type;

/** Two urgency readings are equal when they carry the same ids in ALL FOUR
 *  lists, each in the same order, AND the same `settled` — the urgency cell's
 *  `equals`, so the ~150 ms agent firehose (the `terminals` collection's
 *  write-triggers, which the derived `urgency` cell recomputes off) can't
 *  re-publish an unchanged projection. Comparing every list is load-bearing: a
 *  frame where only the finished set changed must survive this ONE wire dedup
 *  point so the finish transition reaches `useAttention` and fires, and a
 *  working→linger move (the same terminal, a different list) must reach the
 *  host tab or its activity count freezes. `settled` is load-bearing the same
 *  way: an unsettled empty frame and a settled empty one carry the same lists,
 *  and a quiet host that finished looking must still say so. Every count is
 *  derived (`.length`), so comparing these five is already complete. Lives
 *  here beside the value schema (it is a property of the `PadiUrgency` VALUE)
 *  so the spec can declare it directly — the bridge's "equals lives at the
 *  member, once" law — without `surface.ts` reaching into the fold module. */
export function urgencyEqual(a: PadiUrgency, b: PadiUrgency): boolean {
  return (
    a.settled === b.settled &&
    sameIds(a.awaitingIds, b.awaitingIds) &&
    sameIds(a.finishedIds, b.finishedIds) &&
    sameIds(a.workingIds, b.workingIds) &&
    sameIds(a.lingerIds, b.lingerIds)
  );
}

/** Order-sensitive id-list equality — both attention lists carry ids in the
 *  map's insertion order, so a reorder is a real change worth publishing. */
function sameIds<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Create input — the BASE `CreateTerminalInputSchema` (client chrome) plus the
 *  REQUIRED `placement` and an optional `cwd`. It derives from the base DIRECTLY
 *  rather than subtracting the three
 *  server-derived authored facts, so the exclusion is structural, not a maintained
 *  omit list: a future field added to `RestoreOnlyMetadataSchema` can never leak to
 *  the wire by someone forgetting to extend an omit. A fresh terminal has no truth
 *  about `lastActivityAt` / `promptedAt` / `restoreTarget` (the fold derives
 *  them from its own observation); `session.restore` threads them from the saved blob
 *  through `restoreSpawn`'s distinct `restoreOnly` arm, never this input.
 *
 *  `placement` is the one REQUIRED key, and the only one on this input that is not
 *  chrome: it says whether the new terminal is a tile of its own or a split inside
 *  another ({@link TerminalPlacementSchema}). `annotateKey` puts the SAME sentence on
 *  the absent-key issue that the sum itself carries for a malformed one, so the two
 *  ways of not naming a placement — omit the key, or name a third arm — both answer
 *  with the rule and both spellings rather than Effect's bare "Missing key".
 *
 *  A `child-of` with no `parentId` deliberately does NOT get that sentence: it fails
 *  as a missing key at `["placement"]["parentId"]`, and that is the more useful
 *  answer. That caller HAS chosen an arm and knows the vocabulary — re-reciting the
 *  whole rule at them would bury the one thing they need, which is that the parent id
 *  is the field that went astray. Pinned as such in `createPlacement.test.ts`.
 *
 *  The refusal is therefore the SCHEMA's, not a handler guard: a create with no
 *  placement never reaches padi's registry, and no TypeScript caller can compile
 *  one. */
export const PadiCreateInputSchema = Schema.Struct({
  placement: TerminalPlacementSchema.pipe(
    Schema.annotateKey({ messageMissingKey: PLACEMENT_REQUIRED }),
  ),
  cwd: Schema.optionalKey(Schema.String),
  ...CreateTerminalInputSchema.fields,
});

/** `lifecycle.restart`'s answer — what padi DID, read off its record after the
 *  respawn, so a caller reports what happened, not what it hoped: the restarted
 *  terminal, the agents its new PTY got (absent when none), and whether the
 *  live agent's conversation was resumed on them. */
export const PadiRestartOutputSchema = Schema.Struct({
  ...TerminalInfoSchema.fields,
  agents: Schema.optionalKey(TerminalAgentsSchema),
  resumed: Schema.Boolean,
});

/** A bare terminal-id input — kill/sleep/wake/discardSleeping/screen.state. */
export const PadiTerminalIdInputSchema = Schema.Struct({
  id: TerminalIdSchema,
});

/** A whole positive count — the `z.number().int().positive()` of this wire.
 *  Named once so every grid dimension and bound is the SAME check rather than
 *  a re-derivation per member that can drift. */
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));

/** What a legal `screen.text` `tail` is — a whole count of lines, at least one.
 *  ONE spelling: the wire field below, the wait engine's guard (`./watch`) and
 *  the MCP faces that produce a tail all read it, so none can pass a tail padi
 *  refuses at the decode. */
export const ScreenTextTailSchema = PositiveInt;

/** A whole non-negative count/index — the `z.number().int().nonnegative()` of
 *  this wire (line cursors, scrollback extents).
 *
 *  Exported so a FACE can annotate it directly rather than re-spelling
 *  `integer ∧ ≥ 0` over the bound: since effect rc.111 a check's constraints
 *  and annotations compact onto the node they constrain, so
 *  `NonNegativeInt.annotate({description})` puts the blurb and the `minimum`
 *  on the property node an MCP host renders. */
export const NonNegativeInt = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
);

/** A terminal grid — cols AND rows, together or not at all. The ONE grid rule
 *  on this surface: every member carrying a grid reuses it, so tightening the
 *  rule is one edit instead of a re-derivation per member. */
export const EndpointGridSchema = Schema.Struct({
  cols: PositiveInt,
  rows: PositiveInt,
});

/** The whole vocabulary of an attach's `cause`, as a list so the one hop that
 *  reads it (kolu-server's attach telemetry) can walk the causes rather than
 *  test for one literal and silently fold every later addition into `attach`.
 *  The wire schema below is minted from it, so the two cannot drift. */
export const ATTACH_CAUSES = ["attach", "foreign"] as const;

/** Why an attach opened, as the client names it. */
export type AttachCause = (typeof ATTACH_CAUSES)[number];

/** Attach input: the terminal, plus — optionally — a grid to RESIZE it to
 *  first.
 *
 *  `resizeTo` is a command, not a description of the caller: the host runs its
 *  full resize before serializing (SIGWINCH to the child, a reflow of the
 *  shared mirror, and on a width change a reflow-epoch bump that stales every
 *  other attached client's backfill cursor). Attaching is a WRITE to shared
 *  state whenever it is present and differs from the terminal's current grid;
 *  the policy is last-attach-wins, and every other attached client is told the
 *  new size by a `resized` frame on its own stream. */
export const PadiTerminalAttachInputSchema = Schema.Struct({
  id: TerminalIdSchema,
  resizeTo: Schema.optionalKey(EndpointGridSchema),
  cause: Schema.optionalKey(Schema.Literals(ATTACH_CAUSES)),
});

/** One frame of the per-subscriber terminal byte stream.
 *
 *  A discriminated union, not a bare string and not an optional field: a
 *  `delta` is bytes to write; a `snapshot` (the first frame of any fresh
 *  stream, and every overflow re-attach) is a serialized screen that also
 *  carries the absolute mirror-line `topLine` seed for a scrollback-backfill
 *  cursor and the grid its bytes are laid out at; a `resized` says the pty's
 *  mirror changed size at this exact point between two bytes. Mirrors kaval's
 *  own `TerminalDataMsg` one hop up.
 *
 *  NAMED and exported because a consumer has to be able to say this type to
 *  write a frame handler at all. A `snapshot` and a `resized` both SET the
 *  consumer's terminal size, and a `resized` only means anything applied in the
 *  order it arrived in.
 */
export const PadiTerminalAttachFrameSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("delta"),
    data: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    data: Schema.String,
    topLine: NonNegativeInt,
    reflowEpoch: Schema.optional(NonNegativeInt),
    /** The cols×rows this snapshot was SERIALIZED at, read inside the same
     *  synchronous act as the bytes and the epoch so it cannot describe a
     *  reflow they never saw. The consumer sets its terminal to this grid and
     *  then paints. */
    grid: EndpointGridSchema,
  }),
  /** The pty's mirror CHANGED SIZE at this point in the stream.
   *
   *  A control frame carrying one fact and no bytes, and its POSITION is the
   *  fact: every byte before it was laid out for the old grid, every byte after
   *  it for the new one. A consumer that BUFFERS bytes applies it in the same
   *  buffer, in line. */
  Schema.Struct({
    kind: Schema.Literal("resized"),
    grid: EndpointGridSchema,
  }),
]);
export type TerminalAttachFrame = typeof PadiTerminalAttachFrameSchema.Type;

/** The grid an attach asks for, and the unit a snapshot is laid out at. */
export type EndpointGrid = typeof EndpointGridSchema.Type;

export const PadiResizeInputSchema = Schema.Struct({
  ...EndpointGridSchema.fields,
  id: TerminalIdSchema,
});

export const PadiSendInputSchema = Schema.Struct({
  id: TerminalIdSchema,
  data: Schema.String,
});

/** A settle edge on the wire — "this terminal just started needing someone".
 *
 *  THE one declaration of the shape: padi's own server-internal source aliases
 *  `PadiSettleEvent` rather than re-spelling the fields (`attention/settleEvents.ts`),
 *  so a reader tracing one event from emission to the MCP reply never changes
 *  vocabulary halfway through and the two halves cannot drift in a direction that
 *  still type-checks.
 *
 *  Thin on purpose: the recipient reads the terminal's screen itself, so it acts
 *  on CURRENT output rather than a copy that aged in the queue, and one delivery
 *  can't flood a supervisor's context with another agent's transcript. */
export const PadiSettleEventSchema = Schema.Struct({
  /** Monotonic per-daemon sequence — the cursor a standing subscription drains
   *  against, so "what have I not seen" is a number comparison and never a
   *  guess. */
  seq: PositiveInt,
  id: TerminalIdSchema,
  /** `asking` — the agent is blocked on a person (`awaiting_user`), reported
   *  immediately and UNGATED by the quiet window, because an agent that says it
   *  is blocked is definitionally not mid-output. `finished` — its turn ended AND
   *  its output then went quiet for padi's effective-finish window; that
   *  conjunction is what keeps a background sub-agent's churn from reading as
   *  "done". `gone` — the terminal left (it exited, was killed, or its id was
   *  retired by a kaval recycle). It rides this SAME channel deliberately: a
   *  supervisor waiting on a worker that no longer exists must be TOLD, not left
   *  waiting for a settle that can never come — otherwise a scoped subscription
   *  simply goes quiet after a recycle, and silence reads exactly like a calm
   *  workspace. */
  kind: Schema.Literals(["asking", "finished", "gone"]),
  /** ms epoch, stamped once per observed FRAME (not per event), so every edge one
   *  fold produced describes the same instant. */
  at: PositiveInt,
  /** Who spawned this terminal — lane attribution for the subscriber. Absent for a
   *  root terminal (nobody spawned it). For a DEPARTURE it is the edge REMEMBERED
   *  from the last frame that still had one, because by then there is no record to
   *  read. */
  parentId: Schema.optionalKey(TerminalIdSchema),
  /** The terminal's freeform intent annotation, when set — the one piece of "what
   *  was this lane doing" a recipient can't cheaply re-derive. */
  intent: Schema.optionalKey(Schema.String),
});
export type PadiSettleEvent = typeof PadiSettleEventSchema.Type;

/** The agent buckets a state watch may target — padi's own {@link WAIT_STATES}
 *  (the `agentBucket` fold's vocabulary minus `other`, which no real agent
 *  reaches), so this wire and `kolu wait --until` speak one word list rather
 *  than two that agree by luck. */
const WatchStateSchema = Schema.Literals(WAIT_STATES);

/** What a subscription that names NO states means — re-exported from the
 *  vocabulary leaf, where it sits beside the buckets it is drawn from and where
 *  a face's `--help` can read it without importing the wire. */
export { WATCH_DEFAULT_STATES };

/** The `nagMs` NUMERIC rule — the interval spelled as bare milliseconds,
 *  exported beside the fields table that spreads it, so the MCP face's
 *  `Number|String` union binds the same numeric arm rather than restating its
 *  three checks (a bound change then edits ONE schema, not two).
 *
 *  Zero is NOT a legal interval — a nag every 0 ms is a spin, so the schema
 *  refuses it rather than a guard downstream. */
export const PadiWatchNagMsSchema = Schema.Number.annotate({
  description:
    "RE-report a terminal every this many milliseconds for as long as it keeps holding a matching state (milliseconds). Omit to be told once. This is what makes an ignored terminal come back instead of vanishing after one line.",
}).check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(MAX_TIMER_MS),
);

/** The supervision knobs, declared ONCE and spread into both faces' inputs, so
 *  a CLI flag and an MCP param cannot mean different things.
 *
 *  Every field carries a blurb because these fields reach MCP verbatim:
 *  `kolu-mcp`'s bespoke `watch_open` tool SPREADS them rather than re-declaring
 *  them, so these annotations are the only description an agent ever sees. */
export const PadiWatchFilterFields = {
  states: Schema.optionalKey(
    Schema.Array(WatchStateSchema)
      .annotate({
        description: `Agent states to report, any-of: ${WAIT_STATES.join(", ")}. Omit for the default ${WATCH_DEFAULT_STATES.join(",")} — the two that need a person. These are the agent's OWN reported state, not a guess from its output.`,
      })
      .check(Schema.isNonEmpty()),
  ),
  heldForMs: Schema.optionalKey(
    Schema.Number.annotate({
      description:
        "Report a terminal only once it has HELD that state this long (milliseconds). Omit (or 0) to report the instant it enters. This is the debounce: an agent that ends its turn and is handed more work inside the window is never reported at all.",
    }).check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(MAX_TIMER_MS),
    ),
  ),
  nagMs: Schema.optionalKey(PadiWatchNagMsSchema),
  nagCount: Schema.optionalKey(
    Schema.Number.annotate({
      description:
        "CAP the nagging: after the first report of a held state, re-report at most this many more times at the nagMs interval, then go quiet about that terminal. A state change re-arms it — a terminal that resumes and stops again is a new event with its own first report and its own count. Omit to nag forever. Never spelled alone: the faces carry it INSIDE the interval (`--nag 30m/3`), and the wire decode refuses it without nagMs — a cap on a repetition that never starts is nothing.",
    }).check(Schema.isInt(), Schema.isGreaterThan(0)),
  ),
} as const;

/** Terminals to MUTE — the fail-open complement of `ids`. Declared ONCE and
 *  spread into both faces, so a CLI `--ignore` and an MCP `ignoreIds` cannot
 *  mean different things. Not a supervision knob: naming only this does not
 *  switch the feed. An empty list is the identity (mute nobody), so unlike
 *  `ids` it is not refused when empty. */
export const PadiWatchIgnoreFields = {
  ignoreIds: Schema.optionalKey(
    Schema.Array(TerminalIdSchema).annotate({
      description:
        "Terminals to mute. Fail-open: a stale or unknown id costs nothing, and every NEW terminal is still watched. Contrast `ids`, which fails closed — a list you forget to update goes blind to a lane nobody added.",
    }),
  ),
} as const;

/** Why a subscriber is being told about a terminal — the three kinds, as an
 *  ARRAY beside the schema that spells them.
 *
 *  A literal union is unenumerable at runtime, so a face that lays the feed out
 *  in columns had to measure a hand-picked exemplar string and hope it stayed
 *  the longest. Enumerated here, the widest kind is derived, and a fourth kind
 *  added to this line reaches every reader that asks. */
export const WATCH_STATE_EVENT_KINDS = [
  "snapshot",
  "transition",
  "nag",
] as const;

/** One agent-state event on the wire.
 *
 *  Thin for the same reason {@link PadiSettleEventSchema} is: the recipient reads
 *  the terminal's screen itself, so it acts on CURRENT output rather than a copy
 *  that aged in a queue. What it adds over a settle event is the LEVEL it is
 *  reporting — which state, and since when — because "waiting for 40 minutes"
 *  and "waiting for 3 seconds" are different facts and a consumer must not have
 *  to subtract two events to tell them apart. */
export const PadiStateEventSchema = Schema.Struct({
  /** Monotonic per-daemon sequence, shared with {@link PadiSettleEventSchema} —
   *  one counter behind one queue, so a subscription's acknowledgement means the
   *  same thing whichever source filled it. */
  seq: PositiveInt,
  id: TerminalIdSchema,
  /** `snapshot` — this terminal was ALREADY matching when you (re)opened, and
   *  is reported first so a late joiner sees standing neglect instead of only
   *  future changes. `transition` — it entered a matching state and has now held
   *  it for `heldForMs`. `nag` — it is STILL holding, `nagMs` after the last
   *  time you were told. A consumer that treats all three alike is correct; the
   *  discriminator is there so one that wants to ring a bell only on `transition`
   *  can. */
  kind: Schema.Literals(WATCH_STATE_EVENT_KINDS),
  /** The bucket it is holding. */
  state: WatchStateSchema,
  /** ms epoch — when THIS daemon first observed it enter `state`. Subtract from
   *  `at` for how long it has held. It is a daemon-lifetime observation, so a
   *  padi restart re-dates every terminal's hold; the first snapshot after a
   *  restart is therefore the honest one to reconcile against. */
  since: PositiveInt,
  /** ms epoch, stamped once per emitted BATCH so every event in one frame
   *  describes the same instant. */
  at: PositiveInt,
  /** The reminder accounting — present on `kind: "nag"` events ONLY: which
   *  reminder this is, and how many follow when the subscription caps the nag.
   *  `left: 0` is the last one. On an UNCAPPED subscription `left` is absent —
   *  the sequence has no end to name. A consumer can tell the final reminder
   *  from the others without knowing the subscription's flags. */
  nag: Schema.optionalKey(
    Schema.Struct({
      /** Which reminder this is — 1 is the first re-report after the first
       *  report. */
      index: PositiveInt,
      /** How many reminders follow this one — 0 on the last. Absent when the
       *  subscription caps nothing (a bare `nagMs` repeats forever). */
      left: Schema.optionalKey(NonNegativeInt),
    }),
  ),
  /** Who spawned this terminal — lane attribution. Absent for a root terminal. */
  parentId: Schema.optionalKey(TerminalIdSchema),
  /** The terminal's freeform intent annotation, when set. */
  intent: Schema.optionalKey(Schema.String),
});
export type PadiStateEvent = typeof PadiStateEventSchema.Type;

/** Everything a standing subscription can hand over. ONE queue, discriminated by
 *  `kind`: a subscription is fed by exactly one source (the settle detector, or
 *  the state watch when it named any of the knobs), and the six `kind`
 *  literals are disjoint, so a consumer branches on that one field and never has
 *  to ask which source it opened. */
export const PadiWatchEventSchema = Schema.Union([
  PadiSettleEventSchema,
  PadiStateEventSchema,
]);
export type PadiWatchEvent = typeof PadiWatchEventSchema.Type;

/** The cap on a subscription name. */
export const WATCH_NAME_MAX_LENGTH = 128;

/** A subscription NAME — caller-chosen and stable across restarts, which is the
 *  point: re-opening the same name after the agent, the MCP process, or kaval
 *  restarted reattaches to the same queue instead of minting an empty one.
 *
 *  Exported as the CHECKED SCHEMA, which is what a face should reuse. It used
 *  to be private, with only {@link WATCH_NAME_MAX_LENGTH} exported, because an
 *  MCP arg schema had to annotate before it checked — up to effect rc.110 an
 *  annotation on a checked schema landed inside an `allOf` branch no host
 *  reads. rc.111 compacts a check onto the node it constrains, so
 *  `WatchNameSchema.annotate({description})` now emits the blurb, the
 *  `minLength` and the `maxLength` together on the property node. Reusing this
 *  object is the spelling; re-deriving `string ∧ ≥1 ∧ ≤MAX` per face is how
 *  one decision became several. */
export const WatchNameSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(WATCH_NAME_MAX_LENGTH),
);

/** The knob set itself, as data — DERIVED from the one declaration above so a
 *  knob is spelled once. Every "did the caller name a knob" question in the
 *  daemon and at both faces is asked of this (`namesWatchKnobs`), rather than
 *  by re-listing the fields at each site and hoping every site is found
 *  again. */
export const WATCH_FILTER_KEYS = Object.keys(
  PadiWatchFilterFields,
) as readonly (keyof typeof PadiWatchFilterFields)[];

export const PadiWatchOpenInputSchema = Schema.Struct({
  name: WatchNameSchema.annotate({
    description:
      "A name YOU choose for this subscription. Reuse the SAME name across restarts — re-opening an existing name reattaches to its queue with your place kept, instead of minting an empty one.",
  }),
  /** Terminals to watch. OMIT to watch every terminal on the host — the
   *  restart-proof choice, since it names no id that a respawn could invalidate.
   *  An empty array is REFUSED at the SCHEMA rather than treated as "all": a
   *  subscription that can never match would look identical to a quiet workspace,
   *  so the wire makes it unspellable instead of leaving it to a runtime guard. */
  ids: Schema.optionalKey(
    Schema.Array(TerminalIdSchema)
      .annotate({
        description:
          "Terminals to watch. OMIT to watch the WHOLE fleet — the restart-proof choice, and the one that cannot go blind to a lane nobody remembered to add.",
      })
      .check(Schema.isNonEmpty()),
  ),
  ...PadiWatchFilterFields,
  ...PadiWatchIgnoreFields,
});
export type PadiWatchOpenInput = typeof PadiWatchOpenInputSchema.Type;

export const PadiWatchOpenOutputSchema = Schema.Struct({
  name: Schema.String,
  /** The highest `seq` this subscription has already ACKNOWLEDGED — the daemon's
   *  current sequence for a fresh one (so it reports what happens NEXT rather
   *  than replaying history the supervisor already acted on), and the PRESERVED
   *  watermark for a re-attach (so a supervisor can see that its place really was
   *  kept). Informational: the value you echo back as a drain's `after` is the
   *  DRAIN's `ackAfter`, never this one. */
  acknowledged: NonNegativeInt,
  /** True when this name already existed and its buffer was preserved. */
  reattached: Schema.Boolean,
});

export const PadiWatchNameInputSchema = Schema.Struct({
  name: WatchNameSchema,
});

/** `watch.drain` input — the name plus the ACKNOWLEDGEMENT. */
export const PadiWatchDrainInputSchema = Schema.Struct({
  name: WatchNameSchema,
  /** The highest `seq` you have actually PROCESSED. Everything at or below it is
   *  forgotten; everything above stays queued and is handed over again. Omit on
   *  a first call. This is what makes a drain safe to lose: a reply that never
   *  reached you was never acknowledged, so the next call still carries it. */
  after: Schema.optionalKey(NonNegativeInt),
});

export const PadiWatchDrainOutputSchema = Schema.Struct({
  events: Schema.Array(PadiWatchEventSchema),
  /** Events lost to buffer overflow before this drain. NONZERO means the delta is
   *  incomplete and the caller should reconcile against the `terminals`
   *  collection — reported rather than silently truncated, because a silent
   *  truncation reads exactly like a quiet workspace. */
  dropped: NonNegativeInt,
  /** Send this back VERBATIM as the next drain's `after` — the name says where
   *  it goes, so no doc has to teach the mapping. It is the high-water mark of
   *  this batch, or the standing watermark when the batch is empty (echoing that
   *  back is then a no-op). Until you do, these events stay queued — so a reply
   *  lost in flight costs a repeat rather than an event. */
  ackAfter: NonNegativeInt,
});

/** `watchStates` — the LIVE agent-state feed, for a face that holds a socket
 *  open rather than a buffered queue (`kolu watch`).
 *
 *  The same knobs as a standing subscription, plus the CLI's one optional
 *  id. Deliberately `id` and not `ids`: supervision must never be scoped by
 *  enumeration — a watcher narrowed to two repos went blind to a third — so the
 *  fleet is the default and the single id is a debugging tail, never a list to
 *  keep in sync. (A buffered orchestrator that genuinely holds a roster still has
 *  `watch.open`'s `ids`.) */
export const PadiWatchStatesInputSchema = Schema.Struct({
  ...PadiWatchFilterFields,
  ...PadiWatchIgnoreFields,
  id: Schema.optionalKey(TerminalIdSchema),
});
export type PadiWatchStatesInput = typeof PadiWatchStatesInputSchema.Type;

/** The doorbell frame — no event data, just a distinguisher, exactly like
 *  `subscribeRepoChange`. The caller requeries with `watch.drain`. */
export const PadiWatchPulseSchema = Schema.Struct({
  seq: NonNegativeInt,
});

export const PadiSetThemeInputSchema = Schema.Struct({
  id: TerminalIdSchema,
  themeName: Schema.String.check(Schema.isMinLength(1)),
});

export const PadiSetIntentInputSchema = Schema.Struct({
  id: TerminalIdSchema,
  /** Empty string clears the intent; any non-empty string sets it. */
  intent: Schema.String,
});

export const PadiSetParentInputSchema = Schema.Struct({
  id: TerminalIdSchema,
  parentId: Schema.NullOr(TerminalIdSchema),
});

export const PadiSetActiveInputSchema = Schema.Struct({
  id: Schema.NullOr(TerminalIdSchema),
});

export const PadiSetCanvasLayoutInputSchema = Schema.Struct({
  id: TerminalIdSchema,
  layout: CanvasLayoutSchema,
});

export const PadiSetSubPanelInputSchema = Schema.Struct({
  id: TerminalIdSchema,
  collapsed: Schema.Boolean,
  panelSize: Schema.Number,
});

export const PadiSetRightPanelInputSchema = Schema.Struct({
  ...RightPanelPerTerminalStateSchema.fields,
  id: TerminalIdSchema,
});

/** `screen.text` — the terminal's rendered buffer as plain text.
 *
 *  Two ways to bound it, and never both: an absolute `startLine`/`endLine`
 *  window, or `tail` — the last N lines, with the blank viewport below the
 *  cursor dropped first (`tailLines`, `./screenTail`, is the definition, and
 *  padi applies it before replying, so only the tail crosses the wire). A
 *  `tail` beside either line bound is REFUSED at the decode rather than
 *  resolved by a precedence: a caller that named both asked two questions,
 *  and answering one of them silently is answering the wrong one. Omit all
 *  three for the whole scrollback. */
export const PadiScreenTextInputSchema = Schema.Struct({
  id: TerminalIdSchema,
  /** First line to capture (0-based, inclusive). Defaults to start of scrollback. */
  startLine: Schema.optionalKey(NonNegativeInt),
  /** Last line to capture (exclusive). Defaults to buffer length. */
  endLine: Schema.optionalKey(NonNegativeInt),
  /** The last N rendered lines, trailing blank rows dropped first. */
  tail: Schema.optionalKey(ScreenTextTailSchema),
}).check(
  Schema.makeFilter((input) =>
    input.tail !== undefined &&
    (input.startLine !== undefined || input.endLine !== undefined)
      ? "screen.text: `tail` cannot be combined with `startLine`/`endLine` — ask for one bound"
      : undefined,
  ),
);

/** The most rows one `screen.image` will ever render.
 *
 *  A hard ceiling, not a default. An explicit `lines` above the cap is
 *  REJECTED at the wire; a `viewport` capture of a taller terminal is TRIMMED
 *  to the last {@link SCREEN_IMAGE_MAX_ROWS} rows, and the reply's own `rows`
 *  says how much was captured. Rows only: the width of a capture is bounded
 *  where the cells are read, by kaval's area cap, and the reply's `cols` states
 *  it. */
export const SCREEN_IMAGE_MAX_ROWS = 200;

/** What a legal `lines` is: a whole count of rows, at least one, at most
 *  {@link SCREEN_IMAGE_MAX_ROWS}.
 *
 *  ONE spelling, reused by every face. This was a bare CHECK ARRAY plus a
 *  module-private schema built from it, because an MCP face had to spread the
 *  checks onto its own annotated base — up to effect rc.110 an annotation on
 *  an already-checked schema landed in an `allOf` branch no host reads. rc.111
 *  compacts a check onto the node it constrains, so
 *  `ScreenImageLinesSchema.annotate({description})` emits the blurb,
 *  `exclusiveMinimum` and `maximum` together on the property node, and the
 *  array-plus-schema pair collapses back to the schema. */
export const ScreenImageLinesSchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(SCREEN_IMAGE_MAX_ROWS),
);

/** The same rule for a face that parses FLAGS rather than schemas — the CLI's
 *  `Flag.filter` cannot speak Effect Schema, and must not therefore hold a
 *  second opinion about what a legal row count is. */
export const isScreenImageLines = (n: number): boolean =>
  Number.isInteger(n) && n > 0 && n <= SCREEN_IMAGE_MAX_ROWS;

/** `screen.image` — the terminal as a picture.
 *
 *  `lines` bounds the capture to the last N rendered rows; OMIT it for the
 *  viewport (the live grid's own height — what the terminal is showing right
 *  now, and the read a driving agent almost always wants). There is
 *  deliberately no whole-scrollback arm: see {@link SCREEN_IMAGE_MAX_ROWS}. */
export const PadiScreenImageInputSchema = Schema.Struct({
  id: TerminalIdSchema,
  lines: Schema.optionalKey(ScreenImageLinesSchema),
});

/** What `screen.image` returns: the PNG as base64, with the grid it was
 *  rendered from.
 *
 *  `mimeType` is spelled rather than assumed because this value is handed
 *  straight to an MCP host as image content, which requires one — and a
 *  hardcoded string at the far end would be a second place for the format to
 *  be declared. `cols`/`rows` ride along so a caller can report what it
 *  captured without decoding the image to find out. */
export const PadiScreenImageOutputSchema = Schema.Struct({
  mimeType: Schema.Literal("image/png"),
  /** Base64-encoded PNG bytes. */
  data: Schema.String,
  cols: NonNegativeInt,
  rows: NonNegativeInt,
});

/** The decoded reply, derived from the schema rather than re-declared beside
 *  it — the convention this surface follows everywhere else. Both readers (the
 *  renderer that produces it and the MCP face that renders it) name THIS, so a
 *  field renamed in the schema is a type error rather than a runtime hole. */
export type PadiScreenImageOutput = typeof PadiScreenImageOutputSchema.Type;

/** `screen.history` — the client's scrollback-backfill read. `before` is the
 *  caller's absolute mirror-line cursor (the attach snapshot's `topLine`, then
 *  each reply's `topLine`); the host serves up to `max` older rows above it. */
export const PadiScreenHistoryInputSchema = Schema.Struct({
  id: TerminalIdSchema,
  before: Schema.optionalKey(NonNegativeInt),
  max: PositiveInt,
  epoch: Schema.optionalKey(NonNegativeInt),
});

/** What `screen.history` returns — mirrors kaval's `getHistory` output as a
 *  `chunk | stale` DISCRIMINATED UNION (invalid-states-unrepresentable; like this
 *  surface's own attach `snapshot|delta` frame). The `chunk` arm is VT bytes
 *  replayed at the live width with the next `topLine` cursor and an `exhausted`
 *  flag; the `stale` arm (reachable only when the caller sent `epoch`) says the
 *  mirror reflowed and the caller must HALT until re-seed (F3). */
export const PadiScreenHistoryOutputSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("chunk"),
    chunk: Schema.String,
    topLine: NonNegativeInt,
    exhausted: Schema.Boolean,
  }),
  Schema.Struct({ kind: Schema.Literal("stale") }),
]);

/** `scratch.write` — write base64 bytes into a terminal's on-disk scratch dir
 *  (the write half the paste/upload procedures build on). Returns the on-disk
 *  path so the caller can bracketed-paste it into the PTY.
 *
 *  CHUNKED. A whole file used to ride one call, which made the request frame
 *  scale with the dropped file: a 26 MB drop became a ~35 MB frame, and the
 *  ndjson decoder answers an oversized frame by CLOSING THE SOCKET (1009),
 *  taking every other subscription on that tab's multiplexed wire with it. So
 *  the file arrives as a sequence of `FRAME_CHUNK_BYTES`-bounded calls: the
 *  first omits `appendTo` and creates the file, each subsequent one passes back
 *  the path it was given and appends. No single frame scales with user data. */
export const PadiScratchWriteInputSchema = Schema.Struct({
  terminalId: TerminalIdSchema,
  /** Filename as dropped; sanitized to its safe basename before writing. */
  name: Schema.String.check(Schema.isMinLength(1)),
  /** Base64-encoded file bytes — ONE CHUNK, not necessarily the whole file.
   *  Chunk boundaries are 4-character-aligned so each chunk decodes on its own
   *  (see `chunkBase64`). */
  data: Schema.String,
  /** Absent on the FIRST chunk: create a fresh (collision-suffixed) file.
   *  Present on every subsequent chunk: the path the first call returned,
   *  appended to. The server re-derives the terminal's scratch dir and REFUSES
   *  a path outside it, so this carries no authority the caller did not already
   *  have — it is a continuation token that happens to be readable. */
  appendTo: Schema.optionalKey(Schema.String),
});
export const PadiScratchWriteOutputSchema = Schema.Struct({
  /** The on-disk path the bytes landed at, inside the terminal's scratch dir. */
  path: Schema.String,
});

/** `preview.read` — SERVE-DIR-SHAPED byte read for the iframe binary preview,
 *  RANGE-CAPABLE from 1.0. A whole-file-blob-only shape (`{contentBase64}`)
 *  would bake a large-file regression into the contract: no `<video>` seek, and
 *  a multi-GB file forced whole through the heap. So the shape mirrors
 *  `@kolu/serve-dir`'s `ServeResult` — `{status, headers}` verbatim, the
 *  streamed body base64-encoded (`bodyBase64`) so it rides the procedure wire —
 *  with the raw HTTP `range` header moved onto the input. The client
 *  reconstitutes a `Response(atob(bodyBase64), {status, headers})`, so a 206
 *  slice / 416 unsatisfiable / 200 full read behave exactly as the retired raw
 *  `@kolu/serve-dir` HTTP bypass did. The `..`/`%2f`/symlink 403 guards are
 *  re-enforced at the backing (W1.R). */
export const PadiPreviewReadInputSchema = Schema.Struct({
  repoPath: Schema.String,
  filePath: Schema.String,
  /** Raw HTTP `Range` header value (e.g. `"bytes=0-1023"`); omitted = whole
   *  file. Parsed exactly as `@kolu/serve-dir`'s `parseByteRange`, so a
   *  satisfiable single range answers 206, an unsatisfiable one 416, and a
   *  multi-range / malformed header collapses to a full 200. */
  range: Schema.optionalKey(Schema.String),
});
/** `preview.repoRootForTerminal` — resolve a TERMINAL's git repo root from padi's
 *  OWN in-process registry (`snapshotFor(id)?.git?.repoRoot`), the single source of
 *  truth for that mapping. The re-serving binder (kolu-server's iframe preview
 *  route) calls this to turn the URL's terminal id into a repo path, then reads the
 *  bytes by binding: a LOCAL bind streams the file off THIS disk via the shared
 *  `previewFile` (bounded heap for large videos); a REMOTE bind (`KOLU_PADI_HOST`)
 *  dials `preview.read` in bounded chunks and reassembles them — either way never
 *  forced whole through a base64 procedure. So the mapping stays in padi while the
 *  byte read stays a bounded stream. Null when the terminal is unknown or has no
 *  git repo. */
export const PadiRepoRootForTerminalInputSchema = Schema.Struct({
  terminalId: TerminalIdSchema,
});
export const PadiRepoRootForTerminalOutputSchema = Schema.Struct({
  /** The terminal's git repo root, or `null` when it has none / is unknown. */
  repoRoot: Schema.NullOr(Schema.String),
});

export const PadiPreviewReadOutputSchema = Schema.Struct({
  /** HTTP status — `200` | `206` (ranged) | `400` | `403` | `404` | `416` |
   *  `500`, verbatim from `serveFile`. */
  status: Schema.Int,
  /** Response headers verbatim from serve-dir (`Content-Type`, `Accept-Ranges`,
   *  `X-Content-Type-Options`, `Cache-Control`, a strong `ETag` on every 200/206,
   *  and `Content-Range` on a 206/416). The client replays them onto the
   *  reconstructed `Response`; the re-serving preview arm reads the `ETag` back to
   *  pin the file snapshot across a multi-chunk reassembly. */
  headers: Schema.Record(Schema.String, Schema.String),
  /** Base64-encoded response body — the (possibly ranged) file bytes on a
   *  200/206, the plain-text reason on a 400/403/404/416/500. */
  bodyBase64: Schema.String,
});

/** `session.restore` — restore the persisted session server-side (padi's boot
 *  reconcile + restore, replacing the client respawn loop in W1.R).
 *
 *  The wire carries INTENT, not a client-built id list: the host owns the
 *  resumable set (stamped on the saved session as `resumableIds`) and the client
 *  may only subtract from it (opt-outs). Resume yes/no + opt-outs of the
 *  host-served set — never a client-filtered membership list. */
export const PadiSessionRestoreInputSchema = Schema.Struct({
  /** When true, resume every host-resumable agent except those in `optOutIds`.
   *  Default true so import / bare restore resume all. KEY-level decoding
   *  default (PLAN #17): an omitted key means "resume all"; a caller that
   *  builds this input in-process must OMIT the key rather than pass
   *  `undefined`, which is rejected. */
  resumeAgents: Schema.Boolean.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(true)),
  ),
  /** Subset of the host-served resumable set the user opted out of. */
  optOutIds: Schema.optionalKey(Schema.Array(Schema.String)),
});

/** `session.restore`'s ANSWER — the active-terminal marker as of the end of the
 *  restore (the saved marker mapped onto the freshly-spawned ids), or `null` when
 *  the host holds none.
 *
 *  The client seeds its active tile from THIS, not from the `session` cell's next
 *  snapshot. The two are not interchangeable: the restored terminals publish as
 *  they spawn, while the cell's snapshot publishes only after `saveSession` has
 *  been through padi's Conf — a synchronous DISK write — so on a loaded box the
 *  client sees the full restored set while still holding the blob it CONSUMED,
 *  whose `activeTerminalId` names pre-restore ids that no longer exist. Riding the
 *  call makes the ordering structural: the answer cannot arrive after the
 *  terminals it describes. The id is still only a MARKER — it can name a terminal
 *  whose respawn failed and re-parked — so the client re-validates membership
 *  before seeding, exactly as it does for the persisted marker. */
export const PadiSessionRestoreOutputSchema = Schema.Struct({
  activeTerminalId: Schema.NullOr(Schema.String),
});

/** `session.import` — replace the persisted session with an imported blob (the
 *  diagnostic "Import session" flow, moved host-side), then restore it. */
export const PadiSessionImportInputSchema = Schema.Struct({
  session: SavedSessionSchema,
  /** Same intent shape as {@link PadiSessionRestoreInputSchema}. */
  resumeAgents: Schema.Boolean.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(true)),
  ),
  optOutIds: Schema.optionalKey(Schema.Array(Schema.String)),
});

/** One snapshot in padi's state-backup ring (#1658), with the summary the
 *  restore dialog ranks by — after a corruption incident the NEWEST snapshots
 *  are often the corrupt ones, so "14 terminals" vs `empty` is how a user spots
 *  the good one. `summary` is a union, not a nullable count: "the snapshot
 *  holds no session" and "the snapshot did not parse" are different facts, and
 *  flattening them to one `null` would hide exactly the distinction the dialog
 *  exists to show. */
export const PadiStateBackupSchema = Schema.Struct({
  /** Bare file name under the ring dir — the stable handle `backups.restore`
   *  names. */
  file: Schema.String,
  /** Snapshot mtime in epoch ms ON PADI'S OWN CLOCK — a consumer on another
   *  host reprojects through that entry's `clock.toLocal` before rendering a
   *  relative time (the `PadiIdentity.startedAt` discipline). */
  savedAtMs: Schema.Number,
  sizeBytes: Schema.Int,
  summary: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("session"),
      terminals: Schema.Int,
    }),
    /** The snapshot parsed but holds no session (fresh install / cleared). */
    Schema.Struct({ kind: Schema.Literal("empty") }),
    /** The snapshot's JSON did not parse — listed honestly, refused on restore. */
    Schema.Struct({ kind: Schema.Literal("unreadable") }),
  ]),
});
export type PadiStateBackup = typeof PadiStateBackupSchema.Type;

/** `backups.list` — enumerate the state-backup ring, newest first. */
export const PadiBackupsListOutputSchema = Schema.Struct({
  backups: Schema.Array(PadiStateBackupSchema),
});

/** `backups.restore` — restore the SESSION held by one ring snapshot, riding
 *  the same host-side machinery as `session.import` (backfill → decode →
 *  respawn), with the same host-owned resume intent. The current state file is
 *  pushed into the ring first, so a restore is itself undoable. */
export const PadiBackupsRestoreInputSchema = Schema.Struct({
  file: Schema.String,
  ...PadiSessionRestoreInputSchema.fields,
});

export const padiSurface = defineSurfaceWithPolicy<ClientErrorPolicy>()({
  cells: {
    /** padi's self-declared surface contract version (1.0). */
    version: { schema: PadiVersionSchema, default: DEFAULT_PADI_VERSION },
    /** padi's own honest identity — build commit / surfaceVersion / boot time, PER
     *  HOST (see {@link PadiIdentitySchema}). Read-only on the client; padi seeds it
     *  ONCE at boot, from the same source constants the control-core `hello` reads
     *  (never re-derived), so this and `hello` can't drift. */
    identity: {
      schema: PadiIdentitySchema,
      default: DEFAULT_PADI_IDENTITY,
      verbs: ["get"],
      client: { onError: { kind: "toast", label: "Padi identity" } },
    },
    /** Whether the `terminals` collection is EVIDENCE yet — `settling` until
     *  this padi has finished adopting (boot: the kaval endpoint up and the
     *  saved session reconciled; a recycle: the fresh kaval connected and the
     *  captured session re-parked), `established` after, with the epoch.
     *  Read-only on the client; padi's own roster gate
     *  (`attention/fleetGate.ts`) is the sole writer, and it is the SAME fact
     *  the attention folds gate their serve-time empty seed on, so the wire and
     *  padi's own consumers cannot hold two opinions. Every reader of an
     *  ABSENCE goes through it. */
    roster: {
      schema: PadiRosterSchema,
      default: DEFAULT_PADI_ROSTER,
      verbs: ["get"],
      client: { onError: { kind: "hostToast", label: "Terminal roster" } },
    },
    /** The recency-free urgency projection — read-only on the client; a DERIVED
     *  member (dual-edged on terminals + finish-quiet generation in
     *  `servePadi.ts`), so the graph is its one writer: it recomputes whenever the
     *  `terminals` collection it reads changes OR the multi-second quiet timer
     *  expires, and `equals` is the ONE wire dedup point (declared here at the
     *  member, per the reactive bridge's law). `finishedIds` is effective quiet
     *  (waiting ∧ !finishTracker.isLive), not raw waiting. */
    urgency: {
      schema: PadiUrgencySchema,
      default: {
        awaitingIds: [],
        finishedIds: [],
        workingIds: [],
        lingerIds: [],
        settled: false,
      } satisfies PadiUrgency,
      equals: urgencyEqual,
      verbs: ["get"],
      client: { onError: { kind: "hostToast", label: "urgency" } },
    },
    /** Host-side build-currency facts — today the `expectedKaval` axis (the kaval
     *  this padi would spawn). Read-only on the client; padi seeds it once at boot
     *  (a build constant). */
    status: {
      schema: PadiStatusSchema,
      default: DEFAULT_PADI_STATUS,
      verbs: ["get"],
      client: { onError: { kind: "toast", label: "Kaval status" } },
    },
    /** What theme a new terminal gets — WRITTEN by the binding kolu-server, READ
     *  by `lifecycle.create`. The value is always the RESOLVED policy, never the
     *  raw preferences (the `stateStore.ts` ruling: preferences never move here);
     *  padi holds it in memory only, because the binder re-derives and re-pushes
     *  on every bind. NOT a derived cell — the graph would be its one writer, and
     *  a derived cell carrying a write verb is a boot crash. NOT exposed through
     *  the MCP face either: an agent inherits the user's policy, it does not set
     *  it (denial by omission in kolu-mcp's expose map). */
    newTerminalPolicy: {
      schema: NewTerminalPolicySchema,
      default: DEFAULT_NEW_TERMINAL_POLICY,
      equals: newTerminalPolicyEqual,
      verbs: ["get", "set"],
      client: { onError: { kind: "toast", label: "New-terminal policy" } },
    },
    /** The Agents setting — WRITTEN by the binding kolu-server (the user's
     *  global preference, verbatim), READ by padi's spawn path: a terminal
     *  spawned while it is on gets agent-distro's harnesses on its PATH, and the
     *  setting's profiles — as kolu-server built and delivered them — as its
     *  `AI_PROFILE`. Memory-only for the reason `newTerminalPolicy` is (the
     *  binder re-pushes on every bind). NOT exposed through the MCP face: an
     *  agent inherits the user's choice, it does not make it. */
    agentDistro: {
      schema: AgentDistroSettingSchema,
      default: DEFAULT_AGENT_DISTRO_SETTING,
      equals: agentDistroSettingEqual,
      verbs: ["get", "set"],
      client: { onError: { kind: "toast", label: "Agents setting" } },
    },
    /** Whether the setting's set is on THIS padi's host — `ready` (with the
     *  package and the built profiles new terminals get), `downloading` (nothing serves yet;
     *  kolu-server is delivering it), `error` (the delivery failed, typed, in
     *  kolu-server's words), `off`, or `unavailable` (a padi built without
     *  agent-distro). Read-only on the
     *  client; padi's agent-distro module is the sole writer. The host tab and
     *  Settings render it. */
    agentDistroStatus: {
      schema: AgentDistroStatusSchema,
      default: DEFAULT_AGENT_DISTRO_STATUS,
      equals: agentDistroStatusEqual,
      verbs: ["get"],
      client: { onError: { kind: "hostToast", label: "Agents status" } },
    },
    /** What this host keeps of its agent deliveries — the serving package's
     *  versions and the profiles that landed with it, the last delivery and
     *  the last few history events, read off the files on the host. Read-only; published at boot,
     *  at every delivery report, and when the setting changes. A later delivery
     *  that fails shows here (and in the logs), never as an `error` status
     *  while a bundle serves: the agents still work. */
    agentDistroReceipt: {
      schema: AgentDistroReceiptSchema,
      default: EMPTY_AGENT_DISTRO_RECEIPT,
      equals: agentDistroReceiptEqual,
      verbs: ["get"],
      client: { onError: { kind: "hostToast", label: "Agents updates" } },
    },
    /** Every TCP listener on THIS padi's host — what the terminal-scoped `ports`
     *  on each record cannot see: a server that detached from the terminal that
     *  started it. Read-only on the client; padi's port sampler is the sole writer,
     *  from the same scan pass that feeds every terminal's `ports`. `unknown` until
     *  the first pass lands; padi's sampler arms on its first terminal and keeps
     *  reading the host after the last one closes. */
    hostListeners: {
      schema: HostListenersSchema,
      default: UNKNOWN_HOST_LISTENERS,
      equals: hostListenersEqual,
      verbs: ["get"],
      client: { onError: { kind: "toast", label: "Host listeners" } },
    },
    /** The running kaval + padi daemons on THIS padi's host — the "Running daemons"
     *  leak diagnostic the Kaval + Padi dialogs list. Read-only on the client; padi's
     *  periodic host-inventory sampler (`hostInventory.ts`, wired into daemon boot)
     *  is the sole writer. Rides the re-served surface, so the dialog's bound-host
     *  list works identically whether kolu-server is bound locally or over ssh. */
    hostInventory: {
      schema: PadiHostInventorySchema,
      arrayKey: "socket",
      default: DEFAULT_PADI_HOST_INVENTORY,
      verbs: ["get"],
      client: { onError: { kind: "toast", label: "Host inventory" } },
    },
    /** Live process-memory readout — padi's OWN RSS + its kaval daemon's, each the
     *  honest three-way {@link ProcessRssSchema}. One baked osfacts `--mem` snapshot
     *  reads both exact pids; padi's periodic sampler (wired into daemon boot) is the
     *  sole writer. Read-only on the client; kolu-server folds it into the rail's
     *  `processMemory` cell. */
    processMemory: {
      schema: PadiProcessMemorySchema,
      default: DEFAULT_PADI_PROCESS_MEMORY,
      verbs: ["get"],
      client: { onError: { kind: "toast", label: "Padi/kaval memory" } },
    },
    /** Server-derived activity feed (recent repos + recent agents) — the MRU the
     *  workspace switcher + command palette read. Read-only on the client; padi's
     *  `trackRecentRepo` / `trackRecentAgent` are the sole writers. The conf-store
     *  STORAGE is padi's OWN state-root Conf, set by padi's `daemonMain` at boot
     *  (`openPadiStateStores` → `setPadiActivityFeedStore`, see `confStores.ts`).
     *  `test__set` is the e2e-fixture reset verb. */
    activityFeed: {
      schema: ActivityFeedSchema,
      default: {
        recentRepos: [],
        recentAgents: [],
      } satisfies typeof ActivityFeedSchema.Type,
      verbs: ["get", "test__set"],
      client: {
        onError: {
          kind: "scopedSub",
          label: "Activity feed subscription error",
        },
      },
    },
    /** Last persisted snapshot of terminals + active id, or null when no session
     *  is saved — the restore card's source. Read-only on the client; padi's
     *  debounced autosave loop owns writes. The conf-store STORAGE is padi's OWN
     *  state-root Conf, set by padi's `daemonMain` at boot (`openPadiStateStores` →
     *  `setPadiSessionStore`, see `confStores.ts`). `test__set` is the e2e-fixture
     *  reset verb. */
    session: {
      schema: Schema.NullOr(SavedSessionSchema),
      arrayKey: "id",
      default: null as typeof SavedSessionSchema.Type | null,
      verbs: ["get", "test__set"],
      client: {
        onError: {
          kind: "scopedSub",
          label: "Saved-session subscription error",
        },
      },
    },
  },
  collections: {
    /** The composed terminal record — `authored ⋈ snapshot`, one writer, keyed
     *  by terminal id. Read-only on the client; padi's registry is the authority. */
    terminals: {
      keySchema: TerminalIdSchema,
      schema: PadiTerminalSchema,
      verbs: ["keys", "get"],
      client: { onError: { kind: "scopedSub", label: "Metadata error" } },
    },
    /** Per-host pty-host daemon (kaval) status — padi supervises its kaval, so
     *  the daemon-liveness cell is padi's to serve. Read-only on the client. */
    daemonStatus: {
      keySchema: Schema.String,
      schema: DaemonStatusSchema,
      verbs: ["keys", "get"],
      client: { onError: { kind: "hostToast", label: "daemon status" } },
    },
  },
  streams: {
    /** The set of terminals producing output RIGHT NOW — snapshot-then-deltas,
     *  each frame the full current live set. DELTA/fail-through: a mid-chain
     *  disconnect terminates the downstream stream so a fresh snapshot re-seeds. */
    activity: {
      inputSchema: Schema.Struct({}),
      outputSchema: Schema.Array(TerminalIdSchema),
    },
    /** The live agent-state feed — one BATCH of {@link PadiStateEventSchema} per
     *  frame. Snapshot-then-deltas by construction: the FIRST frame is the
     *  currently-matching set (possibly empty), every later frame is the
     *  transitions and nags that happened since. A re-subscribe therefore
     *  re-delivers a fresh snapshot, which is exactly what a late joiner — or a
     *  reconnecting one — needs to see standing neglect.
     *
     *  A BATCH and not a single event because a batch is the fold's own unit: one
     *  observation of the terminals collection produces N events that describe the
     *  same instant, and splitting them would ask a consumer to reconstitute a
     *  grouping the wire threw away. It also means "nothing is currently matching"
     *  is a frame the consumer receives (an empty first batch) rather than a
     *  silence it has to time out on. DELTA/fail-through: a replayed batch would
     *  be a re-report of an event the consumer already acted on. */
    watchStates: {
      inputSchema: PadiWatchStatesInputSchema,
      outputSchema: Schema.Array(PadiStateEventSchema),
    },
    /** The standing-subscription doorbell — pulses when the named subscription
     *  gains settle events. Value-bearing pulse-then-requery, the same shape as
     *  `subscribeRepoChange`: no event data rides the pulse, the caller requeries
     *  with `watch.drain`. Losing a pulse therefore costs a wait, never an event —
     *  the buffer behind `drain` is the authority. */
    watchPulse: {
      inputSchema: PadiWatchNameInputSchema,
      outputSchema: PadiWatchPulseSchema,
    },
    /** Live change-pulses for a repo's working tree + git dir. Value-bearing
     *  pulse-then-requery: a `{seq}` distinguisher, no fs/git data on the pulse. */
    subscribeRepoChange: {
      inputSchema: Schema.Struct({ repoPath: Schema.String }),
      outputSchema: RepoChangePulseSchema,
    },
    /** Live change-pulses narrowed to one file. Value-bearing pulse-then-requery. */
    subscribeFileChange: {
      inputSchema: FsFileInputSchema,
      outputSchema: RepoChangePulseSchema,
    },
    /** THE PULL REQUEST OF A BRANCH, as this host reads it — the forge reading
     *  for `branch` in the repository at `repoPath`, snapshot-then-changes: the
     *  first frame is the reading as it stands, every later frame is a reading
     *  that CHANGED (a check that went green, a merge, a close).
     *
     *  The same value a terminal's record carries in its `pr` field, from the
     *  same watcher (`anyforge`'s `subscribePr` over the host's forge dispatch,
     *  30 s), because it is the same question — only asked about the branch
     *  rather than about whoever happens to be sitting in it. A reading that is
     *  not `ok` is padi saying it does not know (`pending` while a resolve is in
     *  flight, `unsupported` for a remote no adapter serves, `unavailable` with
     *  the forge's own reason), never "there is no pull request". VALUE-forwarded:
     *  each frame is the whole current reading, so a rebind replays it. */
    pullRequest: {
      inputSchema: Schema.Struct({
        repoPath: Schema.String,
        branch: Schema.String,
      }),
      outputSchema: PrResultSchema,
    },
    /** The per-subscriber terminal byte stream — snapshot (serialized screen)
     *  as the first frame, then live output, 1:1 through each hop. DELTA/
     *  fail-through: the scrollback snapshot is ONLY ever the first frame of a
     *  fresh stream, so a mid-chain disconnect must terminate it (the client
     *  re-attaches end-to-end); the shipped overflow frame (#1591) rides it. */
    terminalAttach: {
      inputSchema: PadiTerminalAttachInputSchema,
      outputSchema: PadiTerminalAttachFrameSchema,
    },
  },
  events: {
    /** Terminal process exited — fires once per terminal lifetime with the
     *  exit code. */
    terminalExit: {
      inputSchema: PadiTerminalIdInputSchema,
      outputSchema: TerminalOnExitOutputSchema,
    },
  },
  procedures: {
    /** Standing settle-event subscriptions — open · drain · close. See the
     *  schema block above for why these are instant verbs beside a pulse stream
     *  rather than one blocking `next`. */
    watch: {
      open: {
        input: PadiWatchOpenInputSchema,
        output: PadiWatchOpenOutputSchema,
      },
      /** Hand over everything queued, acknowledging `after` first. Never blocks:
       *  a caller that wants to WAIT parks on `watchPulse` and re-drains. */
      drain: {
        input: PadiWatchDrainInputSchema,
        output: PadiWatchDrainOutputSchema,
        error: WatchSubscriptionNotFound,
      },
      /** Drop a subscription and its buffer. RAISES the same declared
       *  `WatchSubscriptionNotFound` a drain does, rather than answering
       *  `{closed: false}`: "there was no such subscription" is exactly the
       *  answer that error class exists to keep distinguishable from "there was
       *  nothing to report", and a boolean handed to an agent reads as the
       *  latter. */
      close: {
        input: PadiWatchNameInputSchema,
        output: Schema.Struct({}),
        error: WatchSubscriptionNotFound,
      },
    },
    /** Terminal lifecycle — create · kill · killAll · sleep · wake · restart ·
     *  discardSleeping · resize · sendInput · recycleKaval. */
    lifecycle: {
      create: {
        input: PadiCreateInputSchema,
        output: TerminalInfoSchema,
        error: TerminalGateErrorSchema,
      },
      kill: {
        input: PadiTerminalIdInputSchema,
        output: TerminalInfoSchema,
        error: TerminalNotFound,
      },
      killAll: {},
      // `resize`/`sendInput` QUIET-DROP a write that lands just after a kill
      // (#1628 — an expected race), so none of these three declares an error.
      sleep: { input: PadiTerminalIdInputSchema },
      wake: {
        input: PadiTerminalIdInputSchema,
        output: TerminalInfoSchema,
        error: TerminalNotFound,
      },
      /** Restart an active terminal IN PLACE: a fresh PTY on the same id, in
       *  its cwd, its layout / parent / theme / title policy untouched — so it
       *  picks up what a new terminal gets now (the agents' PATH layer). A live
       *  agent's conversation resumes while agents stay on; with agents off it
       *  comes back as a plain shell. Answers once the new PTY is up, with the
       *  profile it got. Refuses an id that is not an active terminal. */
      restart: {
        input: PadiTerminalIdInputSchema,
        output: PadiRestartOutputSchema,
        error: TerminalNotFound,
      },
      discardSleeping: { input: PadiTerminalIdInputSchema },
      resize: { input: PadiResizeInputSchema },
      sendInput: { input: PadiSendInputSchema },
      /** Force-recycle THIS host's kaval daemon, preserving the session — the
       *  "Restart kaval" button (B3.2). padi's INTERNAL supervisory op: capture
       *  the session → drain the terminals → recycle kaval (kill + spawn fresh) →
       *  park the captured session so the restore card re-offers it. Un-wedges a
       *  stuck-but-alive kaval (which `control.drain`'s adopt path would NOT
       *  recycle) as much as a dead one. PADI STAYS UP — this never restarts padi;
       *  that is the separate `control.drain` upgrade path. Takes no input,
       *  resolves once the fresh kaval is connected (or rejects, session safe on
       *  disk to retry/restore). */
      recycleKaval: {
        error: KavalContractSkew,
      },
    },
    /** Terminal chrome — the client-owned per-terminal UI record. Every setter
     *  but `setActive` narrows to a MUTABLE terminal first, so every one of
     *  them declares {@link TerminalNotFound}; `setParent` additionally refuses
     *  an edge that would close a cycle. `setActive` takes a nullable id and
     *  simply records it, so it can't refuse. */
    chrome: {
      setTheme: { input: PadiSetThemeInputSchema, error: TerminalNotFound },
      setIntent: { input: PadiSetIntentInputSchema, error: TerminalNotFound },
      setParent: {
        input: PadiSetParentInputSchema,
        error: Schema.Union([TerminalNotFound, TerminalParentCycle]),
      },
      setActive: { input: PadiSetActiveInputSchema },
      setCanvasLayout: {
        input: PadiSetCanvasLayoutInputSchema,
        error: TerminalNotFound,
      },
      setSubPanel: {
        input: PadiSetSubPanelInputSchema,
        error: TerminalNotFound,
      },
      setRightPanel: {
        input: PadiSetRightPanelInputSchema,
        error: TerminalNotFound,
      },
    },
    /** Screen reads — the serialized screen + a scrollback text slice. All
     *  four narrow to an ACTIVE terminal (a dormant record has no live mirror
     *  to read), so all four declare {@link TerminalGateErrorSchema}: the id
     *  names nothing ({@link TerminalNotFound}), or it names a record that is
     *  asleep or parked ({@link TerminalNotActive} — wake it and read again). */
    screen: {
      state: {
        input: PadiTerminalIdInputSchema,
        output: Schema.String,
        error: TerminalGateErrorSchema,
      },
      text: {
        input: PadiScreenTextInputSchema,
        output: Schema.String,
        error: TerminalGateErrorSchema,
      },
      history: {
        input: PadiScreenHistoryInputSchema,
        output: PadiScreenHistoryOutputSchema,
        error: TerminalGateErrorSchema,
      },
      /** The screen as a rendered PNG — the read a face that can SHOW an
       *  image makes (the `screen_image` MCP tool, `kolu screenshot`), where
       *  `screen.text` is the read a face that can only show text makes.
       *
       *  Rendering lives on THIS side of the wire, not in kaval: the theme is
       *  a per-terminal choice padi holds, so padi is the only place that
       *  knows what colour "palette 4" is. */
      image: {
        input: PadiScreenImageInputSchema,
        output: PadiScreenImageOutputSchema,
        error: TerminalGateErrorSchema,
      },
    },
    /** Filesystem reads scoped to a repo on the serving host. Each declares
     *  {@link FsGitReadErrorSchema} — `FileGone` is the arm the Code tab's
     *  delete-while-viewing handling swallows, and it is the reason these are
     *  DECLARED rather than left to the defect channel. */
    fs: {
      listAll: {
        input: FsListAllInputSchema,
        output: FsListAllOutputSchema,
        error: FsGitReadErrorSchema,
      },
      listIgnored: {
        input: FsListIgnoredInputSchema,
        output: FsListIgnoredOutputSchema,
        error: FsGitReadErrorSchema,
      },
      listDirectory: {
        input: FsListDirectoryInputSchema,
        output: FsListDirectoryOutputSchema,
        error: FsGitReadErrorSchema,
      },
      readFile: {
        input: FsFileInputSchema,
        output: FsReadFileTextOutputSchema,
        error: FsGitReadErrorSchema,
      },
      filePreviewTag: {
        input: FsFileInputSchema,
        output: Schema.String,
        error: FsGitReadErrorSchema,
      },
    },
    /** Git reads + worktree mutations scoped to a repo on the serving host — a
     *  worktree materializing on the wrong machine is unspellable. */
    git: {
      getStatus: {
        input: GitStatusInputSchema,
        output: GitStatusOutputSchema,
        error: GitBaseReadErrorSchema,
      },
      getDiff: {
        input: GitDiffInputSchema,
        output: GitDiffOutputSchema,
        error: GitBaseReadErrorSchema,
      },
      worktreeCreate: {
        input: WorktreeCreateInputSchema,
        output: WorktreeCreateOutputSchema,
        error: WorktreeCreateErrorSchema,
      },
      worktreeRemove: {
        input: WorktreeRemoveInputSchema,
        error: FsGitReadErrorSchema,
      },
    },
    /** Byte writes — the scratch write half of paste/upload. The AUTHORITATIVE
     *  upload gate: it needs an ACTIVE terminal to write under
     *  ({@link TerminalGateErrorSchema} — no such id, or an id whose record is
     *  asleep/parked) and re-enforces the extension allowlist +
     *  size cap ({@link ScratchWriteRejected}). */
    scratch: {
      write: {
        input: PadiScratchWriteInputSchema,
        output: PadiScratchWriteOutputSchema,
        error: Schema.Union([TerminalGateErrorSchema, ScratchWriteRejected]),
      },
    },
    /** Byte reads — the iframe binary preview (range-capable, serve-dir-shaped),
     *  repo-path-keyed. `repoRootForTerminal` resolves a terminal id to its repo
     *  root off padi's registry so the re-serving binder's HTTP preview route can
     *  stream the file itself (bounded heap) without holding the terminal→repoRoot
     *  map. */
    preview: {
      read: {
        input: PadiPreviewReadInputSchema,
        output: PadiPreviewReadOutputSchema,
        error: PreviewTooLarge,
      },
      repoRootForTerminal: {
        input: PadiRepoRootForTerminalInputSchema,
        output: PadiRepoRootForTerminalOutputSchema,
      },
    },
    /** Transcript export — the per-agent loaders (claude JSONL, codex/opencode
     *  SQLite) run host-side. */
    transcript: {
      exportHtml: {
        input: ExportTranscriptHtmlInputSchema,
        output: ExportTranscriptHtmlOutputSchema,
        error: Schema.Union([
          TerminalGateErrorSchema,
          TranscriptNoAgent,
          TranscriptNotFound,
        ]),
      },
    },
    /** agent-distro on this host — merged onto the `agentDistro` cell's wire
     *  node, as `session` is (no verb overlap). `report` is kolu-server's word
     *  on a delivery to this host (`AgentDistroDeliveryReport`): a delivery
     *  started, a bundle landed (padi points the profile's `current` at it), or
     *  it failed (typed, in kolu-server's words). Called by the binder only —
     *  never exposed through the MCP face. Fails on a profile this padi's
     *  listing does not name, and on a landing this host cannot take (the
     *  bundle is not here). */
    agentDistro: {
      report: { input: AgentDistroDeliveryReportSchema },
      /** Which models `harness` offers on this host, run in `cwd` (the
       *  repository a role will start in, whose own `plugin.json` composes
       *  over the profiles) in the environment a new terminal there ends up
       *  with — and how a launch is given one. Read-only; the binder calls it
       *  and the browser calls it through the re-serve. */
      models: {
        input: Schema.Struct({ harness: Schema.String, cwd: Schema.String }),
        output: AgentModelsSchema,
        error: AgentModelsUnavailable,
      },
      /** How `harness`'s launch takes a model on this host — the adapter's
       *  word alone, which runs no harness. What a start reads. */
      launch: {
        input: Schema.Struct({ harness: Schema.String }),
        output: AgentLaunchSchema,
        error: AgentLaunchUnavailable,
      },
    },
    /** Session restore/import/forfeit — executes host-side (padi as one writer). */
    session: {
      restore: {
        input: PadiSessionRestoreInputSchema,
        output: PadiSessionRestoreOutputSchema,
      },
      import: { input: PadiSessionImportInputSchema },
      /** Explicitly discard the pending restore — drop the parked restore-card
       *  entries AND clear the saved session together. The deliberate "start fresh"
       *  act (the restore card's dismiss), distinct from `restore` (consumes) and
       *  `lifecycle.create` (which no longer forfeits). Takes no input. */
      forfeit: { input: Schema.Struct({}) },
    },
    /** The state-backup ring (#1658) — list this host's snapshots and restore a
     *  session from one. Executes host-side, on the padi that owns the ring
     *  (a remote host's backups live on that box; the map client is the reach). */
    backups: {
      list: { output: PadiBackupsListOutputSchema },
      restore: { input: PadiBackupsRestoreInputSchema },
    },
    /** Why this host's padi is slow — children, stalls, watchers, memory and
     *  call times, measured always and assembled when asked. Read-only, and
     *  it cannot refuse, so it declares no error. */
    diagnostics: {
      read: { output: PadiDiagnosticsSchema },
    },
  },
});

export type PadiSurfaceSpec = (typeof padiSurface)["spec"];
type PadiSF = SurfaceTypes<typeof padiSurface.spec>;

/** The `terminals` collection key — a terminal id. */
export type PadiTerminalKey = PadiSF["collections"]["terminals"]["Key"];

/** How a re-serve (padi↔kolu-server, W2.1) forwards a member across the hop:
 *   - `value` — HOLD-OPEN: a rebind replays the current value (cells,
 *     collections, `{seq}` pulses, request/response procedures);
 *   - `delta` — FAIL-THROUGH: a mid-chain disconnect MUST terminate the
 *     downstream browser stream, so a scrollback/liveness snapshot is only ever
 *     the first frame of a FRESH stream (never a replayed snapshot spliced into
 *     a live stream as bytes). Only `activity`, `terminalAttach` and
 *     `watchStates`. */
export type ForwardingPolicy = "value" | "delta";

/** The forwarding policy of every `padiSurface` member, keyed by its top-level
 *  surface key (a cell/collection/stream/event name, or a procedure NAMESPACE —
 *  every procedure under a namespace shares its policy). `session` is BOTH a cell
 *  (get/set/test__set) and a procedure namespace (restore/import) that `defineSurface`
 *  merges onto one wire node (`surface.padi.session.*`, no verb overlap); one entry
 *  covers the merged member (both are `value`). The contract test pins this against
 *  the built spec so no member can be added without an annotation, and W2.1's
 *  re-serve helpers read it to type each hop. */
export const PADI_FORWARDING_POLICY = {
  version: "value",
  identity: "value",
  roster: "value",
  urgency: "value",
  status: "value",
  newTerminalPolicy: "value",
  agentDistro: "value",
  agentDistroStatus: "value",
  agentDistroReceipt: "value",
  hostListeners: "value",
  hostInventory: "value",
  processMemory: "value",
  activityFeed: "value",
  terminals: "value",
  daemonStatus: "value",
  activity: "delta",
  watchStates: "delta",
  watchPulse: "value",
  subscribeRepoChange: "value",
  subscribeFileChange: "value",
  terminalAttach: "delta",
  pullRequest: "value",
  terminalExit: "value",
  lifecycle: "value",
  chrome: "value",
  screen: "value",
  fs: "value",
  git: "value",
  scratch: "value",
  preview: "value",
  transcript: "value",
  watch: "value",
  session: "value",
  backups: "value",
  diagnostics: "value",
} as const satisfies Record<string, ForwardingPolicy>;

/** Every top-level member key `padiSurface` declares — the union of cell,
 *  collection, stream, event names and procedure namespaces. Derived from the
 *  spec so the contract test can prove {@link PADI_FORWARDING_POLICY} covers
 *  every member (and no orphan annotation exists). */
export function padiMemberKeys(): string[] {
  const spec = padiSurface.spec;
  return [
    ...Object.keys(spec.cells ?? {}),
    ...Object.keys(spec.collections ?? {}),
    ...Object.keys(spec.streams ?? {}),
    ...Object.keys(spec.events ?? {}),
    ...Object.keys(spec.procedures ?? {}),
  ];
}

/** The forwarding policy of the ODU SIBLING's members — its own policy object,
 *  not entries bolted onto padi's.
 *
 *  A policy answers "how does THIS surface's member survive a hop", and the two
 *  surfaces are two contracts on two clocks: padi's members are padi's to
 *  classify and odu's are odu's. One flat map covering both would leave the
 *  set-equality gate — which proves a policy names every member of its surface
 *  and no others — unable to prove either.
 *
 *  `checkout` is `value`: every frame is a FULL replacement, so a rebind
 *  replaying the current one is correct, the same rule padi's pulse streams
 *  ride. `service` is a cell, and cells are always folded as values whatever a
 *  policy says; it is named anyway, because the gate checks the whole member set
 *  and a member missing from a policy is how a future stream comes to be
 *  forwarded by a rule nobody chose. */
export const ODU_FORWARDING_POLICY = {
  service: "value",
  checkout: "value",
} as const satisfies Record<string, ForwardingPolicy>;

/** Every top-level member key the carried odu sibling declares — the twin of
 *  {@link padiMemberKeys}, so the contract test can prove
 *  {@link ODU_FORWARDING_POLICY} covers exactly them. */
export function oduMemberKeys(): string[] {
  const spec: {
    cells?: object;
    collections?: object;
    streams?: object;
    events?: object;
    procedures?: object;
  } = oduCarriedSurface.spec;
  return [
    ...Object.keys(spec.cells ?? {}),
    ...Object.keys(spec.collections ?? {}),
    ...Object.keys(spec.streams ?? {}),
    ...Object.keys(spec.events ?? {}),
    ...Object.keys(spec.procedures ?? {}),
  ];
}

/** The control core's wire version — FROZEN forever (never versions). padi
 *  serves it BESIDE `padiSurface` so a contract-revving deploy can still reach
 *  the daemon: a binder newer than the running padi invokes control-core `drain`
 *  (persist + exit; PTYs survive in kaval) and spawns its own newer closure, so
 *  two binders at different `padiSurface` versions converge rather than
 *  livelock, and no path ever kill-9s a padi. */
export { CONTROL_CORE_VERSION };

/** `hello` — the identity handshake a binder reads first: who this padi is and
 *  what `padiSurface` version it serves. Version-agnostic (part of the frozen
 *  core), so a skewed binder still learns the running version to decide
 *  upgrade-me vs drain-you. */
export const PadiHelloSchema = ControlCoreHelloSchema;
/** Padi's byte-identical alias of the generic frozen hello payload. */
export type PadiHello = ControlCoreHello;

/** `version` — the control core's own version probe (just the frozen core
 *  version), distinct from the surface `version` cell. */
export const PadiControlVersionSchema = Schema.Struct({
  controlCoreVersion: Schema.String,
});
export type PadiControlVersion = typeof PadiControlVersionSchema.Type;

/** `clock.now` — padi's current clock, RTT-halved by the binder to measure a
 *  once-per-bind offset (owner-clock display; deliberately NOT a served ticking
 *  cell). */
export const PadiClockNowSchema = Schema.Struct({ epochMs: Schema.Number });
export type PadiClockNow = typeof PadiClockNowSchema.Type;

/** The frozen control-core SURFACE — hello · version · drain · clock.now.
 *  Defined as pure schema shapes in W1.C; W2.2 serves them for real, BESIDE
 *  `padiSurface` (as the sibling surface key `control`), over padi's socket. A
 *  binder reaches it even when `padiSurface` is version-skewed — the schemas here
 *  NEVER change (the frozen side channel), so a newer binder can always call
 *  `control.drain` to converge the daemon onto the newest closure rather than
 *  livelock, and no path ever kill-9s a padi. `clock.now` is a frozen member
 *  kept FOREVER for cross-version skew (see its per-verb note below).
 *
 *  The frozen `version` cell (`controlCoreVersion`, always "1.0") is DISTINCT from
 *  `padiSurface`'s own `version` cell — this one is contractually immovable. */
export const padiControlSurface = defineSurface({
  cells: {
    version: {
      schema: PadiControlVersionSchema,
      default: { controlCoreVersion: CONTROL_CORE_VERSION },
      verbs: ["get"],
    },
  },
  procedures: {
    /** The frozen control verbs — the ONE namespace, never versions. Reached as
     *  `surface.control.core.<verb>` (the surface key `control` + this namespace). */
    core: {
      ...controlCoreProcedureSpec,
      /** Identity handshake — who this padi is (`stateRoot`) + which
       *  `padiSurface` version it serves. Read FIRST by a binder. */
      /** The frozen core's own version probe (just `controlCoreVersion`). */
      controlVersion: { output: PadiControlVersionSchema },
      /** padi's current clock — the binder RTT-halves it once per bind to age
       *  memory against the host's clock (deliberately NOT a ticking cell).
       *
       *  FROZEN control-core member, kept FOREVER for cross-version skew: an old
       *  binder crosses versions via `hello → clockNow → decide`, so this member
       *  never versions and never leaves the frozen core. The framework
       *  `system.clockNow` reserved member (see `@kolu/surface`, measured by
       *  `makeSession` at admit) is the NEW measurement path that lives BESIDE
       *  this one — a graduation, NOT a replacement. New kolu measures via
       *  `system.clockNow` only; this stays for the old binders. */
      clockNow: { output: PadiClockNowSchema },
    },
  },
});

/**
 * ODU, as padi carries it — the members of odu's OWN contract that cross kolu's
 * wire, assembled from odu's own declarations.
 *
 * NOT a second contract: every schema below IS `oduServiceSurface`'s, reached
 * through its spec rather than restated, so a change odu makes to the shape of a
 * checkout frame is a change here by construction. What kolu chooses is only
 * WHICH members it carries, and the two it carries are the two a reader needs:
 *
 *   - `cells.service` — who is serving, and on what origin. A link out to odu's
 *     own page has to dial where the daemon actually is, and that is a fact of
 *     the daemon's lifecycle (its environment, its flags) that no reader can
 *     derive.
 *   - `streams.checkout` — one checkout, whole: the run it stands for, that
 *     run's work, and what ran before it.
 *
 * The REST of odu's surface is deliberately not carried. Mirroring its board
 * would have every kolu host holding every run of every checkout — the per-host
 * waste this sibling exists to remove — and re-serving its procedures would put
 * `run.start` behind kolu's same-origin gate, a decision nobody has asked for. A
 * member that turns out to be wanted is one line here.
 */
export const oduCarriedSurface = defineSurface({
  cells: { service: oduServiceSurface.spec.cells.service },
  streams: { checkout: oduServiceSurface.spec.streams.checkout },
});

/** What the padi daemon IMPLEMENTS in its own process. The odu sibling is
 *  absent here on purpose: it is RE-SERVED from the odu daemon's own socket, so
 *  padi has no deps to supply for it. */
export const padiDaemonSurfaces = {
  padi: padiSurface,
  control: padiControlSurface,
} as const;

/** What the padi daemon's socket SERVES — its own two surfaces, plus the odu
 *  sibling it re-serves. The dialing side opens its link over this contract, so
 *  a caller sees odu's members at `surface/odu/*` whether or not an odu daemon
 *  is running on that machine: absence is a FRAME, not a missing tag. A tag set
 *  that changed with a neighbouring daemon's installation would make every
 *  client's contract a function of the host it happened to reach. */
export const padiServedSurfaces = {
  padi: padiSurface,
  control: padiControlSurface,
  odu: oduCarriedSurface,
} as const;

/** The combined wire the padi daemon serves — ONE flat `RpcGroup` carrying every
 *  sibling's tags (`surface/padi/*` + `surface/control/*` + `surface/odu/*`),
 *  plus the per-sibling `Surface` values a client builds its faces from. Each
 *  surface is re-walked under its own `surface/<key>/` tag prefix, so the
 *  reserved `system/*` tags of two siblings cannot collide. */
export const padiDaemonContract = composeSurfaceContracts(padiServedSurfaces);
export type PadiDaemonContract = typeof padiDaemonContract;

/** The flat tag map a padi daemon serves — what `implementSurfaces` binds and
 *  what a dial's link is opened over. */
export const padiDaemonGroup = padiDaemonContract.group;

/** `padiSurface` as its SIBLING — the same members at `surface/padi/*`. This is
 *  the value a client builds the padi face from (see `dial.ts`'s
 *  `scopePadiSurface`), so the serving side and the dialing side derive the
 *  sibling's tags from ONE expression rather than two rules that can drift. */
export const padiSurfaceSibling: Surface<typeof padiSurface.spec> =
  padiDaemonContract.siblings.padi;

/** The frozen control core as its SIBLING — `surface/control/*`. A binder
 *  reaches `core.hello` / `core.drain` here even at a `padiSurface` skew. */
export const padiControlSibling: Surface<typeof padiControlSurface.spec> =
  padiDaemonContract.siblings.control;

/** The odu sibling — odu's carried members at `surface/odu/*`. The value padi
 *  RE-SERVES onto (so the re-serve's handlers land at the sibling's own tags),
 *  and the one a client builds the odu face from. */
export const oduSibling: Surface<typeof oduCarriedSurface.spec> =
  padiDaemonContract.siblings.odu;
