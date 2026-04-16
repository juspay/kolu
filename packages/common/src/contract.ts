/**
 * oRPC contract: defines the typed API shape shared by server and client.
 *
 * Server implements this contract. Client uses the contract type
 * for end-to-end type safety without importing server code.
 */
import { oc, eventIterator } from "@orpc/contract";
import {
  TerminalInfoSchema,
  TerminalCreateInputSchema,
  TerminalResizeInputSchema,
  TerminalSendInputSchema,
  TerminalSetThemeInputSchema,
  TerminalAttachInputSchema,
  TerminalAttachOutputSchema,
  TerminalOnExitOutputSchema,
  TerminalReorderInputSchema,
  TerminalSetParentInputSchema,
  TerminalMetadataSchema,
  ActivityStreamEventSchema,
  TerminalPasteImageInputSchema,
  TerminalScreenTextInputSchema,
  ServerInfoSchema,
  WorktreeCreateInputSchema,
  WorktreeCreateOutputSchema,
  WorktreeRemoveInputSchema,
  GitStatusInputSchema,
  GitStatusOutputSchema,
  GitDiffInputSchema,
  GitDiffOutputSchema,
  ServerStateSchema,
  ServerStatePatchSchema,
  FsListDirInputSchema,
  FsListDirOutputSchema,
  FsReadFileInputSchema,
  FsReadFileOutputSchema,
} from "./index";
import { z } from "zod";

export const contract = oc.router({
  server: {
    info: oc.output(ServerInfoSchema),
  },
  terminal: {
    create: oc.input(TerminalCreateInputSchema).output(TerminalInfoSchema),
    // Stream terminal list changes (create/kill/reorder). Yields current list immediately.
    list: oc.output(eventIterator(z.array(TerminalInfoSchema))),
    resize: oc.input(TerminalResizeInputSchema).output(z.void()),
    sendInput: oc.input(TerminalSendInputSchema).output(z.void()),
    setTheme: oc.input(TerminalSetThemeInputSchema).output(z.void()),
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
    // Stream activity transitions as a discriminated union. First yield
    // on every (re)subscribe is `{ kind: "snapshot", samples: [...] }`
    // carrying the full retained history; subsequent yields are
    // `{ kind: "delta", sample }`. Clients replace on snapshot, append
    // on delta — reconnect-safe by construction.
    onActivityChange: oc
      .input(TerminalAttachInputSchema)
      .output(eventIterator(ActivityStreamEventSchema)),
    // Save image data to the terminal's clipboard shim for Ctrl+V paste
    pasteImage: oc.input(TerminalPasteImageInputSchema).output(z.void()),
    // Kill a single terminal
    kill: oc.input(TerminalAttachInputSchema).output(TerminalInfoSchema),
    // Reorder terminals to match the given ID list
    reorder: oc.input(TerminalReorderInputSchema).output(z.void()),
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
    /** Raw unified diff plus old/new file contents for `@git-diff-view`.
     *  Base depends on mode — HEAD in local mode, merge-base with
     *  `origin/<defaultBranch>` in branch mode. */
    diff: oc.input(GitDiffInputSchema).output(GitDiffOutputSchema),
  },
  fs: {
    /** List entries in a directory, filtered by git (tracked + untracked-but-not-ignored).
     *  Used by the Code tab's file tree browser. */
    listDir: oc.input(FsListDirInputSchema).output(FsListDirOutputSchema),
    /** Read a file's UTF-8 content, path-traversal guarded. */
    readFile: oc.input(FsReadFileInputSchema).output(FsReadFileOutputSchema),
  },
  state: {
    // Stream server state changes (preferences, recent repos, session). Yields current state immediately.
    get: oc.output(eventIterator(ServerStateSchema)),
    // Partial update — merge into current state
    update: oc.input(ServerStatePatchSchema).output(z.void()),
    // Reset state (test-only: seed/clear state between scenarios)
    test__set: oc.input(ServerStatePatchSchema).output(z.void()),
  },
});
