/**
 * `@kolu/padi/surface` — the BROWSER-SAFE face of `@kolu/padi`: `padiSurface`
 * 1.0 (the zod contract the client will import), the per-member forwarding-policy
 * annotations, and the frozen control-core types.
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
 * W2.2. It lives HERE (not `@kolu/surface-daemon`) and graduates only if a
 * second daemon ever adopts it (electricity test ③: proof before extraction).
 *
 * BROWSER-SAFE face: like `koluSurface` this imports
 * only `@kolu/surface/define`, zod-only schema modules (its own `./vocab.ts` +
 * `./transcriptSchema.ts`, `kolu-git/schemas`, `@kolu/terminal-vocab/schema`),
 * and `zod` — no `node:`/kaval runtime (that lives beside this, in the node-only
 * side the motion stage adds). The terminal VOCABULARY now lives HERE (`./vocab.ts`,
 * re-exported below): the arrow points `kolu-common → @kolu/padi`, never back. The
 * one remaining edge into kolu-common is the `surfaces` config registry (the
 * coordinator restructures that next).
 */

import {
  composeSurfaceContracts,
  defineSurface,
  defineSurfaceWithPolicy,
  type SurfaceTypes,
} from "@kolu/surface/define";
import type { ClientErrorPolicy } from "./clientPolicy.ts";
import {
  FsFileInputSchema,
  FsReadFileTextOutputSchema,
  RepoChangePulseSchema,
  TerminalIdSchema,
} from "@kolu/terminal-vocab/schema";
import {
  FsListAllInputSchema,
  FsListAllOutputSchema,
  GitDiffInputSchema,
  GitDiffOutputSchema,
  GitStatusInputSchema,
  GitStatusOutputSchema,
  WorktreeCreateInputSchema,
  WorktreeCreateOutputSchema,
  WorktreeRemoveInputSchema,
} from "kolu-git/schemas";
import { z } from "zod";
import {
  ExportTranscriptHtmlInputSchema,
  ExportTranscriptHtmlOutputSchema,
} from "./transcript/transcriptSchema.ts";
import {
  CanvasLayoutSchema,
  RightPanelPerTerminalStateSchema,
} from "./chromeVocab.ts";
import {
  ActiveTerminalSchema,
  ActivityFeedSchema,
  DaemonStatusSchema,
  DEFAULT_PADI_PROCESS_MEMORY,
  CreateTerminalInputSchema,
  DaemonLifetimeInfoSchema,
  KavalSkewVersionsSchema,
  KoluAuthoredFieldsSchema,
  PadiProcessMemorySchema,
  ParkedDiscriminantSchema,
  PersistedSnapshotSchema,
  PtyHostIdentitySchema,
  SavedSessionSchema,
  SleepingTerminalSchema,
  TerminalInfoSchema,
  TerminalOnExitOutputSchema,
} from "./vocab.ts";

// The terminal VOCABULARY (schemas · records · pure helpers) now lives HERE, in
// `@kolu/padi` — the terminal-domain authority. Re-exported from this browser-safe
// entry so consumers reach the schemas as `@kolu/padi/surface`. The UI-chrome half
// (`./chromeVocab.ts`, split out in L17) rides the same entry, so the export set is
// unchanged — a chrome schema is still `@kolu/padi/surface`'s to give.
export * from "./chromeVocab.ts";
export * from "./vocab.ts";
// kolu's app-owned client-error-policy union (SR11) — declared here (not kolu-common)
// so `padiSurface`'s per-host members below can reference it without `@kolu/padi`
// importing `kolu-common` (the seal forbids that arrow); `kolu-common/surface`
// re-exports it for `koluSurface` and the client. See `./clientPolicy.ts`.
export type { ClientErrorPolicy, ToastOnlyPolicy } from "./clientPolicy.ts";

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
 *  reshape itself is in `@kolu/terminal-vocab` ports vocabulary, with the reason. */
export const PADI_SURFACE_VERSION = "4.3";

