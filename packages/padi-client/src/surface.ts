/**
 * `@kolu/padi-client/surface` — the BROWSER-SAFE face of `@kolu/padi`: `padiSurface`
 * (the Effect Schema contract the client imports), the per-member
 * forwarding-policy annotations, and the frozen control-core types.
 *
 * `@kolu/padi` is BORN in W1.C (the padi plan of record, PR #1649): location is
 * structure — code destined for the per-host workspace daemon must not camp in
 * `packages/server`, or the seal at the end of W1.R would fight gravity and W2.2
 * would be a double move. The PACKAGE is born now; the PROCESS at W2.2. W1.C
 * defines the CONTRACT here — nothing served, zero runtime change. The motion
 * stage (W1.M) then physically relocates the terminal domain OUT of
 * `packages/server` INTO this package, and the rewiring stage (W1.R) serves
 * `padiSurface` natively from the package and migrates the client onto it, one
 * member per commit. No backings adapter ever exists — by the time anything
 * serves, the backing code already lives here.
 *
 * Unlike the frozen `terminalWorkspaceSurface` (3.0, the legacy generic base no
 * longer growing new members), this is a NEW surface — so a new per-host
 * capability lands here without being threaded through that frozen base. It composes the two
 * halves of a terminal record server-side into ONE `terminals` collection
 * (`authored ⋈ snapshot`), folds an `urgency` projection off the registry, and
 * gathers every host-side capability (lifecycle · chrome · attach · screen ·
 * fs/git · worktree · bytes · transcript · session) as procedures/streams.
 *
 * ── Two structural novelties this contract carries ──────────────────────
 *
 *   1. **Per-member forwarding policy** ({@link PADI_FORWARDING_POLICY}). Every
 *      member is typed `value` (hold-open — a rebind replays the current value:
 *      cells, collections, pulses, request/response procedures) or `delta`
 *      (fail-through — a mid-chain padi↔kolu-server disconnect MUST terminate
 *      the downstream browser stream so a scrollback snapshot is only ever the
 *      first frame of a fresh stream: `activity` and `terminalAttach`). W1.C
 *      only DECLARES the annotation; W2.1 graduates the forwarding *machinery*
 *      (the drishti-gated re-serve helpers, into `@kolu/surface`) that reads it.
 *
 *   2. **A reserved optional host axis** on the `terminals` value
 *      ({@link PadiHostAxisSchema}). Absent on every W1 record — one padi serves
 *      one host, so the dock has no foreign host to name yet — but present in
 *      the contract from 1.0 so the cross-host dock (W4) lands without a break.
 *
 * Beside the surface, the frozen {@link padiControlSurface} (hello · version ·
 * drain · clock.now) — version-agnostic, never versions, served for real in
 * W2.2. Its universal hello/drain fragment now comes from
 * `@kolu/surface-daemon`; padi extends that wire with its frozen legacy
 * `version` and `clock.now` members.
 *
 * BROWSER-SAFE face: like `koluSurface` this imports
 * only `@kolu/surface/define`, schema-only modules (its own `./vocab.ts` +
 * `./errors.ts` + `./transcriptSchema.ts`, `kolu-git/schemas`,
 * `@kolu/terminal-vocab/schema`),
 * and `effect` — no `node:`/kaval runtime (that lives beside this, in the node-only
 * side the motion stage adds). The terminal VOCABULARY now lives HERE (`./vocab.ts`,
 * re-exported below): the arrow points `kolu-common → @kolu/padi`, never back. The
 * one remaining edge into kolu-common is the `surfaces` config registry (the
 * coordinator restructures that next).
 */

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
// The bucket VOCABULARY, straight from the leaf that owns the fold it is
// defined from — not through `terminalVocab.ts`, which type-imports this module
// back. A value import along that edge would make the pair a runtime cycle, and
// the layering `terminalVocab.ts`'s header states would be one an import graph
// refutes.
import {
  WAIT_STATES,
  WATCH_DEFAULT_STATES,
} from "@kolu/terminal-vocab/agentProjection";
import {
  FsFileInputSchema,
  FsReadFileTextOutputSchema,
  RepoChangePulseSchema,
  TerminalIdSchema,
} from "@kolu/terminal-vocab/schema";
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
import type { ClientErrorPolicy } from "./clientPolicy.ts";
import {
  FsGitReadErrorSchema,
  KavalContractSkew,
  PreviewTooLarge,
  ScratchWriteRejected,
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

// The terminal VOCABULARY (schemas · records · pure helpers) lives HERE, in
// `@kolu/padi-client` — the terminal domain's client half. `@kolu/padi` depends on
// this package and serves the same object its clients dial, so there is one
// vocabulary and not two to keep in step. Re-exported from this browser-safe
// entry so consumers reach the schemas as `@kolu/padi-client/surface`. The UI-chrome half
// (`./chromeVocab.ts`, split out in L17) rides the same entry, so the export set is
// unchanged — a chrome schema is still `@kolu/padi-client/surface`'s to give.
export * from "./chromeVocab.ts";
// kolu's app-owned client-error-policy union (SR11) — declared here (not kolu-common)
// so `padiSurface`'s per-host members below can reference it without `@kolu/padi`
// importing `kolu-common` (the seal forbids that arrow); `kolu-common/surface`
// re-exports it for `koluSurface` and the client. See `./clientPolicy.ts`.
export type { ClientErrorPolicy, ToastOnlyPolicy } from "./clientPolicy.ts";
// The DECLARED error vocabulary (PLAN D4) rides the same entry: the classes are
// both the wire schema this surface declares and the value a client narrows on,
// so a consumer reaches them where it reaches the members that raise them.
export * from "./errors.ts";
// The RESOLVED new-terminal theme policy the binding kolu-server pushes — declared
// here for the same seal reason as the client-error policy above, and re-exported
// by `kolu-common/surface` for `koluSurface` and the client. See
// `./newTerminalPolicy.ts`.
export {
  DEFAULT_NEW_TERMINAL_POLICY,
  type NewTerminalPolicy,
  NewTerminalPolicySchema,
  newTerminalPolicyEqual,
} from "./newTerminalPolicy.ts";
export * from "./vocab.ts";
// The transcript-export wire vocabulary rides the same entry as everything else
// `padiSurface` speaks. It had a door of its own until the two halves of ONE
// vocabulary were noticed to be split by nothing but which symbols the spec
// below happens to name: the two RPC schemas arrived through this entry, while
// `Transcript` / `TranscriptSchema` / `TranscriptHtmlMode` arrived through a
// second. A consumer should not have to know which half it wants.
export * from "./transcriptSchema.ts";

// ── Version ─────────────────────────────────────────────────────────────

/** The wire-shape `major.minor` this build of `padiSurface` serves and expects.
 *  1.0 is the initial contract (the padi plan of record, PR #1649); 1.1 ADDS the
 *  `lifecycle.recycleKaval` procedure (the "Restart kaval" button's session-
 *  preserving kaval recycle); 1.2 ADDS the `hostInventory` cell (padi serving the
 *  running kaval + padi daemons on its OWN host — the "Running daemons" leak
 *  diagnostic, which rides the re-served surface so it works identically local and
 *  remote); 1.3 ADDS the `identity` cell (padi's own build commit / surfaceVersion /
 *  boot time, the per-host twin of the control-core `hello` — see
 *  {@link PadiIdentitySchema}).
 *
 *  2.0 is the first MAJOR bump, and it carries TWO independent breaking changes that
 *  landed in the same release:
 *
 *  (a) the per-terminal right-panel `collapsed` field is ADDED to
 *  `RightPanelPerTerminalStateSchema` (which rides BOTH the `terminals` metadata
 *  collection AND the `chrome.setRightPanel` command input) — the panel's collapsed
 *  posture moved off the global preference to follow the terminal (#959). Its unsafe
 *  skew direction is old-client/new-padi — the ONE direction `isContractVersionCompatible`
 *  would otherwise WAVE THROUGH (an old client accepts a newer-minor padi): a
 *  `chrome.setRightPanel` write is a whole-record REPLACE (`m.rightPanel = state` in
 *  `terminals.ts`), so an OLDER client that omits `collapsed` has the shared schema's
 *  `.default(false)` fill it in, then the replace CLOBBERS a newer client's persisted
 *  `collapsed:true` on that terminal — silent state loss a minor would not catch
 *  (mirrors `PTY_HOST_CONTRACT_VERSION` 5.0's reasoning).
 *
 *  (b) `fs.statFileMtimeMs` (a stat-mtime probe) is REMOVED and `fs.filePreviewTag`
 *  (a content-hash tag) put in its place — a shape-breaking rename in BOTH directions
 *  (a 1.x binder calling `statFileMtimeMs` on a 2.0 padi, or a 2.0 binder calling
 *  `filePreviewTag` on a 1.x padi, each hit a missing procedure).
 *
 *  Either one alone forces a major: only a major flips `isContractVersionCompatible`
 *  to refuse the skew in BOTH directions, so each side forces an honest "upgrade the
 *  other side" recycle rather than a silently-clobbered record or a vanished procedure.
 *  Additive growth (a new optional field / stream / procedure / cell that does NOT ride
 *  a shared whole-record client write) stays a minor bump; a shape-breaking change — or
 *  a persisted-record field addition on a client-written whole-record command, as in
 *  (a) — is a major. A remote dial gates an incompatible padi via
 *  `isContractVersionCompatible`. Distinct from {@link CONTROL_CORE_VERSION}, which is
 *  frozen forever so a contract-revving deploy can still reach the daemon's control
 *  core.
 *
 *  The read-only, server-seeded `identity` cell also gained an OPTIONAL `lifetime`
 *  field (padi's own `DaemonLifetimeInfo`, for the Padi dialog's lifetime row),
 *  added WITHOUT a contract bump: optional means a binder reading a survivor padi
 *  that predates it parses fine (falls back to "—"), so it needs no forced drain —
 *  the field simply arrives with padi's next respawn (which a code-change deploy
 *  triggers anyway). Kept symmetric with kaval's `system.version` lifetime field.
 *
 *  3.0 is the second MAJOR bump (scrollback-backfill). The `terminalAttach` stream's
 *  output was RESHAPED — from a bare `z.string()` (the bytes to write) to a
 *  discriminated `{ kind:"delta", data } | { kind:"snapshot", data, topLine }` frame
 *  (a `snapshot` carries the absolute mirror-line backfill seed; a `delta` is plain
 *  bytes), mirroring kaval's own `TerminalDataMsg` union rather than flattening it to
 *  an optional field. This is breaking in BOTH skew directions — an old client's
 *  `z.string()` schema rejects a new padi's object frame, and a new client's union
 *  schema rejects an old padi's string frame — so ONLY a major flips
 *  `isContractVersionCompatible` to refuse the skew both ways (an honest "upgrade the
 *  other side" recycle rather than a mis-parsed, dataless, or frozen pane). The
 *  additive `screen.history` procedure
 *  (the client's older-scrollback read) rides the same release; it alone would be a
 *  minor, but the `terminalAttach` reshape forces the major.
 *
 *  3.1 (additive · minor): the scrollback-backfill reflow guard (F3). Three
 *  OPTIONAL adds — a `reflowEpoch` on the `terminalAttach` snapshot frame, an
 *  `epoch` on `screen.history` input, a `stale` on its output — that let a
 *  client whose SHARED mirror a foreign attach reflowed (its own `term.cols`
 *  unchanged) HALT backfill instead of splicing a duplicated/skipped band. All
 *  optional, so both skew directions are graceful: an older 3.0 client ignores
 *  the extra fields, and a 3.1 client meeting a 3.0 padi reads them absent and
 *  runs fail-open (no epoch → no gate, the historical single-width behavior).
 *  A minor, not a major — no reshape, no required field, no emitted variant.
 *
 *  4.0 is a MAJOR bump that REMOVES the dead `lifecycle.restoreSleeping` procedure
 *  (retired per #1784's W12 review disposition: it had no production caller — the
 *  only writer, the client respawn loop, was already deleted; the real cold-boot
 *  restore seeds a sleeping terminal directly via `seedSleepingTerminal` in
 *  `sessionRestore.ts` / `reattach.ts`, never over the wire). A removed procedure is
 *  a shape-break in BOTH directions (an old binder that still called `restoreSleeping`
 *  would hit a missing proc on a 4.0 padi), so — exactly like 3.0's `terminalAttach`
 *  reshape — only a major flips `isContractVersionCompatible` to refuse the skew and
 *  force the honest recycle. The version is an honest statement of the wire SHAPE;
 *  encoding "no caller today" as a minor would bake in exactly the soft assumption the
 *  fail-fast rule rejects. Its consequence is the graceful padi-ONLY drain every
 *  code-change deploy already pays (a newer binder drains the straddling 3.x padi —
 *  save + exit — then respawns it at 4.0): kaval and the PTYs are UNTOUCHED, because a
 *  padi-surface bump does not touch the kaval contract.
 *
 *  4.1 (additive · minor): `daemonStatus` gains the `incompatible` arm — a NEW
 *  EMITTED VARIANT carrying `daemonVersion`/`requiredVersion` (SK4, the
 *  contract-skew-as-a-state fix). The version is an honest statement of the wire
 *  SHAPE: 3.1 stayed minor only because it had "no emitted variant"; here there
 *  IS one, so the minor bump is REQUIRED (the mirror of #1865, which folded an
 *  orphan 4.1 bump BACK because nothing emitted had changed — the two together
 *  teach the rule). Why a minor suffices — both skew directions converge before
 *  an unparseable frame is ever consumed: a NEWER binder (expects 4.1) against
 *  an old 4.0 padi fails `isContractVersionCompatible`'s minor rule (reported
 *  minor must be ≥ expected), so the binder drains-and-replaces the padi before
 *  consuming its surface; an OLDER 4.0 binder against a new 4.1 padi is
 *  version-compatible but BUILD-mismatched, so the build axis
 *  drains-and-replaces padi first — the old client schema (no `incompatible`
 *  arm) never sits against a padi that could emit it. (Two honest caveats on
 *  that second leg: the build drain is FENCED once per binder boot, and
 *  off-nix both build ids are "" so the axis is silent — in those windows an
 *  old binder rides a new padi version-compatibly, and IF that host's kaval
 *  then skews, the emitted `incompatible` frame fails the old client's
 *  discriminated-union parse LOUDLY — fail-fast, never mis-read as another
 *  state. That narrow edge is inherent to any additive minor; the common
 *  nix-run path converges the binder before it can occur.) That is
 *  the answer to "who reports the skew of the skew-reporter": the existing
 *  convergence machinery, before the new arm can reach an old parser.
 *
 *  4.2 (additive · minor): the ACTIVE terminal arm gains `ports` — the listening
 *  TCP ports padi's port sensor attributes to each terminal (PRT1). A new REQUIRED
 *  field on an emitted value, so the same rule 4.1 states applies: the shape a
 *  padi emits changed, therefore the version says so. Required rather than
 *  optional-with-a-default deliberately — an absent `ports` and an empty `ports`
 *  are different facts ("this padi cannot tell you" vs "this terminal serves
 *  nothing"), and spelling them the same would make the second unfalsifiable. The
 *  minor suffices for the reason spelled out at 4.1: a newer binder against an old
 *  4.1 padi fails the minor rule and drains it BEFORE consuming its surface, and an
 *  older binder against a 4.2 padi is build-mismatched and drains it first — so an
 *  old parser never meets a frame carrying (or missing) this field.
 *
 *  4.3 (RESHAPED field · minor): `ports`' `PortInfo` trades `wildcard: boolean`
 *  for `scope: "any" | "loopback" | "interface"` (PRT2). Not additive — a 4.2
 *  frame carries a field this parser no longer knows and lacks one it requires —
 *  yet still a MINOR, and for exactly the reason 4.1 and 4.2 give: the version
 *  gate is what keeps the two apart, and it works in both directions. A newer
 *  binder against a 4.2 padi fails `isContractVersionCompatible`'s minor rule and
 *  DRAINS it before consuming its surface; an older binder against a 4.3 padi is
 *  build-mismatched and drains it first. So no parser ever meets a frame of the
 *  other shape, and the reshape needs no compatibility arm — which is the point:
 *  a `wildcard`-or-`scope` union in the schema would be a permanent fallback path
 *  bought to smooth over a window the convergence machinery already closes. The
 *  reshape itself is in `@kolu/terminal-vocab` ports vocabulary, with the reason.
 *
 *  4.4 (additive · minor): a NEW `fs.listIgnored` procedure — git's collapsed
 *  gitignored listing, behind the Code tab's show-ignored toggle. `fs.listAll` is
 *  UNTOUCHED: an earlier draft grew it an `includeIgnored` flag and a required
 *  `ignoredPaths` output, which would have been a required-field emit change (4.2's
 *  rule) — but it also put a display toggle inside the main file-list query's value
 *  key, blanking the tree and remounting it collapsed on every flip. A separate
 *  procedure is both the better client architecture and the smaller wire change: a
 *  purely ADDITIVE procedure, the plainest minor there is. The minor suffices for
 *  the usual reason — a newer binder against an old 4.3 padi fails
 *  `isContractVersionCompatible`'s minor rule and DRAINS it before consuming its
 *  surface, so a 4.4 client never calls `fs.listIgnored` on a padi that lacks it
 *  (which would be a missing-procedure error, not a graceful absence).
 *
 *  4.5 (RESHAPED procedure input · minor): `session.restore` / `session.import`
 *  replace client-built `resumeIds?: string[]` with host-owned intent
 *  `{ resumeAgents?: boolean (default true), optOutIds?: string[] }`, and the
 *  saved-session cell stamps wire-only `resumableIds` (membership the client
 *  may only subtract from). Not additive — a 4.4 peer that still speaks
 *  `resumeIds` would silently lose toggle-off / opt-out under non-strict zod
 *  strip — so the version says so. The minor suffices for the reason 4.1–4.4
 *  give: convergence + minor-rule drain keeps the two shapes from meeting.
 *
 *  4.6 (additive · minor): a NEW `fs.listDirectory` procedure — ONE level of a
 *  directory, read when the user expands a row `fs.listIgnored`'s `--directory`
 *  collapse left childless (#2091). `fs.listIgnored` is UNTOUCHED, and keeping
 *  the read separate is the same call 4.4 made for the same reason: this input
 *  is keyed by DIRECTORY and fired by a CLICK, so folding it into either
 *  whole-repo listing would put a per-expansion value in that query's key and
 *  blank the tree on every click. Purely additive, so the plainest minor there
 *  is, and the minor suffices for the usual reason — a newer binder against a
 *  4.5 padi fails `isContractVersionCompatible`'s minor rule and DRAINS it
 *  before consuming its surface, so a 4.6 client never calls `fs.listDirectory`
 *  on a padi that lacks it.
 *
 *  4.7 (additive · minor): a NEW `newTerminalPolicy` cell — the RESOLVED
 *  new-terminal theme policy the binding kolu-server pushes, read by
 *  `lifecycle.create` so every face (browser, MCP, CLI) obeys the user's
 *  setting (#2045). Purely additive, and the minor suffices for the usual
 *  reason: a 4.7 binder — which CALLS `newTerminalPolicy.set` — fails
 *  `isContractVersionCompatible`'s minor rule against a 4.6 padi and DRAINS it
 *  before consuming its surface, so the write never lands on a padi that has
 *  no such member.
 *
 *  5.0 is the PROTOCOL-EPOCH flag day (PLAN D6). No payload shape moved — every
 *  member encodes byte-for-byte as it did under zod, which `surface.test.ts`
 *  now asserts as literal JSON strings rather than assumes. What moved is the
 *  framing beneath them: the oRPC peer protocol became Effect RPC ndjson, and
 *  the declared error channel stopped being a code map and became the tagged
 *  classes in `./errors.ts`. Two mutually undecodable epochs must never report
 *  the same version string — a "4.7"-reporting survivor would compare EQUAL to
 *  this build and be adopted as wire-compatible, silently disarming the very
 *  lever the break most needed to name — so the constant bumps even though the
 *  lever is inert across the one boundary that actually changed. The
 *  in-epoch skew mechanism (`isContractVersionCompatible`, the binder's
 *  drain-newer-else-refuse) keeps working unchanged from this epoch forward;
 *  CROSS-epoch peers are the supervisor's `unspeakable-protocol` domain (D6/#3),
 *  which this module never claims to classify.
 *
 *  5.1 (additive · minor): `session.restore` gains an OUTPUT — the active-terminal
 *  marker as of the end of the restore ({@link PadiSessionRestoreOutputSchema}).
 *  The procedure answered `void` before, and the client read the restored active
 *  tile off the `session` cell's NEXT snapshot instead; that is a race the client
 *  cannot win (the cell publishes behind a synchronous disk write, the terminals
 *  do not), and it cost the wrong tile whenever a loaded box lost it. A new
 *  emitted field on an existing procedure, so the same rule 4.1/4.2 state applies:
 *  the shape padi emits changed, therefore the version says so. The minor suffices
 *  for the usual reason — a newer binder against a 5.0 padi fails
 *  `isContractVersionCompatible`'s minor rule and DRAINS it before consuming its
 *  surface, and an older binder against a 5.1 padi is build-mismatched and drains
 *  it first, so no parser meets a frame of the other shape. `session.import` is
 *  UNTOUCHED: it restores a blob the client just handed over and seeds no view, so
 *  giving it an answer nothing reads would be shape for its own sake.
 *
 *  5.2 (additive · minor): a NEW `backups` procedure namespace — `backups.list`
 *  (enumerate the state-backup ring #1658 introduced, with a per-snapshot
 *  session summary) and `backups.restore` (restore a snapshot's session
 *  host-side, riding the same import machinery as `session.import` — and
 *  OUTPUT-LESS for the same reason `session.import` is: it restores a blob the
 *  user just picked and seeds no view from the call, so an answer nothing reads
 *  would be shape for its own sake). Purely additive, so the plainest minor
 *  there is, and the minor
 *  suffices for the usual reason — a newer binder against a 5.1 padi fails
 *  `isContractVersionCompatible`'s minor rule and DRAINS it before consuming
 *  its surface, so a 5.2 client never calls `backups.*` on a padi that lacks
 *  the ring.
 *
 *  5.3 (additive · minor): the agent-STATE watch. A new `watchStates` stream
 *  ({@link PadiWatchStatesInputSchema} → batches of
 *  {@link PadiStateEventSchema}), three new optional params on `watch.open`
 *  ({@link PadiWatchFilterFields}), and `watch.drain`'s `events` widened from
 *  the settle shape to {@link PadiWatchEventSchema} — the union of both event
 *  vocabularies. The widened OUTPUT is why this is a version bump and not a
 *  silent add: a 5.2 consumer's decoder would refuse a `snapshot`/`transition`/
 *  `nag` frame, and only the minor rule keeps it from ever meeting one (a newer
 *  binder against a 5.2 padi drains it before consuming its surface, and an
 *  older binder against a 5.3 padi is build-mismatched and drains it first). It
 *  can also never meet one by accident: a 5.2 caller cannot spell the params
 *  that put a state event in a queue.
 *
 *  5.4 (additive · minor): `screen.image` — the terminal as a rendered PNG
 *  ({@link PadiScreenImageInputSchema} → {@link PadiScreenImageOutputSchema}),
 *  serving the `screen_image` MCP tool and `kolu screenshot`.
 *
 *  A NEW PROCEDURE is exactly the shape the minor rule exists for, and the
 *  reasoning is the CLI/MCP face's, not the browser's. `connectPadi` gates on
 *  {@link isContractVersionCompatible}, and those faces are gate-only — they
 *  never drain (#1313). Left at 5.3, a fresh `kolu screenshot` would ADOPT a
 *  surviving 5.3 padi that does not serve the member and die on a missing
 *  procedure; the minor makes convergence drain-and-respawn it first, which is
 *  the honest recycle. This is the same call kaval's own 7.1 note makes for
 *  `getScreenCells`, and the same one 4.4 (`listIgnored`), 4.6
 *  (`listDirectory`) and 5.2 (backups) made before it. */
export const PADI_SURFACE_VERSION = "5.5";

/** The `version` cell payload — padi's self-declared surface contract version. */
export const PadiVersionSchema = Schema.Struct({
  contractVersion: Schema.String,
});
export type PadiVersion = typeof PadiVersionSchema.Type;

/** The value a fresh `version` subscriber sees — this build's version. */
export const DEFAULT_PADI_VERSION: PadiVersion = {
  contractVersion: PADI_SURFACE_VERSION,
};

// ── Identity (padi's own build commit · surfaceVersion · boot time) ───────

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

// ── Status (the per-host build-currency axis) ─────────────────────────────

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

// ── Host-daemon inventory rows (the "Running daemons" leak diagnostic) ─────
//
// One running kaval / padi the host-daemon scan enumerated — the read-only diagnostic
// rows the Kaval + Padi info dialogs list so a LEAKED daemon (a pre-upgrade kaval, a
// second padi at another state-root) is visible AT A GLANCE. (srid hit this dogfooding
// W2.2: a leaked pre-W2.2 kaval was invisible in the UI — only a `kaval-tui: more than
// one kaval daemon is running` CLI error surfaced it.) Read-only enumeration: scan the
// runtime dir, read each gate pid, read-only probe status — it NEVER kills/reaps.
//
// These live HERE, in @kolu/padi's browser-safe surface vocabulary, because padi OWNS
// the daemon domain (it discovers, adopts, and supervises the host's daemons — a kaval
// gate pid is a padi-domain fact, NOT terminal-awareness). One scan implementation (in
// @kolu/padi), one wire shape here. kolu-server's local-machine scan
// (`kolu-common/surface`'s `daemonInventory` cell) IMPORTS these shapes from here — the
// established `kolu-common → @kolu/padi` direction (the reverse is what the seal forbids).
//
// Honesty (#1034): every field the probe couldn't read is an honest `null` (rendered
// "—"), never a fabricated zero/version.

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

// ── The composed `terminals` value — active | sleeping | parked ───────────

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

// ── The urgency projection (recency-free) ─────────────────────────────────

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
});
export type PadiUrgency = typeof PadiUrgencySchema.Type;

