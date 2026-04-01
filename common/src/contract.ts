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
  ActivitySampleSchema,
  TerminalPasteImageInputSchema,
  TerminalScreenTextInputSchema,
  ServerInfoSchema,
  WorktreeCreateInputSchema,
  WorktreeCreateOutputSchema,
  WorktreeRemoveInputSchema,
  RecentRepoSchema,
  SavedSessionSchema,
  UserPreferencesSchema,
  UserPreferencesPartialSchema,
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
    // Stream activity transitions [epochMs, isActive]. Snapshot on connect, then live samples.
    onActivityChange: oc
      .input(TerminalAttachInputSchema)
      .output(eventIterator(ActivitySampleSchema)),
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
    recentRepos: oc.output(z.array(RecentRepoSchema)),
  },
  preferences: {
    get: oc.output(UserPreferencesSchema),
    set: oc.input(UserPreferencesPartialSchema).output(UserPreferencesSchema),
  },
  session: {
    get: oc.output(SavedSessionSchema.nullable()),
    // Clear saved session (test-only: reset state between scenarios)
    clear: oc.output(z.void()),
    // Set saved session (test-only: seed state for scenarios)
    test__set: oc.input(SavedSessionSchema).output(z.void()),
  },
});