/** The `version` cell payload — padi's self-declared surface contract version. */
export const PadiVersionSchema = z.object({ contractVersion: z.string() });
export type PadiVersion = z.infer<typeof PadiVersionSchema>;

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
export const PadiIdentitySchema = z.object({
  commit: z.string().nullable(),
  surfaceVersion: z.string(),
  startedAt: z.number(),
  /** padi's lifetime policy (`forever` in production; `boundToPid` under a
   *  test/smoke run) — surfaced for the Padi dialog's lifetime row. A live padi
   *  seeds it synchronously at boot, so a subscriber sees the real value from the
   *  first frame; OPTIONAL only so a binder reading a survivor padi that predates
   *  the field parses without a forced drain (the reader falls back to "—"). */
  lifetime: DaemonLifetimeInfoSchema.optional(),
});
export type PadiIdentity = z.infer<typeof PadiIdentitySchema>;

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
export const PadiStatusSchema = z.object({
  expectedKaval: PtyHostIdentitySchema.optional(),
});
export type PadiStatus = z.infer<typeof PadiStatusSchema>;

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
// runtime dir, read each gate pid, best-effort probe status — it NEVER kills/reaps.
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

export const RunningKavalSchema = z.object({
  /** The rendezvous socket path — the pasteable `--socket` value. */
  socket: z.string(),
  /** Discovery's human label ("standalone kaval" | "kolu @ <state-root>" |
   *  "kolu-server on port <port>"), decided at discovery's matching branch. */
  label: z.string(),
  /** The structural kind: `stateRoot` (a padi's kaval — carries a state-root
   *  manifest, incl. an ADOPTED legacy-address kaval), `port` (an UN-adopted legacy
   *  `kaval-<port>/` with NO manifest — a genuine stray/leak), `standalone`, or
   *  `unknown`. */
  kind: z.enum(["stateRoot", "port", "standalone", "unknown"]),
  /** The gate-holder pid (`kaval.pid`), or null if unreadable. */
  gatePid: z.number().int().nullable(),
  /** Live terminal count from a best-effort `terminal.list` probe, or null when the
   *  probe failed / the daemon didn't answer (never a fake 0). */
  terminalCount: z.number().int().nullable(),
  /** The kaval's build commit (`navigableCommit`) from a best-effort `system.version`
   *  probe, or null when unreadable. */
  buildCommit: z.string().nullable(),
  /** The pty-host contract version from the probe, or null when unreadable. */
  contractVersion: z.string().nullable(),
  /** Whether the scanning host's kolu ACTIVELY owns this kaval ("in use by kolu"), and —
   *  when it does — whether it sits at the pre-padi LEGACY `kaval-<port>/` address (padi
   *  ADOPTED a live pre-W2.2 kaval on upgrade rather than leaking it — a KNOWN converging
   *  state, not a leak, until the next recycle spawns it at the digest address).
   *
   *  A discriminated pair, NOT two independent booleans: `atLegacyAddress` exists ONLY on
   *  the `active` arm, so the nonsense "legacy-but-not-owned" state is UNREPRESENTABLE
   *  (P4). Only the host serving its OWN `hostInventory` marks `active` — a local-machine
   *  scan under a remote binding is always `{ active: false }` (kolu is bound elsewhere). */
  held: z.discriminatedUnion("active", [
    z.object({ active: z.literal(false) }),
    z.object({ active: z.literal(true), atLegacyAddress: z.boolean() }),
  ]),
});
export type RunningKaval = z.infer<typeof RunningKavalSchema>;

export const RunningPadiSchema = z.object({
  /** padi's rendezvous socket path. */
  socket: z.string(),
  /** padi's state-root (from the digest→root manifest), or null if unreadable. */
  stateRoot: z.string().nullable(),
  /** The gate-holder pid (`padi.pid`), or null if unreadable. */
  gatePid: z.number().int().nullable(),
  /** True iff this is the padi the scanning host's kolu owns ("in use by kolu"). The
   *  active padi's contract version + build commit do NOT ride this row — padi cannot
   *  probe a foreign padi, so every non-active row would carry nulls; the one bound
   *  padi's identity is published once on `daemonInventory.boundPadi` (the honest
   *  fresh-each-tick live read that also works over ssh). */
  active: z.boolean(),
});
export type RunningPadi = z.infer<typeof RunningPadiSchema>;