/** Two urgency readings are equal when they carry the same ids in ALL FOUR
 *  lists, each in the same order — the urgency cell's `equals`, so the ~150 ms
 *  agent firehose (the `terminals` collection's write-triggers, which the derived
 *  `urgency` cell recomputes off) can't re-publish an unchanged projection.
 *  Comparing every list is load-bearing: a frame where only the finished set
 *  changed must survive this ONE wire dedup point so the finish transition
 *  reaches `useAttention` and fires, and a working→linger move (the same
 *  terminal, a different list) must reach the host tab or its activity count
 *  freezes. Every count is derived (`.length`), so comparing ids alone is
 *  already complete. Lives here beside the value schema (it
 *  is a property of the `PadiUrgency` VALUE) so the spec can declare it directly —
 *  the bridge's "equals lives at the member, once" law — without `surface.ts`
 *  reaching into the fold module. */
export function urgencyEqual(a: PadiUrgency, b: PadiUrgency): boolean {
  return (
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

// ── Procedure I/O schemas (padiSurface's own — NOT the dying root ones) ────
//
// These are the NEW contract shapes lifecycle/chrome/screen/bytes/session
// migrate onto (the root `terminal.*` namespace dies across W1.R). They are
// intentionally distinct from `kolu-common/contract`'s raw-oRPC schemas — most
// notably `create` carries only the base chrome, never the three SERVER-DERIVED
// authored facts (`lastActivityAt`, `lastAgentCommand`, `restoreTarget`) that padi
// earns from its own observation, so they are not duplicates to fold away.

/** Create input — the BASE `CreateTerminalInputSchema` (client chrome) plus the
 *  REQUIRED `placement` and an optional `cwd`. It derives from the base DIRECTLY
 *  rather than subtracting the three
 *  server-derived authored facts, so the exclusion is structural, not a maintained
 *  omit list: a future field added to `RestoreOnlyMetadataSchema` can never leak to
 *  the wire by someone forgetting to extend an omit. A fresh terminal has no truth
 *  about `lastActivityAt` / `lastAgentCommand` / `restoreTarget` (the fold derives
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

/** A bare terminal-id input — kill/sleep/wake/discardSleeping/screen.state. */
export const PadiTerminalIdInputSchema = Schema.Struct({
  id: TerminalIdSchema,
});

/** A whole positive count — the `z.number().int().positive()` of this wire.
 *  Named once so every grid dimension and bound is the SAME check rather than
 *  a re-derivation per member that can drift. */
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));

