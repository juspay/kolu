/**
 * oRPC contract: defines the typed API shape shared by server and client.
 *
 * The typed reactive layer lives in `./surface` (`defineSurface(...)`) and
 * appears at `surface.<key>.<verb>` on the wire. Raw procedures that don't
 * fit a surface primitive — terminal lifecycle, attach (streaming with
 * custom retry), git mutations, server info — live here, hand-listed,
 * spread alongside `surface.contract` at the host router.
 *
 * The procedure I/O schemas this contract consumes are declared in this
 * file. Schemas shared with the surface layer (TerminalAttachInputSchema,
 * TerminalIdSchema, etc.) live in `./surface` and are imported here.
 */

import { composeSurfaceContracts } from "@kolu/surface/define";
import { eventIterator, oc } from "@orpc/contract";
import {
  WorktreeCreateInputSchema,
  WorktreeCreateOutputSchema,
  WorktreeRemoveInputSchema,
} from "kolu-git/schemas";
import { z } from "zod";
import {
  CanvasLayoutSchema,
  InitialTerminalMetadataSchema,
  RightPanelPerTerminalStateSchema,
  SavedSleepingTerminalSchema,
  surfaces,
  TerminalAttachInputSchema,
  TerminalIdSchema,
  TerminalInfoSchema,
} from "./surface";
import {
  ExportTranscriptHtmlInputSchema,
  ExportTranscriptHtmlOutputSchema,
} from "./transcript";

// ── Raw oRPC procedure I/O schemas ────────────────────────────────────

export const TerminalCreateInputSchema = z
  .object({
    cwd: z.string().optional(),
    parentId: TerminalIdSchema.optional(),
  })
  .merge(InitialTerminalMetadataSchema);

export const TerminalResizeInputSchema = z.object({
  id: TerminalIdSchema,
  cols: z.number(),
  rows: z.number(),
});

export const TerminalSendInputSchema = z.object({
  id: TerminalIdSchema,
  data: z.string(),
});

export const TerminalSetThemeInputSchema = z.object({
  id: TerminalIdSchema,
  themeName: z.string().min(1),
});

export const TerminalSetIntentInputSchema = z.object({
  id: TerminalIdSchema,
  /** Empty string clears the intent; any non-empty string sets it. */
  intent: z.string(),
});

export const TerminalSetCanvasLayoutInputSchema = z.object({
  id: TerminalIdSchema,
  layout: CanvasLayoutSchema,
});

export const TerminalSetSubPanelInputSchema = z.object({
  id: TerminalIdSchema,
  collapsed: z.boolean(),
  panelSize: z.number(),
});

export const TerminalSetRightPanelInputSchema =
  RightPanelPerTerminalStateSchema.extend({
    id: TerminalIdSchema,
  });

export const SetActiveTerminalInputSchema = z.object({
  id: TerminalIdSchema.nullable(),
});

export const TerminalAttachOutputSchema = z.string();

export const TerminalScreenTextInputSchema = z.object({
  id: TerminalIdSchema,
  /** First line to capture (0-based, inclusive). Defaults to 0 (start of scrollback). */
  startLine: z.number().int().nonnegative().optional(),
  /** Last line to capture (exclusive). Defaults to buffer length. */
  endLine: z.number().int().nonnegative().optional(),
});

export const TerminalPasteImageInputSchema = z.object({
  id: TerminalIdSchema,
  /** Base64-encoded image data (PNG, JPEG, etc.) */
  data: z.string(),
});

export const TerminalUploadFileInputSchema = z.object({
  id: TerminalIdSchema,
  /** Filename as the user dropped it. The server sanitizes before writing
   *  — only the basename's safe characters survive. */
  name: z.string().min(1),
  /** Base64-encoded file bytes. */
  data: z.string(),
});

export const TerminalSetParentInputSchema = z.object({
  id: TerminalIdSchema,
  parentId: TerminalIdSchema.nullable(),
});

// ── PR2: on-disk terminal history (the copy-mode pager + un-clipped PDF) ──────

/** One backward history page request. `beforeCursor` is the opaque reflow-stable
 *  byte cursor at the top of what the client holds (null = the tip); `width` is a
 *  render-time parameter (line numbers never go on the wire). */
export const TerminalHistoryInputSchema = z.object({
  id: TerminalIdSchema,
  beforeCursor: z.number().nullable(),
  maxLines: z.number().int().positive(),
  width: z.number().int().positive(),
});