/** One host's daemon inventory — every running kaval + padi on a single machine. The ONE
 *  container both `padiSurface.hostInventory` (the bound host's own scan) and
 *  `kolu-common/surface`'s `daemonInventory.localScan` (kolu-server's local-machine scan)
 *  compose, so the scanner returns one neutral shape, not two lockstep copies. */
export const HostDaemonInventorySchema = z.object({
  kavals: z.array(RunningKavalSchema),
  padis: z.array(RunningPadiSchema),
});
export type HostDaemonInventory = z.infer<typeof HostDaemonInventorySchema>;

/** The `hostInventory` cell payload — the bound padi's scan of its OWN host, riding the
 *  re-served surface so the dialog's bound-host list works identically local and remote.
 *  Structurally {@link HostDaemonInventorySchema} (the same shape kolu-server's local
 *  scan uses). */
export const PadiHostInventorySchema = HostDaemonInventorySchema;
export type PadiHostInventory = z.infer<typeof PadiHostInventorySchema>;

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
export const PadiHostAxisSchema = z.object({
  /** The host a dock row belongs to, for the cross-host dock. Undefined on a
   *  single-host canvas (W1–W3) — never populated until the W4 aggregation. */
  host: z.string().optional(),
});

/** The active arm — the full live `TerminalMetadata` active record + the
 *  reserved host axis. */
export const PadiActiveTerminalSchema =
  ActiveTerminalSchema.merge(PadiHostAxisSchema);

/** The sleeping arm — the restore-relevant sleeping record + the host axis. */
export const PadiSleepingTerminalSchema =
  SleepingTerminalSchema.merge(PadiHostAxisSchema);

/** The parked arm — the restore-relevant persisted projection + the shared
 *  authored fields + the `parked` discriminant + the host axis. Built from the
 *  SAME `PersistedSnapshotSchema` + `KoluAuthoredFieldsSchema` base the
 *  `sleeping` arm uses, so the three arms can't drift on the authored shape. */
export const PadiParkedTerminalSchema = PersistedSnapshotSchema.merge(
  KoluAuthoredFieldsSchema,
)
  .merge(ParkedDiscriminantSchema)
  .merge(PadiHostAxisSchema);

/** The `parked` arm as a standalone type — the reboot-killed active record padi
 *  parks at boot. Exported so a client type-guard (`isParked` in
 *  `useTerminalMetadata.ts`) can narrow the composed `PadiTerminal` union to it
 *  at the single client bridge, instead of re-deriving a widened `.state` cast. */
export type PadiParkedTerminal = z.infer<typeof PadiParkedTerminalSchema>;

/** The composed terminal record padi serves — `active | sleeping | parked`,
 *  discriminated on `state`. The server-side `authored ⋈ snapshot` join
 *  (`composeTerminalMetadata`) produces the `active`/`sleeping` arms; `parked`
 *  is reserved (W1.R produces it). Supersedes the client-side reader-join: one
 *  writer composes both halves, so no fold crosses a wire. */
export const PadiTerminalSchema = z.discriminatedUnion("state", [
  PadiActiveTerminalSchema,
  PadiSleepingTerminalSchema,
  PadiParkedTerminalSchema,
]);
export type PadiTerminal = z.infer<typeof PadiTerminalSchema>;

/** The active arm as a standalone type — the live record a WIRE reader gets. */
export type PadiActiveTerminal = z.infer<typeof PadiActiveTerminalSchema>;

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

// ── The urgency projection (recency-free) ─────────────────────────────────

/** The recency-FREE urgency fold off the registry: how many terminals await
 *  the user, and which. The ONE thing kolu-server reads from every warm binding
 *  (for cross-host badge fan-in), so it deliberately carries ids and NO
 *  recency — nothing cross-host ever compares two hosts' clocks. No separate
 *  count: a count that could disagree with `awaitingIds` is a second source of
 *  truth for one fact, so the count is DERIVED at every read site as
 *  `awaitingIds.length` (see `HostSelectorStrip.tsx`'s `awaiting()`), never
 *  carried on the wire. */