/** A whole non-negative count/index — the `z.number().int().nonnegative()` of
 *  this wire (line cursors, scrollback extents). */
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** A terminal grid — cols AND rows, together or not at all. The ONE grid rule
 *  on this surface: every member carrying a grid reuses it, so tightening the
 *  rule is one edit instead of a re-derivation per member. */
export const EndpointGridSchema = Schema.Struct({
  cols: PositiveInt,
  rows: PositiveInt,
});

/** Attach input: the terminal, plus — optionally — a grid to RESIZE it to
 *  first.
 *
 *  `resizeTo` is a command, not a description of the caller: the host runs its
 *  full resize before serializing (SIGWINCH to the child, a reflow of the
 *  shared mirror, and on a width change a reflow-epoch bump that stales every
 *  other attached client's backfill cursor). Attaching is a WRITE to shared
 *  state whenever it is present and differs from the terminal's current grid;
 *  the policy is last-attach-wins.
 *
 *  **The multi-client contract, stated (kolu#2101 G8e).** Last-attach-wins is
 *  the WHOLE policy — there is no follow-the-viewer, no smallest-wins, no
 *  ownership. Two viewers on one terminal therefore ping-pong its width, and a
 *  production recording shows exactly that: content re-wrapping 136 → ~65 → 136
 *  mid-session as a desktop and a resumed iOS tab alternately assert. The
 *  consequences each side sees, so nobody has to re-derive them:
 *    - The asserting client gets a snapshot serialized at ITS grid. Correct.
 *    - Every OTHER attached client keeps its own xterm dimensions and receives
 *      the reflowed bytes, so it renders N columns of content inside its own
 *      2N-column pane until something makes it re-attach.
 *    - A client that re-measures mid-request refuses the stale answer and
 *      reopens at its current grid (`client/src/terminal/reattachingStream.ts`'s
 *      `StaleSnapshotGrid`), so contention costs a repaint — never the attach
 *      loop, which is the property kolu#2101 G8 restored and pins.
 *
 *  **What is NOT settled: telling the viewer.** A client cannot currently DETECT
 *  that another viewer holds the terminal at a different size. It knows its own
 *  grid and the grid it asked at; nothing on this wire carries the pty's CURRENT
 *  grid, and the tempting proxy — a `reflowEpoch` bump — is not one, because the
 *  epoch also bumps on a RIS re-anchor (`xterm-kit/src/mirrorAnchor.ts`), so an
 *  indicator driven by it would light on every `clear`. Closing that gap is an
 *  ADDITIVE minor on this contract (the pty's current grid on the snapshot frame,
 *  or on the terminal record) plus a pane affordance; until it lands, the
 *  re-wrap is silent by construction, and no code should pretend otherwise.
 *
 *  The fusion is the point. The snapshot is bytes laid out for a specific
 *  cols×rows — cursor moves and wraps only mean anything at the width they were
 *  serialized for. Carrying the grid on the attach REQUEST means the resize and
 *  the serialize are one act, so the bytes and the grid can never be two facts
 *  that raced. Without it the consumer had to publish its size through a
 *  SEPARATE `lifecycle.resize` and hope it landed first — and when it didn't,
 *  nothing repaired the screen, because a same-dimensions resize is (correctly)
 *  a no-op, so no SIGWINCH ever reached the process.
 *
 *  OPTIONAL, and deliberately un-versioned. Absence degrades to exactly the
 *  previous reading in BOTH skew directions — a newer client's grid is stripped
 *  by an older padi, a newer padi serves an older client at the PTY's current
 *  size — which is the `commandRooted`/`shellJoin` class this contract already
 *  carries without a bump, not the emitted-variant class that must recycle. A
 *  bump here would force-recycle a surviving daemon (killing live PTYs) to buy
 *  a graceful improvement. */
