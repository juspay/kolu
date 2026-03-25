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
  CwdInfoSchema,
  TerminalActivityOutputSchema,
  TerminalPasteImageInputSchema,
  ServerInfoSchema,
} from "./index";
import { z } from "zod";

export const contract = oc.router({
  server: {
    info: oc.output(ServerInfoSchema),
  },
  terminal: {
    create: oc.input(TerminalCreateInputSchema).output(TerminalInfoSchema),
    list: oc.output(z.array(TerminalInfoSchema)),
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
    // Stream CWD changes for a terminal (OSC 7). Yields current CWD immediately.
    onCwdChange: oc
      .input(TerminalAttachInputSchema)
      .output(eventIterator(CwdInfoSchema)),
    // Stream activity state changes (active/sleeping) for a terminal
    onActivityChange: oc
      .input(TerminalAttachInputSchema)
      .output(eventIterator(TerminalActivityOutputSchema)),
    // Save image data to the terminal's clipboard shim for Ctrl+V paste
    pasteImage: oc.input(TerminalPasteImageInputSchema).output(z.void()),
    // Kill a single terminal
    kill: oc.input(TerminalAttachInputSchema).output(TerminalInfoSchema),
    // Reorder terminals to match the given ID list
    reorder: oc.input(TerminalReorderInputSchema).output(z.void()),
    // Kill and remove all terminals (test-only: reset server state between scenarios)
    killAll: oc.output(z.void()),
  },
});
