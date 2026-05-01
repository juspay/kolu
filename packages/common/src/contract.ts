/**
 * oRPC contract: defines the typed API shape shared by server and client.
 *
 * The typed reactive layer lives in `surface.ts` (`defineSurface(...)`) and
 * appears at `surface.<key>.<verb>` on the wire. Raw procedures that don't
 * fit a surface primitive — terminal lifecycle, attach (streaming with
 * custom retry), git mutations, server info — live here, hand-listed,
 * spread alongside `surface.contract` at the host router.
 */

import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";
import {
  ExportTranscriptHtmlInputSchema,
  ExportTranscriptHtmlOutputSchema,
  ServerInfoSchema,
  SetActiveTerminalInputSchema,
  TerminalAttachInputSchema,
  TerminalAttachOutputSchema,
  TerminalCreateInputSchema,
  TerminalInfoSchema,
  TerminalPasteImageInputSchema,
  TerminalResizeInputSchema,
  TerminalScreenTextInputSchema,
  TerminalSendInputSchema,
  TerminalSetCanvasLayoutInputSchema,
  TerminalSetParentInputSchema,
  TerminalSetSubPanelInputSchema,
  TerminalSetThemeInputSchema,
  WorktreeCreateInputSchema,
  WorktreeCreateOutputSchema,
  WorktreeRemoveInputSchema,
} from "./index";
import { surface } from "./surface";

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
    setCanvasLayout: oc
      .input(TerminalSetCanvasLayoutInputSchema)
      .output(z.void()),
    setSubPanel: oc.input(TerminalSetSubPanelInputSchema).output(z.void()),
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
});