export const PadiUrgencySchema = z.object({
  /** The ids of the terminals whose agent is awaiting the user
   *  (`awaiting_user`) — for a badge deep-link to focus one, and for the badge
   *  COUNT (`.length`), read at the consumer, never duplicated here. */
  awaitingIds: z.array(TerminalIdSchema),
  /** The ids of the terminals whose agent just FINISHED its turn and is idling
   *  (`waiting`) — the other half of the attention model. Carried so the ONE
   *  cross-host attention owner (`useAttention`) applies the SAME rules to a
   *  finished agent on a background host as on the active one (fire once if
   *  unseen, quiet host-tab mark), instead of a finish being legible only on the
   *  host you're looking at. Recency-free like `awaitingIds`.
   *
   *  `.default([])` for ROLLING-DEPLOY safety: a newer client reading an OLDER
   *  padi's `urgency` frame (which predates this field) parses it as `[]` rather
   *  than failing validation and breaking the whole cell — asking keeps working,
   *  and finishes light up the moment that host's padi catches up. */
  finishedIds: z.array(TerminalIdSchema).default([]),
  /** The ids of the terminals whose agent is WORKING (thinking / tools /
   *  background) — the third leg of the host-tab attention summary (working ·
   *  needs-you · unseen), carried so a background host's tab can say "3 agents
   *  in flight" without mirroring its full terminals collection. Ids, not a
   *  count, per the no-second-source law above (`.length` at the consumer).
   *  `.default([])` for the same rolling-deploy safety as `finishedIds`. */
  workingIds: z.array(TerminalIdSchema).default([]),
  /** The ids of the terminals whose agent ended its turn but has NOT yet gone
   *  effectively quiet (`waiting` ∧ ¬EF2) — the lingering tail an agent leaves
   *  while its last output is still landing. Carried because ACTIVITY, not
   *  `working`, is what every attention surface actually means: the pip keeps
   *  MOVING through this window (`attentionActive`'s `linger` leg), so a host tab that
   *  counted only `workingIds` would show nothing beside a terminal visibly
   *  still going — the exact paint/count disagreement this cell exists to
   *  prevent. Disjoint from `finishedIds` by construction (a waiting agent is
   *  in exactly one of the two), so a consumer can add the lists without
   *  de-duplicating. `.default([])` for the same rolling-deploy safety. */
  lingerIds: z.array(TerminalIdSchema).default([]),
});
export type PadiUrgency = z.infer<typeof PadiUrgencySchema>;

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

/** Create input — the BASE `CreateTerminalInputSchema` (client chrome) plus `cwd` /
 *  `parentId`. It derives from the base DIRECTLY rather than subtracting the three
 *  server-derived authored facts, so the exclusion is structural, not a maintained
 *  omit list: a future field added to `RestoreOnlyMetadataSchema` can never leak to
 *  the wire by someone forgetting to extend an omit. A fresh terminal has no truth
 *  about `lastActivityAt` / `lastAgentCommand` / `restoreTarget` (the fold derives
 *  them from its own observation); `session.restore` threads them from the saved blob
 *  through `restoreSpawn`'s distinct `restoreOnly` arm, never this input. */
export const PadiCreateInputSchema = z
  .object({
    cwd: z.string().optional(),
    parentId: TerminalIdSchema.optional(),
  })
  .merge(CreateTerminalInputSchema);

/** A bare terminal-id input — kill/sleep/wake/discardSleeping/screen.state. */
export const PadiTerminalIdInputSchema = z.object({ id: TerminalIdSchema });

export const PadiResizeInputSchema = z.object({
  id: TerminalIdSchema,
  cols: z.number(),
  rows: z.number(),
});

export const PadiSendInputSchema = z.object({
  id: TerminalIdSchema,
  data: z.string(),
});

export const PadiSetThemeInputSchema = z.object({
  id: TerminalIdSchema,
  themeName: z.string().min(1),
});

export const PadiSetIntentInputSchema = z.object({
  id: TerminalIdSchema,
  /** Empty string clears the intent; any non-empty string sets it. */
  intent: z.string(),
});

export const PadiSetParentInputSchema = z.object({
  id: TerminalIdSchema,
  parentId: TerminalIdSchema.nullable(),
});

