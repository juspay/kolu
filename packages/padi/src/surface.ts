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
 * Unlike the frozen `terminalWorkspaceSurface` (3.0, dying with its pulam-era
 * consumers), this is a NEW surface — so a new per-host capability lands here
 * without being threaded through those dying consumers. It composes the two
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
 * Beside the surface, the frozen {@link padiControlCore} (hello · version ·
 * drain · clock.now) — version-agnostic, never versions, served for real in
 * W2.2. They live HERE (not `@kolu/surface-daemon`) and graduate only if a
 * second daemon ever adopts them (electricity test ③: proof before extraction).
 *
 * BROWSER-SAFE face: like `koluSurface`/`terminalWorkspaceSurface` this imports
 * only `@kolu/surface/define`, zod-only schema modules (`kolu-common/surface`,
 * `kolu-common/transcript`, `kolu-git/schemas`, `@kolu/terminal-workspace/surface`),
 * and `zod` — no `node:`/kaval runtime (that lives beside this, in the node-only
 * side the motion stage adds). It depends on kolu-common for the terminal
 * schemas (which eventually migrate here); the arrow points
 * `@kolu/padi → kolu-common`, never back.
 */

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import {
  FsFileInputSchema,
  FsReadFileTextOutputSchema,
  RepoChangePulseSchema,
} from "@kolu/terminal-workspace/surface";
import {
  ActiveTerminalSchema,
  CanvasLayoutSchema,
  DaemonStatusSchema,
  InitialTerminalMetadataSchema,
  KoluAuthoredFieldsSchema,
  PersistedSnapshotSchema,
  RightPanelPerTerminalStateSchema,
  SavedSessionSchema,
  SavedSleepingTerminalSchema,
  SleepingTerminalSchema,
  surfaces,
  TerminalIdSchema,
  TerminalInfoSchema,
  TerminalOnExitOutputSchema,
} from "kolu-common/surface";
import {
  ExportTranscriptHtmlInputSchema,
  ExportTranscriptHtmlOutputSchema,
} from "kolu-common/transcript";
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

// ── Version ─────────────────────────────────────────────────────────────

/** The wire-shape `major.minor` this build of `padiSurface` serves and expects.
 *  1.0 is the initial contract (the padi plan of record, PR #1649). Additive
 *  growth (a new optional field / stream / procedure) is a minor bump; a
 *  shape-breaking change a major. A remote dial gates an incompatible padi via
 *  `isContractVersionCompatible`. Distinct from {@link CONTROL_CORE_VERSION},
 *  which is frozen forever so a contract-revving deploy can still reach the
 *  daemon's control core. */
export const PADI_SURFACE_VERSION = "1.0";

/** The `version` cell payload — padi's self-declared surface contract version. */
export const PadiVersionSchema = z.object({ contractVersion: z.string() });
export type PadiVersion = z.infer<typeof PadiVersionSchema>;