export const PadiTerminalAttachInputSchema = Schema.Struct({
  id: TerminalIdSchema,
  // ONE optional composite, never two optional scalars: a grid is a cols AND a
  // rows, so `{ cols }` with no `rows` must not be a sendable request. Splitting
  // it would make half a grid representable on the wire and push the
  // both-or-neither rule out into hand-written guards at every reader — the very
  // class of "valid-looking value nobody can act on" this change exists to
  // remove. Optional as a UNIT is also what keeps the no-bump property: no schema
  // here is strict, so an older peer strips an unknown `resizeTo` exactly as it
  // would strip unknown `cols`/`rows`.
  //
  // `optionalKey`, never `optional` (PLAN #17): absent means ABSENT on this
  // wire — `Schema.optional` would round-trip an explicit `undefined` through
  // `null`, which is a value no peer ever sent.
  resizeTo: Schema.optionalKey(EndpointGridSchema),
});

/** One frame of the per-subscriber terminal byte stream.
 *
 *  A discriminated union, not a bare string and not an optional field: a
 *  `delta` is bytes to write; a `snapshot` (the first frame of any fresh
 *  stream, and every overflow re-attach) is a serialized screen that also
 *  carries the absolute mirror-line `topLine` seed for a scrollback-backfill
 *  cursor. Mirrors kaval's own `TerminalDataMsg` one hop up.
 *
 *  NAMED and exported because a consumer has to be able to say this type to
 *  write a frame handler at all — and because only the `snapshot` arm can go
 *  STALE. See `./attach` for the rules that govern it.
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
    // `reflowEpoch` (3.1 · additive · optional) — the mirror's reflow
    // generation this snapshot was serialized under; the client re-seeds
    // its backfill epoch from it so a foreign-resize reflow halts backfill
    // rather than corrupts it (F3). Absent from a kaval predating 5.2.
    //
    // `Schema.optional`, NOT `optionalKey` — the one place on this wire
    // that reads the way zod's `.optional()` did, and deliberately. This
    // value is FORWARDED VERBATIM across five hops of optional-typed
    // records before it is encoded: kaval's decoded attach frame →
    // `OpenedAttach.reflowEpoch?` → `TerminalAttachment.reflowEpoch?` →
    // `reattachingDeltas`' re-attach frame → this frame. Reading an absent
    // optional key yields `undefined`, so EVERY hop re-creates the key
    // present-with-`undefined`, and no amount of conditional-spread
    // discipline at one hop survives the next (`exactOptionalPropertyTypes`
    // is not set, so the compiler never objects). `optional` is
    // `optionalKey` + `UndefinedOr`, so the emitted BYTES are unchanged —
    // the key is omitted, never nulled — and a non-integer is still
    // rejected. Pinned by a byte fixture in `surface.test.ts`.
    reflowEpoch: Schema.optional(NonNegativeInt),
    /** `grid` (5.5 · additive · optional) — the cols×rows this snapshot was
     *  SERIALIZED at, read inside the same synchronous act as the bytes and the
     *  epoch so it cannot describe a reflow they never saw.
     *
     *  It closes the gap the multi-client note above names as NOT SETTLED. Two
     *  consumers needed it and neither could be served without it:
     *
     *    · the OBSERVE-ONLY attach — one that passes no `resizeTo` because it
     *      has no size to assert (a monitor, a read-only pane, a CLI dumping the
     *      screen). It never learned what size it received, so it sized its
     *      renderer by guess and a mismatched box wrapped the bytes into
     *      garbage. The frame is self-describing now.
     *    · the FOREIGN-RESIZE reading. Comparing this with the grid you ASKED
     *      at is the first honest detector of another viewer holding the
     *      terminal at a different size — precisely what `./attach`'s
     *      `snapshotAnswersGrid` does NOT claim, because two local measurements
     *      cannot see it.
     *
     *  `optionalKey`, and NO MAJOR: absence degrades to exactly the previous
     *  reading in both skew directions, the no-bump class this contract already
     *  documents. kaval carries it the same way and for the same reason — a
     *  cosmetic readout must never cost a live terminal. */
    grid: Schema.optionalKey(EndpointGridSchema),
  }),
]);
export type TerminalAttachFrame = typeof PadiTerminalAttachFrameSchema.Type;