export const PadiSetActiveInputSchema = z.object({
  id: TerminalIdSchema.nullable(),
});

export const PadiSetCanvasLayoutInputSchema = z.object({
  id: TerminalIdSchema,
  layout: CanvasLayoutSchema,
});

export const PadiSetSubPanelInputSchema = z.object({
  id: TerminalIdSchema,
  collapsed: z.boolean(),
  panelSize: z.number(),
});

export const PadiSetRightPanelInputSchema =
  RightPanelPerTerminalStateSchema.extend({ id: TerminalIdSchema });

export const PadiScreenTextInputSchema = z.object({
  id: TerminalIdSchema,
  /** First line to capture (0-based, inclusive). Defaults to start of scrollback. */
  startLine: z.number().int().nonnegative().optional(),
  /** Last line to capture (exclusive). Defaults to buffer length. */
  endLine: z.number().int().nonnegative().optional(),
});

/** `screen.history` — the client's scrollback-backfill read. `before` is the
 *  caller's absolute mirror-line cursor (the attach snapshot's `topLine`, then
 *  each reply's `topLine`); the host serves up to `max` older rows above it. */
export const PadiScreenHistoryInputSchema = z.object({
  id: TerminalIdSchema,
  before: z.number().int().nonnegative().optional(),
  max: z.number().int().positive(),
  // `epoch` (3.1 · additive · optional) — the reflow generation the caller's
  // `before` cursor was seeded under (the attach snapshot's `reflowEpoch`). The
  // host returns an empty `stale` reply when a width reflow has since renumbered
  // absolute rows, so a client whose shared mirror a foreign resize reflowed
  // HALTS backfill rather than splices a duplicated/skipped band (F3). Omitted
  // by an older client — fail-open.
  epoch: z.number().int().nonnegative().optional(),
});

/** What `screen.history` returns — mirrors kaval's `getHistory` output as a
 *  `chunk | stale` DISCRIMINATED UNION (invalid-states-unrepresentable; like this
 *  surface's own attach `snapshot|delta` frame). The `chunk` arm is VT bytes
 *  replayed at the live width with the next `topLine` cursor and an `exhausted`
 *  flag; the `stale` arm (reachable only when the caller sent `epoch`) says the
 *  mirror reflowed and the caller must HALT until re-seed (F3). */
export const PadiScreenHistoryOutputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("chunk"),
    chunk: z.string(),
    topLine: z.number().int().nonnegative(),
    exhausted: z.boolean(),
  }),
  z.object({ kind: z.literal("stale") }),
]);

/** `scratch.write` — write base64 bytes into a terminal's on-disk scratch dir
 *  (the write half the paste/upload procedures build on). Returns the on-disk
 *  path so the caller can bracketed-paste it into the PTY. */