/** The value a fresh `version` subscriber sees — this build's version. */
export const DEFAULT_PADI_VERSION: PadiVersion = {
  contractVersion: PADI_SURFACE_VERSION,
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

/** The `parked` discriminant — a reboot-killed active record padi's boot
 *  reconcile parks (its PTY died with the host; the record survives for
 *  restore). DISTINCT from `sleeping` (deliberately slept, resumes its agent on
 *  wake): the two arms restore oppositely, so a distinct discriminant keeps them
 *  from being confused. Lands as a produced state in W1.R; W1.C reserves it in
 *  the union so the contract is stable. */
export const PadiParkedDiscriminantSchema = z.object({
  state: z.literal("parked"),
  /** ms-epoch padi parked this record at boot reconcile. */
  parkedAt: z.number(),
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
  .merge(PadiParkedDiscriminantSchema)
  .merge(PadiHostAxisSchema);

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

// ── The urgency projection (recency-free) ─────────────────────────────────

/** The recency-FREE urgency fold off the registry: how many terminals await
 *  the user, and which. The ONE thing kolu-server reads from every warm binding
 *  (for cross-host badge fan-in), so it deliberately carries counts + ids and NO
 *  recency — nothing cross-host ever compares two hosts' clocks. */
export const PadiUrgencySchema = z.object({
  /** Count of terminals whose agent is awaiting the user (`awaiting_user`). */
  awaiting: z.number().int().nonnegative(),
  /** The ids of those awaiting terminals — for a badge deep-link to focus one. */
  awaitingIds: z.array(TerminalIdSchema),
});
export type PadiUrgency = z.infer<typeof PadiUrgencySchema>;

// ── Procedure I/O schemas (padiSurface's own — NOT the dying root ones) ────
//
// These are the NEW contract shapes lifecycle/chrome/screen/bytes/session
// migrate onto (the root `terminal.*` namespace dies across W1.R). They are
// intentionally distinct from `kolu-common/contract`'s raw-oRPC schemas — most
// notably `create` DROPS `lastActivityAt` (padi stamps with its own clock), so
// they are not duplicates to fold away.

/** Create input — client-owned initial metadata MINUS `lastActivityAt`: padi
 *  stamps recency with its own clock, so the client cannot supply it. */
export const PadiCreateInputSchema = z
  .object({
    cwd: z.string().optional(),
    parentId: TerminalIdSchema.optional(),
  })
  .merge(InitialTerminalMetadataSchema.omit({ lastActivityAt: true }));

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
export const PadiPreviewReadOutputSchema = z.object({
  /** HTTP status — `200` | `206` (ranged) | `400` | `403` | `404` | `416` |
   *  `500`, verbatim from `serveFile`. */
  status: z.number().int(),
  /** Response headers verbatim from serve-dir (`Content-Type`, `Accept-Ranges`,
   *  `X-Content-Type-Options`, `Cache-Control`, and `Content-Range` on a
   *  206/416). The client replays them onto the reconstructed `Response`. */
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

export const padiSurface = defineSurface({
  cells: {
    /** padi's self-declared surface contract version (1.0). */
    version: { schema: PadiVersionSchema, default: DEFAULT_PADI_VERSION },
    /** The recency-free urgency projection — read-only on the client; padi's
     *  registry fold is the sole writer. */
    urgency: {
      schema: PadiUrgencySchema,
      default: { awaiting: 0, awaitingIds: [] } satisfies PadiUrgency,
      verbs: ["get"],
    },
  },
  collections: {
    /** The composed terminal record — `authored ⋈ snapshot`, one writer, keyed
     *  by terminal id. Read-only on the client; padi's registry is the authority. */
    terminals: {
      keySchema: TerminalIdSchema,
      schema: PadiTerminalSchema,
      verbs: ["keys", "get"],
    },
    /** Per-host pty-host daemon (kaval) status — padi supervises its kaval, so
     *  the daemon-liveness cell is padi's to serve. Read-only on the client. */
    daemonStatus: {
      keySchema: z.string(),
      schema: DaemonStatusSchema,
      verbs: ["keys", "get"],
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
      outputSchema: z.string(),
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
     *  discardSleeping · restoreSleeping · resize · sendInput. */
    lifecycle: {
      create: { input: PadiCreateInputSchema, output: TerminalInfoSchema },
      kill: { input: PadiTerminalIdInputSchema, output: TerminalInfoSchema },
      killAll: {},
      sleep: { input: PadiTerminalIdInputSchema },
      wake: { input: PadiTerminalIdInputSchema, output: TerminalInfoSchema },
      discardSleeping: { input: PadiTerminalIdInputSchema },
      restoreSleeping: { input: SavedSleepingTerminalSchema },
      resize: { input: PadiResizeInputSchema },
      sendInput: { input: PadiSendInputSchema },
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
    },
    /** Filesystem reads scoped to a repo on the serving host. */
    fs: {
      listAll: { input: FsListAllInputSchema, output: FsListAllOutputSchema },
      readFile: {
        input: FsFileInputSchema,
        output: FsReadFileTextOutputSchema,
      },
      statFileMtimeMs: { input: FsFileInputSchema, output: z.number() },
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
    /** Byte reads — the iframe binary preview (range-capable, serve-dir-shaped). */
    preview: {
      read: {
        input: PadiPreviewReadInputSchema,
        output: PadiPreviewReadOutputSchema,
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
    /** Session restore/import — executes host-side (padi as one writer). */
    session: {
      restore: { input: PadiSessionRestoreInputSchema },
      import: { input: PadiSessionImportInputSchema },
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
 *  every procedure under a namespace shares its policy). The contract test pins
 *  this against the built spec so no member can be added without an annotation,
 *  and W2.1's re-serve helpers read it to type each hop. */
export const PADI_FORWARDING_POLICY = {
  // cells
  version: "value",
  urgency: "value",
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

/** The frozen control-core contract — hello · version · drain · clock.now.
 *  Defined as pure schema shapes in W1.C (pinned by the contract test); W2.2
 *  serves them for real over the padi socket. `drain` takes no input and returns
 *  nothing (persist state + exit; the caller observes the socket close). */
export const padiControlCore = {
  version: CONTROL_CORE_VERSION,
  hello: { output: PadiHelloSchema },
  controlVersion: { output: PadiControlVersionSchema },
  drain: {},
  clockNow: { output: PadiClockNowSchema },
} as const;

// ── The sibling map, with padi ─────────────────────────────────────────────

/** The sibling surfaces served over one transport, PLUS `padi`. Read by
 *  kolu-server to extend the wire contract (`composeSurfaceContracts`) and to
 *  serve (`implementSurfaces`) so `padiSurface` serves BESIDE `koluSurface` at
 *  `surface.padi.*` — once W1.R wires the serving. kolu-common's own `contract`
 *  deliberately composes the padi-LESS `surfaces` (the client consumes that) —
 *  so this contract has ZERO client consumers; kolu-server adds the `padi`
 *  sibling on top locally. */
export const surfacesWithPadi = {
  ...surfaces,
  padi: padiSurface,
} as const;