/** The grid an attach asks for, and the unit a snapshot is laid out at. */
export type EndpointGrid = typeof EndpointGridSchema.Type;

// The SAME grid rule the attach carries. `resize` and `attach` describe one
// value with one meaning, reaching the same mutator, so they must not derive it
// twice — a bare `z.number()` here accepted a float or a negative that kaval
// rejected one hop later, leaving the boundary that KNOWS what a grid is as the
// one that didn't enforce it. Tightening rejects only values kaval already
// refused, so no working call changes behaviour; the loud failure just moves to
// the boundary that owns the concept.
export const PadiResizeInputSchema = Schema.Struct({
  ...EndpointGridSchema.fields,
  id: TerminalIdSchema,
});

export const PadiSendInputSchema = Schema.Struct({
  id: TerminalIdSchema,
  data: Schema.String,
});

// ── Standing settle-event subscriptions (`watch.*`) ───────────────────────
//
// A supervisor that is itself a kolu terminal needs none of this: padi delivers
// into its mailbox along the `parentId` edge. These verbs are for a supervisor
// that has NO terminal — a coding agent holding only an MCP connection — which
// the edge therefore cannot reach.
//
// The shape is padi's existing PULSE-THEN-REQUERY idiom (`subscribeRepoChange`):
// instant request/response verbs carry the data, and a stream carries only a
// doorbell. It is deliberately not a blocking `next` procedure — the buffer is
// authoritative and server-side, so a MISSED pulse costs a wait, never an event.

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

