/**
 * oRPC contract: defines the typed API shape shared by server and client.
 *
 * Server implements this contract. Client uses the contract type
 * for end-to-end type safety without importing server code.
 */
import { oc, eventIterator } from "@orpc/contract";
import {
  TerminalCreateOutputSchema,
  TerminalInfoSchema,
  TerminalResizeInputSchema,
  TerminalSendInputSchema,
  TerminalAttachInputSchema,
  TerminalAttachOutputSchema,
  TerminalOnExitOutputSchema,
} from "./index";
import { z } from "zod";

/** oRPC contract defining all RPC procedures. Used by server (implement) and client (typed calls). */
export const contract = oc.router({
  terminal: {
    create: oc.output(TerminalCreateOutputSchema),

    list: oc.output(z.array(TerminalInfoSchema)),

    resize: oc.input(TerminalResizeInputSchema),

    sendInput: oc.input(TerminalSendInputSchema),

    attach: oc
      .input(TerminalAttachInputSchema)
      .output(eventIterator(TerminalAttachOutputSchema)),

    onExit: oc
      .input(TerminalAttachInputSchema)
      .output(eventIterator(TerminalOnExitOutputSchema)),
  },
});
