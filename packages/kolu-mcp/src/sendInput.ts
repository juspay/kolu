/**
 * `lifecycle_sendInput` — the MCP face's input tool, wrapping padiSurface's
 * `lifecycle.sendInput` with the NAMED-KEY vocabulary and the submit
 * discipline the driving skills depend on.
 *
 * Text XOR key, enforced hard: the /orchestrator·/kolu dispatch protocol sends
 * text, observes the terminal settle (`wait_outputSettled`), THEN submits
 * Enter as its OWN send — a same-breath text+Enter is raced by the driven
 * TUI's paste debounce and silently dropped (the exact footgun kaval-tui's
 * `send` refuses the same way). So `{ text, key }` in one call is a loud
 * error, never a fused submit.
 *
 * The key grammar is `@kolu/terminal-protocol`'s `encodeKey` — the SAME
 * vocabulary kaval-tui's `--key`, the rich client, and the mobile key bar
 * speak (named keys case-insensitively, `C-<char>` control chords,
 * `M-<char>` meta chords).
 *
 * Multiline text is auto-wrapped in BRACKETED PASTE (kaval-tui's auto rule):
 * the agent's input box takes it as one block instead of firing a half-written
 * prompt per `\n`. Single-line text types literally.
 */

import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import {
  ACCEPTED_KEY_NAMES,
  encodeKey,
  wrapBracketedPaste,
} from "@kolu/terminal-protocol";
import type { PadiSurfaceClient } from "@kolu/padi/dial";
import type { BespokeTool } from "@kolu/surface-mcp";
import { Effect, Schema } from "effect";

export const SendInputArgsSchema = Schema.Struct({
  id: TerminalIdSchema,
  // The per-field blurb an MCP host renders is the `description` ANNOTATION,
  // and it must sit on the encoded-side node INSIDE `optionalKey` for the
  // converter to see it (`@kolu/surface-mcp`'s `jsonschema.ts` law). These two
  // are CHECK-FREE, so a plain `.annotate` lands on the node; a CHECKED schema
  // needs the annotate-first order `wait.ts`'s `MillisecondsSchema` explains.
  text: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "Text to type into the terminal. Multiline text is bracketed-paste wrapped automatically. NEVER carries the submit — send Enter as its own call after observing the terminal settle.",
    }),
  ),
  key: Schema.optionalKey(
    Schema.String.annotate({
      description: `A named key (${ACCEPTED_KEY_NAMES}) or a modifier chord (C-c, M-b) to press. Mutually exclusive with text.`,
    }),
  ),
});
export type SendInputArgs = typeof SendInputArgsSchema.Type;

/** Resolve the tool args to the raw bytes `lifecycle.sendInput` writes — pure,
 *  so the XOR matrix and the key grammar are unit-tested apart from the wire.
 *  Throws loud on: both text and key (the dropped-Enter trap), neither
 *  (nothing to send), and an unknown key name (never a silent no-op). */
export function resolveSendInputData(args: {
  text?: string;
  key?: string;
}): string {
  if (args.text !== undefined && args.key !== undefined) {
    throw new Error(
      "text and key can't be combined in one send — a same-breath Enter is raced by the driven TUI's paste debounce and silently dropped. Send the text, wait for the terminal to settle (wait_outputSettled), then submit Enter as its own lifecycle_sendInput call.",
    );
  }
  if (args.key !== undefined) {
    const bytes = encodeKey(args.key);
    if (bytes === undefined) {
      throw new Error(
        `unknown key ${JSON.stringify(args.key)} — use a name (${ACCEPTED_KEY_NAMES}) or a chord (C-c, M-b).`,
      );
    }
    return bytes;
  }
  if (args.text !== undefined) {
    // kaval-tui's auto-paste rule: a single-line argument types literally;
    // multiline is wrapped so the agent's input box takes it as ONE block.
    return args.text.includes("\n") ? wrapBracketedPaste(args.text) : args.text;
  }
  throw new Error(
    "nothing to send — pass text (to type) or key (to press, e.g. Enter).",
  );
}

/** The bespoke tool. The client is the injected padiSurface client (typed by
 *  the consumer; the adapter holds it opaquely). */
export const sendInputTool: BespokeTool = {
  input: SendInputArgsSchema,
  mutates: true,
  description:
    "Write input to a terminal — text (typed; multiline auto-bracketed-pasted) OR one named key / chord (Enter, Escape, Tab, arrows, C-c, M-b, …), never both in one call. The submit protocol: send the text, wait_outputSettled, then send Enter as its own call.",
  // No `signal`: a surface procedure ref carries no cancellation handle any
  // more (D10/#18 — Effect RPC has none, and interruption is the fiber's), and
  // the handler's effect is already run under the request's signal by
  // `surface-mcp`'s ONE CallTool edge.
  handler: (args, client) => {
    const { id, ...rest } = args as SendInputArgs;
    const data = resolveSendInputData(rest);
    return Effect.as(
      (client as PadiSurfaceClient).surface.lifecycle.sendInput({ id, data }),
      // A named acknowledgement (sendInput's procedure output is void) so the
      // driving agent sees what landed rather than an empty null. The byte count
      // is the actual UTF-8 wire length (`data.length` counts UTF-16 code units,
      // which lies for non-ASCII input).
      {
        sent:
          rest.key !== undefined
            ? { key: rest.key }
            : { textBytes: Buffer.byteLength(data, "utf8") },
      },
    );
  },
};