export const PadiScratchWriteInputSchema = z.object({
  terminalId: TerminalIdSchema,
  /** Filename as dropped; sanitized to its safe basename before writing. */
  name: z.string().min(1),
  /** Base64-encoded file bytes. */
  data: z.string(),
});
export const PadiScratchWriteOutputSchema = z.object({
  /** The on-disk path the bytes landed at, inside the terminal's scratch dir. */
  path: z.string(),
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
export const PadiPreviewReadInputSchema = z.object({
  repoPath: z.string(),
  filePath: z.string(),
  /** Raw HTTP `Range` header value (e.g. `"bytes=0-1023"`); omitted = whole
   *  file. Parsed exactly as `@kolu/serve-dir`'s `parseByteRange`, so a
   *  satisfiable single range answers 206, an unsatisfiable one 416, and a
   *  multi-range / malformed header collapses to a full 200. */
  range: z.string().optional(),
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
export const PadiRepoRootForTerminalInputSchema = z.object({
  terminalId: TerminalIdSchema,
});
export const PadiRepoRootForTerminalOutputSchema = z.object({
  /** The terminal's git repo root, or `null` when it has none / is unknown. */
  repoRoot: z.string().nullable(),
});

export const PadiPreviewReadOutputSchema = z.object({
  /** HTTP status — `200` | `206` (ranged) | `400` | `403` | `404` | `416` |
   *  `500`, verbatim from `serveFile`. */
  status: z.number().int(),
  /** Response headers verbatim from serve-dir (`Content-Type`, `Accept-Ranges`,
   *  `X-Content-Type-Options`, `Cache-Control`, a strong `ETag` on every 200/206,
   *  and `Content-Range` on a 206/416). The client replays them onto the
   *  reconstructed `Response`; the re-serving preview arm reads the `ETag` back to
   *  pin the file snapshot across a multi-chunk reassembly. */
  headers: z.record(z.string(), z.string()),
  /** Base64-encoded response body — the (possibly ranged) file bytes on a
   *  200/206, the plain-text reason on a 400/403/404/416/500. */
  bodyBase64: z.string(),
});

/** `session.restore` — restore the persisted session server-side (padi's boot
 *  reconcile + restore, replacing the client respawn loop in W1.R). `resumeIds`
 *  is the per-terminal agent-resume opt-in set; a terminal absent from it wakes
 *  to a bare shell. */
export const PadiSessionRestoreInputSchema = z.object({
  /** Ids whose captured agent should be resumed. Absent = resume all. */
  resumeIds: z.array(z.string()).optional(),
});

/** `session.import` — replace the persisted session with an imported blob (the
 *  diagnostic "Import session" flow, moved host-side), then restore it. */
export const PadiSessionImportInputSchema = z.object({
  session: SavedSessionSchema,
  /** Ids whose captured agent should be resumed. Absent = resume all. */
  resumeIds: z.array(z.string()).optional(),
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
     *  honest three-way {@link ProcessRssSchema}. padi owns kaval now, so padi is
     *  the source of this pair; its periodic sampler (wired into daemon boot) is the
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
      default: { recentRepos: [], recentAgents: [] } satisfies z.infer<
        typeof ActivityFeedSchema
      >,
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
      schema: SavedSessionSchema.nullable(),
      default: null as z.infer<typeof SavedSessionSchema> | null,
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
      keySchema: z.string(),
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
      inputSchema: z.object({}),
      outputSchema: z.array(TerminalIdSchema),
    },
    /** Live change-pulses for a repo's working tree + git dir. Value-bearing
     *  pulse-then-requery: a `{seq}` distinguisher, no fs/git data on the pulse. */
    subscribeRepoChange: {
      inputSchema: z.object({ repoPath: z.string() }),
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
      inputSchema: PadiTerminalIdInputSchema,
      // A discriminated frame, not a bare string (contract) and not an optional
      // field: a `delta` is bytes to write; a `snapshot` frame (the first frame
      // and every overflow re-attach) also carries the absolute mirror-line
      // `topLine` seed for the client's scrollback-backfill cursor. Mirrors
      // kaval's own `TerminalDataMsg` union one hop up (see `TerminalAttachFrame`).
      outputSchema: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("delta"), data: z.string() }),
        z.object({
          kind: z.literal("snapshot"),
          data: z.string(),
          topLine: z.number().int().nonnegative(),
          // `reflowEpoch` (3.1 · additive · optional) — the mirror's reflow
          // generation this snapshot was serialized under; the client re-seeds
          // its backfill epoch from it so a foreign-resize reflow halts backfill
          // rather than corrupts it (F3). Absent from a kaval predating 5.2.
          reflowEpoch: z.number().int().nonnegative().optional(),
        }),
      ]),
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
    /** Terminal lifecycle — create · kill · killAll · sleep · wake ·
     *  discardSleeping · resize · sendInput · recycleKaval. */
    lifecycle: {
      create: { input: PadiCreateInputSchema, output: TerminalInfoSchema },
      kill: { input: PadiTerminalIdInputSchema, output: TerminalInfoSchema },
      killAll: {},
      sleep: { input: PadiTerminalIdInputSchema },
      wake: { input: PadiTerminalIdInputSchema, output: TerminalInfoSchema },
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
        // The DECLARED error union (SK6): a proven contract skew is the one
        // failure this procedure can translate — versions ride as TYPED data
        // (the client narrows with `isDefinedError`; nothing re-parses prose),
        // shaped by the ONE skew-payload spelling (`KavalSkewVersionsSchema`,
        // shared with the `incompatible` status arm). An undeclared throw
        // still crosses as INTERNAL_SERVER_ERROR — the fail-fast channel for
        // genuinely unexpected failures.
        errors: {
          KAVAL_CONTRACT_SKEW: {
            data: KavalSkewVersionsSchema,
          },
        },
      },
    },
    /** Terminal chrome — the client-owned per-terminal UI record. */
    chrome: {
      setTheme: { input: PadiSetThemeInputSchema },
      setIntent: { input: PadiSetIntentInputSchema },
      setParent: { input: PadiSetParentInputSchema },
      setActive: { input: PadiSetActiveInputSchema },
      setCanvasLayout: { input: PadiSetCanvasLayoutInputSchema },
      setSubPanel: { input: PadiSetSubPanelInputSchema },
      setRightPanel: { input: PadiSetRightPanelInputSchema },
    },
    /** Screen reads — the serialized screen + a scrollback text slice. */
    screen: {
      state: { input: PadiTerminalIdInputSchema, output: z.string() },
      text: { input: PadiScreenTextInputSchema, output: z.string() },
      history: {
        input: PadiScreenHistoryInputSchema,
        output: PadiScreenHistoryOutputSchema,
      },
    },
    /** Filesystem reads scoped to a repo on the serving host. */
    fs: {
      listAll: { input: FsListAllInputSchema, output: FsListAllOutputSchema },
      readFile: {
        input: FsFileInputSchema,
        output: FsReadFileTextOutputSchema,
      },
      filePreviewTag: { input: FsFileInputSchema, output: z.string() },
    },
    /** Git reads + worktree mutations scoped to a repo on the serving host — a
     *  worktree materializing on the wrong machine is unspellable. */
    git: {
      getStatus: { input: GitStatusInputSchema, output: GitStatusOutputSchema },
      getDiff: { input: GitDiffInputSchema, output: GitDiffOutputSchema },
      worktreeCreate: {
        input: WorktreeCreateInputSchema,
        output: WorktreeCreateOutputSchema,
      },
      worktreeRemove: { input: WorktreeRemoveInputSchema },
    },
    /** Byte writes — the scratch write half of paste/upload. */
    scratch: {
      write: {
        input: PadiScratchWriteInputSchema,
        output: PadiScratchWriteOutputSchema,
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
      },
    },
    /** Session restore/import/forfeit — executes host-side (padi as one writer). */
    session: {
      restore: { input: PadiSessionRestoreInputSchema },
      import: { input: PadiSessionImportInputSchema },
      /** Explicitly discard the pending restore — drop the parked restore-card
       *  entries AND clear the saved session together. The deliberate "start fresh"
       *  act (the restore card's dismiss), distinct from `restore` (consumes) and
       *  `lifecycle.create` (which no longer forfeits). Takes no input. */
      forfeit: { input: z.object({}) },
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
 *     a live stream as bytes). Only `activity` and `terminalAttach`. */
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
  hostInventory: "value",
  processMemory: "value",
  activityFeed: "value",
  // collections
  terminals: "value",
  daemonStatus: "value",
  // streams — `activity` + `terminalAttach` are the ONLY delta members
  activity: "delta",
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
  // `session` is a cell (get/set) AND a procedure namespace (restore/import),
  // merged onto one wire node — this single entry annotates the merged member.
  session: "value",
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
export const CONTROL_CORE_VERSION = "1.0";

/** `hello` — the identity handshake a binder reads first: who this padi is and
 *  what `padiSurface` version it serves. Version-agnostic (part of the frozen
 *  core), so a skewed binder still learns the running version to decide
 *  upgrade-me vs drain-you. */
export const PadiHelloSchema = z.object({
  /** The padi's identity — its state-root (the `(host, state-root)` identity). */
  stateRoot: z.string(),
  /** The `padiSurface` `major.minor` this padi serves (e.g. "1.0"). */
  surfaceVersion: z.string(),
  /** The frozen control-core version this padi speaks (always "1.0" today). */
  controlCoreVersion: z.string(),
  /** padi's boot time (ms epoch), stamped once at daemon init — the binder reads
   *  it for HONEST uptime (never `Date.now()` at dial time, which would reset the
   *  age on every reconnect). Additive to the frozen core's initial served shape
   *  (the core has never shipped served), so `CONTROL_CORE_VERSION` stays "1.0". */
  startedAt: z.number(),
  /** padi's navigable git commit (`PADI_COMMIT_HASH`) — the RUNNING padi's build,
   *  which the binder surfaces as the Padi dialog's "build commit" (mirroring the
   *  Kaval dialog's, whose commit rides kaval's `system.version.identity`). padi's
   *  socket serves no `system.version`-style member, so the hello is padi's identity
   *  channel; the binder already reads it. Additive like `startedAt` (core never
   *  shipped served → `CONTROL_CORE_VERSION` stays "1.0"), but OPTIONAL — a survivor
   *  padi predating the field omits it and STILL handshakes (its hello validates),
   *  reading as the honest "—" rather than breaking the bind. Empty `""` off-nix. */
  commit: z.string().optional(),
  /** padi's staleKey (`PADI_BUILD_ID`) — the content hash of padi's daemon source
   *  closure, which flips iff a restart would load DIFFERENT daemon code. This is the
   *  binder's build-convergence key (#1670): a binder compares it against its OWN baked
   *  `PADI_BUILD_ID` and, on a same-contract mismatch, drains the survivor once at boot
   *  and respawns its own build. Distinct from `commit` — the git ref is navigable but
   *  does NOT capture the closure (two builds off one commit can differ; one commit can
   *  change nothing padi runs). Additive like `commit` (the frozen core has never
   *  shipped served → `CONTROL_CORE_VERSION` stays "1.0"), and OPTIONAL so a survivor
   *  padi predating the field STILL handshakes. But an ABSENT id is NOT "adopt anyway":
   *  a nix-built binder (which always bakes its own `PADI_BUILD_ID`) reads a missing id
   *  as "this padi predates the field, so it is by definition an OLDER build" and DRAINS
   *  it — otherwise the fix would fail to fire on the very first upgrade past a pre-field
   *  padi (exactly the deploy it exists for). Only an OFF-NIX binder (its own id `""`)
   *  never drains on build grounds — it cannot judge builds. Empty `""` off-nix. */
  buildId: z.string().optional(),
});
export type PadiHello = z.infer<typeof PadiHelloSchema>;

/** `version` — the control core's own version probe (just the frozen core
 *  version), distinct from the surface `version` cell. */
export const PadiControlVersionSchema = z.object({
  controlCoreVersion: z.string(),
});
export type PadiControlVersion = z.infer<typeof PadiControlVersionSchema>;

/** `clock.now` — padi's current clock, RTT-halved by the binder to measure a
 *  once-per-bind offset (owner-clock display; deliberately NOT a served ticking
 *  cell). */
export const PadiClockNowSchema = z.object({ epochMs: z.number() });
export type PadiClockNow = z.infer<typeof PadiClockNowSchema>;

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
      /** Identity handshake — who this padi is (`stateRoot`) + which
       *  `padiSurface` version it serves. Read FIRST by a binder. */
      hello: { output: PadiHelloSchema },
      /** The frozen core's own version probe (just `controlCoreVersion`). */
      controlVersion: { output: PadiControlVersionSchema },
      /** Persist state + exit; the PTYs survive in kaval, and the caller observes
       *  the socket close. Takes no input, returns nothing. */
      drain: {},
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

/** The combined wire contract a binder / dial-test client types its link off —
 *  `{ surface: { padi, control } }`. */
export const padiDaemonContract = composeSurfaceContracts(padiDaemonSurfaces);
export type PadiDaemonContract = typeof padiDaemonContract;

// The composed sibling registry (`surfacesWithPadi = { ...surfaces, padi }`)
// lives in `kolu-common/surface` now, NOT here: composing the app's `surfaces`
// with padi's authored surface is an APP concern, and building it here would
// force padi to import the app's `surfaces` registry — the exact backwards
// arrow the seal forbids. `@kolu/padi` exports `padiSurface`; the app assembles
// the registry FROM it.