/** A history page (or an honest non-content state — never silent-empty). `ansi`
 *  writes into the pager's read-only xterm; `nextCursor` pages further up. */
export const TerminalHistoryResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ok"),
    ansi: z.string(),
    rowCount: z.number().int(),
    nextCursor: z.number(),
    atFloor: z.boolean(),
    firstRow: z.number().int(),
  }),
  z.object({ kind: z.literal("unavailable") }),
  z.object({ kind: z.literal("evicted") }),
  z.object({ kind: z.literal("faulted"), lastGoodSeq: z.number().int() }),
]);

export const TerminalSearchHistoryInputSchema = z.object({
  id: TerminalIdSchema,
  query: z.string(),
  beforeCursor: z.number().nullable(),
  /** Opt-in capabilities (xterm's ISearchOptions shape), not degradation knobs:
   *  the default (both false) reproduces the find bar exactly — literal,
   *  case-insensitive. */
  regex: z.boolean(),
  caseSensitive: z.boolean(),
  maxResults: z.number().int().positive(),
});

export const TerminalSearchHistoryOutputSchema = z.object({
  hits: z.array(
    z.object({
      cursor: z.number(),
      firstRow: z.number().int(),
      text: z.string(),
      matches: z.array(
        z.object({ start: z.number().int(), end: z.number().int() }),
      ),
    }),
  ),
  nextCursor: z.number().nullable(),
  truncated: z.boolean(),
});

/** One faithful per-resize-epoch export segment (the un-clipped PDF source). The
 *  client resizes an offscreen themed xterm to `(cols, rows)`, writes `ansi`,
 *  and accumulates `serializeAsHTML()`. */
export const TerminalExportSegmentSchema = z.object({
  cols: z.number().int(),
  rows: z.number().int(),
  ansi: z.string(),
});

export const ServerIdentitySchema = z.object({
  hostname: z.string(),
  name: z.string(),
  themeColor: z.string(),
});
export type ServerIdentity = z.infer<typeof ServerIdentitySchema>;

// The `processId` (restart axis) and `commit` + `expectedKaval` (build-identity
// / skew axis) that used to ride this probe now live on the surface, owned by
// @kolu/surface-app: `processId` is the `surface.surfaceApp.identity.info` probe
// (surface-app served as a sibling surface), and `commit` + `expectedKaval` are
// the server-pushed `buildInfo` cell (`koluBuildInfo`); the connected daemon's
// *reported* identity rides `daemonStatus.identity`, not this probe. This raw
// probe keeps only the per-host BRANDING the shell needs synchronously at boot
// (document title, watermark, PWA theme).
export const ServerInfoSchema = z.object({
  identity: ServerIdentitySchema,
});
export type ServerInfo = z.infer<typeof ServerInfoSchema>;

// ── The contract ──────────────────────────────────────────────────────