// ── The agent-STATE watch (`states` · `heldForMs` · `nagMs`) ────────────────
//
// The second event source behind the same standing subscriptions, and the whole
// of `kolu watch`'s supervision face. A settle event is an edge the DAEMON
// decides for you — "this terminal just started needing someone", with EF2's
// byte-quiet conjunct baked in. A state event answers the question the
// SUBSCRIBER asked instead: which agent buckets do I care about, how long must
// one HOLD before I hear about it, and how often should I be told AGAIN while it
// keeps holding.
//
// It reads the ADAPTER, never the bytes. `agentBucket` folds the state the
// agent's own adapter published; a quiet screen is not an idle agent — a grok
// sitting at an empty prompt repaints about once a second, which starved a
// byte-quiet gate forever (#2177). So `heldForMs` debounces the STATE, and no
// part of this feed consults output.
//
// The three knobs are ONE implementation (`attention/stateWatch.ts`) served to
// both faces: `kolu watch --states/--held-for/--nag` subscribes the
// {@link padiSurface} `watchStates` stream, an MCP orchestrator passes the same
// three as `watch.open` params. Neither face filters anything client-side.

/** The agent buckets a state watch may target — padi's own {@link WAIT_STATES}
 *  (the `agentBucket` fold's vocabulary minus `other`, which no real agent
 *  reaches), so this wire and `kolu wait --until` speak one word list rather
 *  than two that agree by luck. */
const WatchStateSchema = Schema.Literals(WAIT_STATES);

/** What a subscription that names NO states means — re-exported from the
 *  vocabulary leaf, where it sits beside the buckets it is drawn from and where
 *  a face's `--help` can read it without importing the wire. */
export { WATCH_DEFAULT_STATES };

/** The three knobs, declared ONCE and spread into both faces' inputs, so a CLI
 *  flag and an MCP param cannot mean different things.
 *
 *  ANNOTATE FIRST, CHECK SECOND on every field — `watch.open` is exposed to MCP
 *  as a RAW procedure, so these annotations are the only blurb an agent ever
 *  sees for them, and annotating an already-checked schema buries the text in an
 *  `allOf` branch no host reads (the trap `kolu-mcp`'s `MillisecondsSchema`
 *  documents). */
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
      // Bounded by the shared `setTimeout` ceiling: these arm real timers in the
      // daemon, and a value past it overflows to "fire immediately, forever".
      // Zero is a legal HOLD — report the transition the instant it happens.
    }).check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(MAX_TIMER_MS),
    ),
  ),
  nagMs: Schema.optionalKey(
    Schema.Number.annotate({
      description:
        "RE-report a terminal every this many milliseconds for as long as it keeps holding a matching state (milliseconds). Omit to be told once. This is what makes an ignored terminal come back instead of vanishing after one line.",
      // Zero is NOT a legal interval — a nag every 0 ms is a spin, so the
      // schema refuses it rather than a guard downstream.
    }).check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(MAX_TIMER_MS),
    ),
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
  /** Who spawned this terminal — lane attribution. Absent for a root terminal. */
  parentId: Schema.optionalKey(TerminalIdSchema),
  /** The terminal's freeform intent annotation, when set. */
  intent: Schema.optionalKey(Schema.String),
});
export type PadiStateEvent = typeof PadiStateEventSchema.Type;

/** Everything a standing subscription can hand over. ONE queue, discriminated by
 *  `kind`: a subscription is fed by exactly one source (the settle detector, or
 *  the state watch when it named any of the three knobs), and the six `kind`
 *  literals are disjoint, so a consumer branches on that one field and never has
 *  to ask which source it opened. */
export const PadiWatchEventSchema = Schema.Union([
  PadiSettleEventSchema,
  PadiStateEventSchema,
]);
export type PadiWatchEvent = typeof PadiWatchEventSchema.Type;

/** A subscription NAME — caller-chosen and stable across restarts, which is the
 *  point: re-opening the same name after the agent, the MCP process, or kaval
 *  restarted reattaches to the same queue instead of minting an empty one. */
/** The cap on a subscription name. Exported as the BOUND rather than as the
 *  checked schema: an MCP arg schema must annotate BEFORE it checks (or the
 *  blurb is buried in an `allOf` branch no host reads — see `kolu-mcp`'s
 *  `MillisecondsSchema`), so a face reuses this NUMBER and spells its own
 *  annotate-first schema over it. */
export const WATCH_NAME_MAX_LENGTH = 128;

const WatchNameSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(WATCH_NAME_MAX_LENGTH),
);

/** The knob set itself, as data — DERIVED from the one declaration above so a
 *  fourth knob is spelled once. Every "did the caller name a knob" question in
 *  the daemon and at both faces is asked of this (`namesWatchKnobs`), rather
 *  than by re-listing the three fields at each site and hoping every site is
 *  found again. */
export const WATCH_FILTER_KEYS = Object.keys(
  PadiWatchFilterFields,
) as readonly (keyof typeof PadiWatchFilterFields)[];

