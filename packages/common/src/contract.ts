/**
 * oRPC contract: defines the typed API shape shared by server and client.
 *
 * Server implements this contract. Client uses the contract type
 * for end-to-end type safety without importing server code.
 */
import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";
import {
  ActivityFeedSchema,
  ExportTranscriptHtmlInputSchema,
  ExportTranscriptHtmlOutputSchema,
  FsListAllInputSchema,
  FsListAllOutputSchema,
  FsReadFileInputSchema,
  FsReadFileOutputSchema,
  GitDiffInputSchema,
  GitDiffOutputSchema,
  GitStatusInputSchema,
  GitStatusOutputSchema,
  PreferencesPatchSchema,
  PreferencesSchema,
  SavedSessionSchema,
  ServerInfoSchema,
  SetActiveTerminalInputSchema,
  TerminalAttachInputSchema,
  TerminalAttachOutputSchema,
  TerminalCreateInputSchema,
  TerminalInfoSchema,
  TerminalMetadataSchema,
  TerminalOnExitOutputSchema,
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

export const contract = oc.router({
  server: {
    info: oc.output(ServerInfoSchema),
  },
  terminal: {
    create: oc.input(TerminalCreateInputSchema).output(TerminalInfoSchema),
    // Stream terminal list changes (create/kill). Yields current list immediately.
    list: oc.output(eventIterator(z.array(TerminalInfoSchema))),
    resize: oc.input(TerminalResizeInputSchema).output(z.void()),
    sendInput: oc.input(TerminalSendInputSchema).output(z.void()),
    setTheme: oc.input(TerminalSetThemeInputSchema).output(z.void()),
    setCanvasLayout: oc
      .input(TerminalSetCanvasLayoutInputSchema)
      .output(z.void()),
    setSubPanel: oc.input(TerminalSetSubPanelInputSchema).output(z.void()),
    setActive: oc.input(SetActiveTerminalInputSchema).output(z.void()),
    attach: oc
      .input(TerminalAttachInputSchema)
      .output(eventIterator(TerminalAttachOutputSchema)),
    onExit: oc
      .input(TerminalAttachInputSchema)
      .output(eventIterator(TerminalOnExitOutputSchema)),
    // Snapshot of headless xterm screen state (VT sequences) for a terminal
    screenState: oc.input(TerminalAttachInputSchema).output(z.string()),
    // Plain text content of the terminal buffer (scrollback + viewport)
    screenText: oc.input(TerminalScreenTextInputSchema).output(z.string()),
    // Stream terminal metadata changes (CWD, git, PR, etc.). Yields current state immediately.
    onMetadataChange: oc
      .input(TerminalAttachInputSchema)
      .output(eventIterator(TerminalMetadataSchema)),
    // Save image data to the terminal's clipboard shim for Ctrl+V paste
    pasteImage: oc.input(TerminalPasteImageInputSchema).output(z.void()),
    // Kill a single terminal
    kill: oc.input(TerminalAttachInputSchema).output(TerminalInfoSchema),
    // Set or clear a terminal's parent (for orphan promotion)
    setParent: oc.input(TerminalSetParentInputSchema).output(z.void()),
    // Kill and remove all terminals (test-only: reset server state between scenarios)
    killAll: oc.output(z.void()),
    // One-shot: read the active agent's transcript from disk and render
    // a self-contained HTML export. Errors with PRECONDITION_FAILED if the
    // terminal has no agent session attached.
    exportTranscriptHtml: oc
      .input(ExportTranscriptHtmlInputSchema)
      .output(ExportTranscriptHtmlOutputSchema),
  },
  git: {
    worktreeCreate: oc
      .input(WorktreeCreateInputSchema)
      .output(WorktreeCreateOutputSchema),
    worktreeRemove: oc.input(WorktreeRemoveInputSchema).output(z.void()),
    /** Stream changed-files list for the given mode (`local` = vs HEAD;
     *  `branch` = vs merge-base with `origin/<defaultBranch>`). Yields
     *  current state immediately, then a fresh full snapshot every time
     *  the underlying repo state changes (HEAD, reflog, index, working
     *  tree). Server dedups against the last yielded value. */
    onStatusChange: oc
      .input(GitStatusInputSchema)
      .output(eventIterator(GitStatusOutputSchema)),
    /** Stream unified diff for one file. Yields current diff, then a fresh
     *  full snapshot whenever the repo state changes. Server dedups. */
    onDiffChange: oc
      .input(GitDiffInputSchema)
      .output(eventIterator(GitDiffOutputSchema)),
  },
  fs: {
    /** Stream the flat repo-relative path list (tracked + untracked-but-
     *  not-ignored). Yields current list, then a fresh full snapshot on
     *  every repo state change. Drives the Code-view's All-mode tree. */
    onListAllChange: oc
      .input(FsListAllInputSchema)
      .output(eventIterator(FsListAllOutputSchema)),
    /** Stream a file's UTF-8 content. Yields current content, then a
     *  fresh full snapshot whenever the file or HEAD changes. Path-
     *  traversal guarded. Drives the Code-view's All-mode body. */
    onReadFileChange: oc
      .input(FsReadFileInputSchema)
      .output(eventIterator(FsReadFileOutputSchema)),
  },
  preferences: {
    // Stream user preferences. Yields current value immediately, then on each change.
    get: oc.output(eventIterator(PreferencesSchema)),
    // Partial update — patch fields into current preferences. rightPanel is deep-merged.
    update: oc.input(PreferencesPatchSchema).output(z.void()),
    // Reset preferences (test-only: seed defaults between scenarios)
    test__set: oc.input(PreferencesSchema).output(z.void()),
  },
  activity: {
    // Stream the server-derived activity feed (recent repos + recent agents).
    // Read-only for clients — server is the sole writer (trackRecentRepo / trackRecentAgent).
    get: oc.output(eventIterator(ActivityFeedSchema)),
    // Reset activity feed (test-only: clear MRU lists between scenarios)
    test__set: oc.input(ActivityFeedSchema).output(z.void()),
  },
  session: {
    // Stream the persisted saved-session blob (or null when none). Read-only —
    // server writes via debounced autosave on terminal-list changes.
    // The per-terminal `lastAgentCommand` field rides inside `SavedTerminal`
    // and drives the resume offer in EmptyState.
    get: oc.output(eventIterator(SavedSessionSchema.nullable())),
    // Reset saved session (test-only: seed/clear between scenarios)
    test__set: oc.input(SavedSessionSchema.nullable()).output(z.void()),
  },
});