export const contract = oc.router({
  // Two sibling surfaces multiplexed over one transport (kolu#1197): kolu's
  // OWN primitives under `kolu`, surface-app's complete surface (buildInfo cell
  // + identity probe) under `surfaceApp`. `composeSurfaceContracts` keys each
  // inner contract, producing `{ surface: { kolu: …, surfaceApp: … } }` — wire
  // paths are `surface.kolu.<prim>.<verb>` / `surface.surfaceApp.<prim>.<verb>`.
  // `surfaces` is the single source shared with the server + client.
  ...composeSurfaceContracts(surfaces),
  server: {
    info: oc.output(ServerInfoSchema),
  },
  terminal: {
    create: oc.input(TerminalCreateInputSchema).output(TerminalInfoSchema),
    resize: oc.input(TerminalResizeInputSchema).output(z.void()),
    sendInput: oc.input(TerminalSendInputSchema).output(z.void()),
    setTheme: oc.input(TerminalSetThemeInputSchema).output(z.void()),
    setIntent: oc.input(TerminalSetIntentInputSchema).output(z.void()),
    setCanvasLayout: oc
      .input(TerminalSetCanvasLayoutInputSchema)
      .output(z.void()),
    setSubPanel: oc.input(TerminalSetSubPanelInputSchema).output(z.void()),
    setRightPanel: oc.input(TerminalSetRightPanelInputSchema).output(z.void()),
    setActive: oc.input(SetActiveTerminalInputSchema).output(z.void()),
    /** Bidirectional binary stream — clients use `streamCall` with a
     *  custom `onRetry` (xterm buffer reset before re-subscribe). Doesn't
     *  fit a surface primitive; stays raw. */
    attach: oc
      .input(TerminalAttachInputSchema)
      .output(eventIterator(TerminalAttachOutputSchema)),
    screenState: oc.input(TerminalAttachInputSchema).output(z.string()),
    screenText: oc.input(TerminalScreenTextInputSchema).output(z.string()),
    pasteImage: oc.input(TerminalPasteImageInputSchema).output(z.void()),
    uploadFile: oc.input(TerminalUploadFileInputSchema).output(z.void()),
    kill: oc.input(TerminalAttachInputSchema).output(TerminalInfoSchema),
    /** Sleep a terminal: flip it to the dormant arm IN PLACE (same id), persist
     *  the session durably, then release its PTY/xterm/agent — persist-before-kill.
     *  Idempotent / a no-op on an already-sleeping or absent id. */
    sleep: oc.input(TerminalAttachInputSchema).output(z.void()),
    /** Wake a sleeping terminal: re-spawn its PTY on the SAME id in its saved cwd
     *  and resume its agent — session-restore-of-one. Returns the woken active
     *  info; throws NOT_FOUND if the id is not a sleeping terminal. */
    wake: oc.input(TerminalAttachInputSchema).output(TerminalInfoSchema),
    /** Discard a sleeping terminal's record (no PTY to kill — sleep released it).
     *  Reached when the user closes a sleeping tile via the close-confirm dialog. */
    discardSleeping: oc.input(TerminalAttachInputSchema).output(z.void()),
    /** Seed a SLEEPING terminal into the registry from its saved record — the
     *  dormant analogue of create, used by the cold-boot restore card to bring a
     *  slept terminal back as ☾ (no PTY spawned). A malformed record is dropped. */
    restoreSleeping: oc.input(SavedSleepingTerminalSchema).output(z.void()),
    setParent: oc.input(TerminalSetParentInputSchema).output(z.void()),
    /** Test-only: kill and remove all terminals. */
    killAll: oc.output(z.void()),
    /** One-shot: read the active agent's transcript from disk and render
     *  a self-contained HTML export. */
    exportTranscriptHtml: oc
      .input(ExportTranscriptHtmlInputSchema)
      .output(ExportTranscriptHtmlOutputSchema),
    /** PR2: one backward history page from the on-disk transcript — unary
     *  request/response paging on the opaque byte cursor (the pager is the past,
     *  not a live tail), so it needs no `stream`-namespace re-subscribe. */
    history: oc
      .input(TerminalHistoryInputSchema)
      .output(TerminalHistoryResultSchema),
    /** PR2: search the on-disk transcript (replay-and-scan, cursor-paged). */
    searchHistory: oc
      .input(TerminalSearchHistoryInputSchema)
      .output(TerminalSearchHistoryOutputSchema),
    /** PR2: whole-transcript plain text — the deep "copy all" source that
     *  "Copy terminal text" and the pager's "Copy all history" both read. */
    historyText: oc.input(TerminalAttachInputSchema).output(z.string()),
    /** PR2: faithful per-resize-epoch export segments (the un-clipped PDF). A
     *  finite ordered stream — consumed via the `stream` namespace, idempotent
     *  restart on reconnect. */
    exportHistory: oc
      .input(TerminalAttachInputSchema)
      .output(eventIterator(TerminalExportSegmentSchema)),
  },
  daemon: {
    /** Restart the local kaval daemon, preserving the session (B3.2). Captures
     *  the session before the kill, recycles the daemon (kill → wait → spawn →
     *  connect), and leaves the empty canvas + preserved session the restore
     *  card consumes. Resolves once the fresh daemon is connected — the daemon's
     *  live state rides the `daemonStatus` surface (`restarting`→`connected`),
     *  not this return value. The user reaches it from the kaval rail dialog (a
     *  running or degraded daemon) or the DegradedCanvas (a dead one). No input:
     *  one local host today, host-count-agnostic shapes deferred to R-2. */
    restart: oc.output(z.void()),
  },
  git: {
    worktreeCreate: oc
      .input(WorktreeCreateInputSchema)
      .output(WorktreeCreateOutputSchema),
    worktreeRemove: oc.input(WorktreeRemoveInputSchema).output(z.void()),
  },
});