export const PadiWatchOpenInputSchema = Schema.Struct({
  name: WatchNameSchema,
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
  // Naming ANY of the three turns this subscription into an agent-STATE watch:
  // it is fed by `stateWatch` (snapshot · transition · nag) instead of the settle
  // detector (asking · finished · gone). Naming NONE leaves it exactly as it was.
  // One decision, made by the presence of a knob, so there is no mode flag to
  // contradict the knobs.
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
 *  The same three knobs as a standing subscription, plus the CLI's one optional
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

export const PadiScreenTextInputSchema = Schema.Struct({
  id: TerminalIdSchema,
  /** First line to capture (0-based, inclusive). Defaults to start of scrollback. */
  startLine: Schema.optionalKey(NonNegativeInt),
  /** Last line to capture (exclusive). Defaults to buffer length. */
  endLine: Schema.optionalKey(NonNegativeInt),
});

/** The most rows one `screen.image` will ever render.
 *
 *  A hard ceiling, not a default: the render cost and the pixel height both
 *  grow linearly with rows, and kolu retains 50,000 lines of scrollback, so an
 *  unbounded request is a way to ask the daemon for a 900,000-pixel-tall PNG.
 *
 *  The two ways to exceed it are answered DIFFERENTLY, because the questions
 *  differ. An explicit `lines` above the cap is REJECTED at the wire rather
 *  than truncated — a caller that asked for 5,000 rows and silently got 200
 *  would be shown a picture that is not the answer to its question. A
 *  `viewport` capture of a terminal taller than the cap (a very tall window)
 *  is TRIMMED to the last `SCREEN_IMAGE_MAX_ROWS` rows, because "show me the
 *  screen" is still answerable and its bottom is the part that matters — and
 *  the reply's own `rows` says how much was captured, so the trim is stated
 *  rather than hidden.
 *
 *  ROWS ONLY, on purpose. The other axis is not a caller's to name — there is
 *  no `cols` in this input, and a terminal's width is whatever its owner
 *  resized it to — so the width of a capture is bounded where the cells are
 *  READ, by kaval's area cap (`SCREEN_CELLS_MAX_CELLS`, `rows * cols`): a
 *  terminal both very tall and very wide comes back at fewer columns, leftmost
 *  kept. The reply's `cols` states that the same way `rows` states this trim.
 *  There is nothing to refuse on that axis and so nothing to check here.
 *
 *  This is kaval's `SCREEN_CELLS_MAX_ROWS` spelled a second time, and the
 *  duplication is deliberate — the same call `vocab.ts` makes for
 *  `PtyHostIdentitySchema` and `DaemonLifetimeInfoSchema`. This module is
 *  BROWSER-SAFE and the client value-imports it (`LOCAL_LOCATION`), while
 *  kaval's only entry is a barrel that re-exports `createPtyHost` — a
 *  `node-pty` child. Importing the constant from there to save a literal
 *  would put the PTY daemon in the browser's module graph, resting on a
 *  bundler's tree-shaking to take it back out again.
 *
 *  Two spellings CAN drift, and the drift is real: it would let a padi-legal
 *  `lines` die as a kaval decode error, collapsing the refuse-vs-trim split
 *  that is deliberate above. So the equality is PINNED by a test on the node
 *  side of the seal (`screenImage.test.ts`), where importing kaval costs
 *  nothing. A pinned duplicate beats an import that crosses a layer. */
export const SCREEN_IMAGE_MAX_ROWS = 200;

/** What a legal `lines` is: a whole count of rows, at least one, at most
 *  {@link SCREEN_IMAGE_MAX_ROWS} — as CHECKS, so a face can spread them onto
 *  its own base node.
 *
 *  Exported in this shape rather than as a finished schema because the MCP
 *  face must annotate a check-FREE base and add every check after (an
 *  annotation lands on the last check otherwise, where no host looks for a
 *  property description — `screenText.ts` states that law at length). Sharing
 *  the rule and honouring the law are both possible; sharing only the constant
 *  and re-spelling `integer ∧ > 0 ∧ ≤ MAX` per face is what left three copies
 *  of one decision. */
export const SCREEN_IMAGE_LINES_CHECKS = [
  Schema.isInt(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(SCREEN_IMAGE_MAX_ROWS),
] as const;

/** The same rule as a ready-made schema, for a face with nothing to annotate —
 *  which today is only this module's own `screen.image` input. Module-private
 *  rather than exported: a face that has something to annotate must spread
 *  {@link SCREEN_IMAGE_LINES_CHECKS} onto its own base node instead (the
 *  annotate-first law `screenText.ts` states at length), so an export here
 *  would be an invitation to get that wrong. */
const ScreenImageLinesSchema = Schema.Number.check(
  ...SCREEN_IMAGE_LINES_CHECKS,
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
  // `epoch` (3.1 · additive · optional) — the reflow generation the caller's
  // `before` cursor was seeded under (the attach snapshot's `reflowEpoch`). The
  // host returns an empty `stale` reply when a width reflow has since renumbered
  // absolute rows, so a client whose shared mirror a foreign resize reflowed
  // HALTS backfill rather than splices a duplicated/skipped band (F3). Omitted
  // by an older client — fail-open.
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
  // The SAME resume-intent pair `session.restore` declares — composed by field
  // spread (the repo's `.merge` successor, see vocab.ts's note) rather than a
  // third hand-copy of the decoding-default policy.
  ...PadiSessionRestoreInputSchema.fields,
});

// ── The surface ───────────────────────────────────────────────────────────

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
      // The one bus/wire dedup point: a binder that re-sends the same resolved
      // fact (any reconnect re-primes this memory-only cell) publishes nothing.
      equals: newTerminalPolicyEqual,
      verbs: ["get", "set"],
      client: { onError: { kind: "toast", label: "New-terminal policy" } },
    },
    /** The running kaval + padi daemons on THIS padi's host — the "Running daemons"
     *  leak diagnostic the Kaval + Padi dialogs list. Read-only on the client; padi's
     *  periodic host-inventory sampler (`hostInventory.ts`, wired into daemon boot)
     *  is the sole writer. Rides the re-served surface, so the dialog's bound-host
     *  list works identically whether kolu-server is bound locally or over ssh. */
    hostInventory: {
      schema: PadiHostInventorySchema,
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
      // 4C RULING: `hostToast` (not the old per-subscription split) — the chip gains
      // host attribution and a background host's daemon-status failure becomes a
      // host-named toast (the two srid-ruled deltas). Origin `{ key }` is guaranteed
      // for an entry member.
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
    /** The per-subscriber terminal byte stream — snapshot (serialized screen)
     *  as the first frame, then live output, 1:1 through each hop. DELTA/
     *  fail-through: the scrollback snapshot is ONLY ever the first frame of a
     *  fresh stream, so a mid-chain disconnect must terminate it (the client
     *  re-attaches end-to-end); the shipped overflow frame (#1591) rides it. */
    terminalAttach: {
      inputSchema: PadiTerminalAttachInputSchema,
      // A discriminated frame, not a bare string (contract) and not an optional
      // field: a `delta` is bytes to write; a `snapshot` frame (the first frame
      // and every overflow re-attach) also carries the absolute mirror-line
      // `topLine` seed for the client's scrollback-backfill cursor. Mirrors
      // kaval's own `TerminalDataMsg` union one hop up (see `TerminalAttachFrame`).
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
    /** Terminal lifecycle — create · kill · killAll · sleep · wake ·
     *  discardSleeping · resize · sendInput · recycleKaval. */
    lifecycle: {
      // Every create STATES its placement (`PadiCreateInputSchema`) — a tile of
      // its own, or a split of a named parent. The `child-of` arm's parent must
      // be a LIVE terminal, so `create` carries the same declared not-found as
      // the per-terminal verbs. A create that states NO placement is refused a
      // layer earlier, by the input schema itself, and never reaches this error
      // channel.
      create: {
        input: PadiCreateInputSchema,
        output: TerminalInfoSchema,
        error: TerminalNotFound,
      },
      kill: {
        input: PadiTerminalIdInputSchema,
        output: TerminalInfoSchema,
        error: TerminalNotFound,
      },
      killAll: {},
      // `sleep` is a no-op on anything that is not a live local terminal, and
      // `resize`/`sendInput` QUIET-DROP a write that lands just after a kill
      // (#1628 — an expected race). None of the three can refuse, so none
      // declares an error: an absent error channel is a statement, not an
      // omission.
      sleep: { input: PadiTerminalIdInputSchema },
      wake: {
        input: PadiTerminalIdInputSchema,
        output: TerminalInfoSchema,
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
        // The DECLARED error (SK6): a proven contract skew is the one failure
        // this procedure can translate — versions ride as TYPED fields on the
        // error itself (the client narrows on `_tag === "KavalContractSkew"`;
        // nothing re-parses prose). An undeclared throw stays a DEFECT — the
        // fail-fast channel for genuinely unexpected failures.
        //
        // Under oRPC this was an `errors: { KAVAL_CONTRACT_SKEW: { data } }`
        // map keyed by a magic code, constructed through an injected
        // `errors.<CODE>(...)` factory. `Rpc.make` takes ONE error schema, so
        // the code map collapses into the tagged class itself and the handler
        // simply FAILS with an instance.
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
     *  three narrow to an ACTIVE terminal (a dormant record has no live mirror
     *  to read), so all three declare {@link TerminalNotFound}. */
    screen: {
      state: {
        input: PadiTerminalIdInputSchema,
        output: Schema.String,
        error: TerminalNotFound,
      },
      text: {
        input: PadiScreenTextInputSchema,
        output: Schema.String,
        error: TerminalNotFound,
      },
      history: {
        input: PadiScreenHistoryInputSchema,
        output: PadiScreenHistoryOutputSchema,
        error: TerminalNotFound,
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
        error: TerminalNotFound,
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
        error: FsGitReadErrorSchema,
      },
      getDiff: {
        input: GitDiffInputSchema,
        output: GitDiffOutputSchema,
        error: FsGitReadErrorSchema,
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
     *  ({@link TerminalNotFound}) and re-enforces the extension allowlist +
     *  size cap ({@link ScratchWriteRejected}). */
    scratch: {
      write: {
        input: PadiScratchWriteInputSchema,
        output: PadiScratchWriteOutputSchema,
        error: Schema.Union([TerminalNotFound, ScratchWriteRejected]),
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
        // Fail-fast, never a silent truncation: an unranged read whose body
        // would exceed the inline cap is REFUSED, and the refusal names the
        // cap so the caller can compute a range from it.
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
          TerminalNotFound,
          TranscriptNoAgent,
          TranscriptNotFound,
        ]),
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
      // Output-less, like `session.import` and for the same reason (the 5.1
      // ledger note): the client restores a blob it just picked and seeds no
      // view from the call, so an active-marker answer would be shape nothing
      // reads.
      restore: { input: PadiBackupsRestoreInputSchema },
    },
  },
});

export type PadiSurfaceSpec = (typeof padiSurface)["spec"];
type PadiSF = SurfaceTypes<typeof padiSurface.spec>;

/** The `terminals` collection key — a terminal id. */
export type PadiTerminalKey = PadiSF["collections"]["terminals"]["Key"];

// ── Per-member forwarding policy (W1.C declares; W2.1's helpers read) ──────

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
  // cells
  version: "value",
  identity: "value",
  urgency: "value",
  status: "value",
  newTerminalPolicy: "value",
  hostInventory: "value",
  processMemory: "value",
  activityFeed: "value",
  // collections
  terminals: "value",
  daemonStatus: "value",
  // streams — `activity`, `terminalAttach` and `watchStates` are the delta
  // members: each one's first frame is a fresh snapshot the consumer builds on,
  // so a rebind must terminate the downstream stream rather than replay a value.
  activity: "delta",
  watchStates: "delta",
  // A doorbell carries no accumulated state — each pulse stands alone and the
  // caller requeries, so it forwards as a value like the other pulse streams.
  watchPulse: "value",
  subscribeRepoChange: "value",
  subscribeFileChange: "value",
  terminalAttach: "delta",
  // events
  terminalExit: "value",
  // procedure namespaces
  lifecycle: "value",
  chrome: "value",
  screen: "value",
  fs: "value",
  git: "value",
  scratch: "value",
  preview: "value",
  transcript: "value",
  watch: "value",
  // `session` is a cell (get/set) AND a procedure namespace (restore/import),
  // merged onto one wire node — this single entry annotates the merged member.
  session: "value",
  backups: "value",
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

// ── The frozen control core (defined W1.C; served for real W2.2) ──────────

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

/** The two surfaces the padi daemon serves on its socket: the versioned
 *  `padiSurface` at `surface.padi.*`, and the frozen control core at
 *  `surface.control.*`. One keyed map, consumed by `implementSurfaces` (server)
 *  and `composeSurfaceContracts` (the binder's wire contract) so the two stay in
 *  lock-step. */
export const padiDaemonSurfaces = {
  padi: padiSurface,
  control: padiControlSurface,
} as const;

/** The combined wire the padi daemon serves — ONE flat `RpcGroup` carrying both
 *  siblings' tags (`surface/padi/*` + `surface/control/*`), plus the per-sibling
 *  `Surface` values a client builds its faces from.
 *
 *  Composition is the framework's SIBLING algebra (S1/D1): each surface is
 *  re-walked under its own `surface/<key>/` tag prefix, never `RpcGroup.merge`d
 *  — a bare merge is a last-writer-wins `Map.set`, and both siblings carry the
 *  same three reserved `system/*` tags, so merging would silently leave one
 *  sibling's liveness probe answering for the other's. The prefix makes that
 *  collision class unrepresentable; {@link PADI_DAEMON_TAG_COUNT} makes the
 *  absence of any OTHER collision an assertion rather than an assumption. */
export const padiDaemonContract = composeSurfaceContracts(padiDaemonSurfaces);
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

/** The exact number of tags a padi daemon serves — the D1/#16 collision assert.
 *  `RpcGroup.make`/`merge` are silent last-writer-wins `Map.set`s, so a tag
 *  minted twice would vanish without a word; comparing the composed group's
 *  size against the two siblings' own sizes is what PROVES the composition
 *  dropped nothing. Asserted at IMPORT (below) so a collision is a boot crash,
 *  never a 404 discovered in production, and pinned as a literal key set by
 *  `surface.test.ts`. */
export const PADI_DAEMON_TAG_COUNT =
  padiSurface.group.requests.size + padiControlSurface.group.requests.size;

if (padiDaemonGroup.requests.size !== PADI_DAEMON_TAG_COUNT) {
  throw new Error(
    `padiDaemonContract: composed ${padiDaemonGroup.requests.size} tags but the two siblings declare ${PADI_DAEMON_TAG_COUNT} — a tag was minted twice and silently overwritten`,
  );
}

// The composed sibling registry (`surfacesWithPadi = { ...surfaces, padi }`)
// lives in `kolu-common/surface` now, NOT here: composing the app's `surfaces`
// with padi's authored surface is an APP concern, and building it here would
// force padi to import the app's `surfaces` registry — the exact backwards
// arrow the seal forbids. `@kolu/padi` exports `padiSurface`; the app assembles
// the registry FROM it.
