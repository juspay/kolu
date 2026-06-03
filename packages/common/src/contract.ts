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

import { eventIterator, oc } from "@orpc/contract";
import {
  FsWriteFileInputSchema,
  WorktreeCreateInputSchema,
  WorktreeCreateOutputSchema,
  WorktreeRemoveInputSchema,
} from "kolu-git/schemas";
import { z } from "zod";
import {
  CanvasLayoutSchema,
  InitialTerminalMetadataSchema,
  RightPanelPerTerminalStateSchema,
  surface,
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

export const ServerIdentitySchema = z.object({
  hostname: z.string(),
  name: z.string(),
  themeColor: z.string(),
});
export type ServerIdentity = z.infer<typeof ServerIdentitySchema>;

export const ServerInfoSchema = z.object({
  identity: ServerIdentitySchema,
  /** Unique ID for this server process — changes on restart. */
  processId: z.string().uuid(),
  /** Git commit this kolu-server was built from (`KOLU_COMMIT_HASH`), the
   *  GitHub-navigable ref for the ChromeBar's `srv` column. `""` off-nix. */
  commit: z.string(),
  /** The in-process pty-host's identity (its own commit + closure staleKey),
   *  fetched once at boot via `system.version`. The shape mirrors
   *  `@kolu/pty-host`'s `PtyHostIdentity`, duplicated inline to avoid a
   *  `pty-host → kolu-common` import cycle. Optional: a future surviving
   *  daemon may predate it (phase B). */
  ptyHost: z
    .object({ staleKey: z.string(), navigableCommit: z.string() })
    .optional(),
});
export type ServerInfo = z.infer<typeof ServerInfoSchema>;

// ── The contract ──────────────────────────────────────────────────────

export const contract = oc.router({
  ...surface.contract,
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
    setParent: oc.input(TerminalSetParentInputSchema).output(z.void()),
    /** Test-only: kill and remove all terminals. */
    killAll: oc.output(z.void()),
    /** One-shot: read the active agent's transcript from disk and render
     *  a self-contained HTML export. */
    exportTranscriptHtml: oc
      .input(ExportTranscriptHtmlInputSchema)
      .output(ExportTranscriptHtmlOutputSchema),
  },
  git: {
    worktreeCreate: oc
      .input(WorktreeCreateInputSchema)
      .output(WorktreeCreateOutputSchema),
    worktreeRemove: oc.input(WorktreeRemoveInputSchema).output(z.void()),
  },
  fs: {
    /** Overwrite a file in a repo working tree (path-guarded to the root).
     *  Powers the rendered-Markdown task-list toggle. */
    writeFile: oc.input(FsWriteFileInputSchema).output(z.void()),
  },
});
