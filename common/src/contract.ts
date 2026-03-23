/**
 * oRPC contract: defines the typed API shape shared by server and client.
 *
 * Server implements this contract. Client uses the contract type
 * for end-to-end type safety without importing server code.
 */
import { oc, eventIterator } from "@orpc/contract";
import {
  TerminalInfoSchema,
  TerminalResizeInputSchema,
  TerminalSendInputSchema,
  TerminalSetThemeInputSchema,
  TerminalAttachInputSchema,
  TerminalAttachOutputSchema,
  TerminalOnExitOutputSchema,
  TerminalCwdOutputSchema,
  TerminalActivityOutputSchema,
} from "./index";
import { z } from "zod";

export const contract = oc.router({
  terminal: {
    create: oc.output(TerminalInfoSchema),
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
      .output(eventIterator(TerminalCwdOutputSchema)),
    // Stream activity state changes (active/sleeping) for a terminal
    onActivityChange: oc
      .input(TerminalAttachInputSchema)
      .output(eventIterator(TerminalActivityOutputSchema)),
    // Kill and remove all terminals (test-only: reset server state between scenarios)
    killAll: oc.output(z.void()),
  },
});
