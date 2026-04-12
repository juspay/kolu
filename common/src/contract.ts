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
  ServerStateSchema,
  ServerStatePatchSchema,
  ClaudeTranscriptDebugSchema,
  FsSearchInputSchema,
  FsSearchResultSchema,
  FsListDirInputSchema,
  FileEntrySchema,
  FsReadFileInputSchema,
  FsReadFileOutputSchema,
  FsWatchInputSchema,
  FsChangeEventSchema,
  FsFileDiffInputSchema,
  FsFileDiffOutputSchema,
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
  },
  claude: {
    /** Diagnostic snapshot of the active terminal's Claude transcript:
     *  the server's state-change log alongside raw JSONL since monitoring started.
     *  Returns null if the terminal has no active Claude session. */
    getTranscript: oc
      .input(TerminalAttachInputSchema)
      .output(ClaudeTranscriptDebugSchema.nullable()),
  },
  state: {
    // Stream server state changes (preferences, recent repos, session). Yields current state immediately.
    get: oc.output(eventIterator(ServerStateSchema)),
    // Partial update — merge into current state
    update: oc.input(ServerStatePatchSchema).output(z.void()),
    // Reset state (test-only: seed/clear state between scenarios)
    test__set: oc.input(ServerStatePatchSchema).output(z.void()),
  },
  fs: {
    // Fuzzy search files in a workspace root
    search: oc.input(FsSearchInputSchema).output(z.array(FsSearchResultSchema)),
    // List entries in a directory (one level deep)
    listDir: oc.input(FsListDirInputSchema).output(z.array(FileEntrySchema)),
    // Read file contents (up to 1MB, truncated beyond)
    readFile: oc.input(FsReadFileInputSchema).output(FsReadFileOutputSchema),
    // Get parsed unified diff for a file against HEAD
    fileDiff: oc.input(FsFileDiffInputSchema).output(FsFileDiffOutputSchema),
    // Stream change notifications for a workspace root — yields whenever the file index updates
    onChange: oc
      .input(FsWatchInputSchema)
      .output(eventIterator(FsChangeEventSchema)),
  },
});
