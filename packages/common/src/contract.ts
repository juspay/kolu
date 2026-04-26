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
  FsListAllInputSchema,
  FsListAllOutputSchema,
  FsReadFileInputSchema,
  FsReadFileOutputSchema,
  FsWatchEventSchema,
  FsWatchInputSchema,
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
  },
  git: {
    worktreeCreate: oc
      .input(WorktreeCreateInputSchema)
      .output(WorktreeCreateOutputSchema),
    worktreeRemove: oc.input(WorktreeRemoveInputSchema).output(z.void()),
    /** List files changed for the given mode: `local` = vs HEAD
     *  (working tree + staged + untracked); `branch` = vs merge-base
     *  with `origin/<defaultBranch>` (what this branch will ship). */
    status: oc.input(GitStatusInputSchema).output(GitStatusOutputSchema),
    /** Raw unified diff for `@pierre/diffs`'s `parsePatchFiles`. Base
     *  depends on mode — HEAD in local mode, merge-base with
     *  `origin/<defaultBranch>` in branch mode. */
    diff: oc.input(GitDiffInputSchema).output(GitDiffOutputSchema),
  },
  fs: {
    /** Flat list of every repo-relative path (tracked + untracked-but-not-ignored).
     *  One-shot snapshot for path-first tree UIs like `@pierre/trees`. */
    listAll: oc.input(FsListAllInputSchema).output(FsListAllOutputSchema),
    /** Read a file's UTF-8 content, path-traversal guarded. */
    readFile: oc.input(FsReadFileInputSchema).output(FsReadFileOutputSchema),
    /** Live file-tree stream — yields a `snapshot` immediately, then a
     *  `delta` per debounced filesystem change. Backed by a refcounted
     *  chokidar watcher per repoPath. */
    watch: oc
      .input(FsWatchInputSchema)
      .output(eventIterator(FsWatchEventSchema)),
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
