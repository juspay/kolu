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
 *
 * An EMPTY `text` is refused, not written: a 0-byte write answered with success
 * reads, to the agent whose prompt template rendered empty, exactly like a send
 * that landed. That refusal is the shared policy's, so this face and `kolu send`
 * give the same answer to the same intent.
 */

import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import {
  ACCEPTED_KEY_NAMES,
  encodeSend,
  type SendPlan,
  type SendVocabulary,
  sendShapeRefusal,
} from "@kolu/terminal-protocol";
import type { PadiSurfaceClient } from "@kolu/padi/dial";
import { type BespokeTool, ToolFailure } from "@kolu/surface-mcp/tools";
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

/** This face's spelling of the shared send policy — the field it names in a
 *  refusal, and the tool-call ritual it quotes. The RULES themselves
 *  (text-XOR-key, the unknown-key refusal, auto bracketed paste, the
 *  empty-payload refusal) are
 *  `@kolu/terminal-protocol`'s `sendPolicy`, shared with `kolu send`: they are
 *  one policy about a TUI's paste debounce, not two faces' vocabularies, and
 *  they used to be implemented independently on each — so a driver that
 *  switched from argv to MCP could get a different answer to the same intent. */
const MCP_SEND_VOCABULARY: SendVocabulary = {
  keyName: "key",
  submitRitual:
    "  lifecycle_sendInput { text }   # 1. the text\n" +
    "  wait_outputSettled             # 2. observe the terminal settle\n" +
    "  lifecycle_sendInput { key: 'Enter' }   # 3. submit",
};

/** The machine-readable half of a refusal, carried beside the shared policy's
 *  sentence in `ToolFailure.detail` — because a driver's recovery differs per
 *  kind, and reading it out of the prose means parsing English:
 *  `text-and-key` ⇒ re-send as two calls; `key-refused` ⇒ pick a name from the
 *  accepted list (the rejected spelling rides along as `key`); `text-refused`
 *  ⇒ the shared encoder refused this face's text — today, because it was empty;
 *  `no-input` ⇒ neither field was passed at all.
 *
 *  The kinds name the BRANCH, not the shared policy's internal reason: the
 *  sentence already carries the reason, and a kind that claimed it would go
 *  quietly wrong the day `@kolu/terminal-protocol` adds a refusal. And they are
 *  named HERE rather than pushed into that package, because the caller always
 *  knows which branch it is in — a `kind` on `SendEncoding` would be a field the
 *  shared policy carries for one consumer's benefit.
 *
 *  WHAT THAT COSTS, stated rather than left to be discovered. A branch can hold
 *  more than one of the shared policy's rules, and two do:
 *
 *    - the KEYS branch refuses on an empty name list as well as on an unknown
 *      name (`sendPolicy.ts`'s `encodeSend`), and `key-refused`'s recovery
 *      ("pick a name from the accepted list") fits only the second. It is
 *      UNREACHABLE from this face, and structurally so rather than by luck: this
 *      face has ONE `key` field and passes `names: [args.key]` inside the
 *      `args.key !== undefined` branch, so the list is always length 1. The
 *      empty-list refusal exists for a face that gathers keys from a variadic
 *      argv, which this is not.
 *    - `text-and-key` names the reason, not the branch, and is the deliberate
 *      exception: it is the recovery a driver most needs to branch on. It is
 *      sound only while `sendShapeRefusal` refuses exactly the both-supplied
 *      shape. If that gate ever grows a second refusal, this kind must split
 *      before it ships. */
export type SendRefusal =
  | { readonly kind: "text-and-key" }
  | { readonly kind: "key-refused"; readonly key: string }
  | { readonly kind: "text-refused" }
  | { readonly kind: "no-input" };

const refuse = (
  message: string,
  detail: SendRefusal,
): ToolFailure<SendRefusal> => new ToolFailure(message, detail);

/** Resolve the tool args to the WRITE PLAN `lifecycle.sendInput` carries out —
 *  pure, so the XOR matrix and the key grammar are unit-tested apart from the
 *  wire. The plan, not the bare string, because the encoder already counted the
 *  UTF-8 bytes it wrote and the acknowledgement below reports them: recounting
 *  here is how the two faces would come to disagree about the size of the
 *  identical send the next time a paste marker moves.
 *
 *  Throws loud on: both text and key (the dropped-Enter trap), neither (nothing
 *  to send), an EMPTY text (a 0-byte write is a no-op, not a submit), and an
 *  unknown key name (never a silent no-op). All but the second are the shared
 *  policy's; this face only supplies its vocabulary.
 *
 *  Every one of those throws is a {@link ToolFailure}, so the refusal reaches
 *  the agent as an `isError` result whose `structuredContent` says which rule it
 *  broke ({@link SendRefusal}) — a driver picks its recovery from a tag instead
 *  of matching the sentence.
 *
 *  The NEITHER-field rule is the one that stays HERE: what counts as a text
 *  source is each face's own (this face has one field; `kolu send` has a
 *  positional, `--file` and piped stdin), so the sentence names this face's. */
export function resolveSendInputData(args: {
  text?: string;
  key?: string;
}): SendPlan {
  const illegal = sendShapeRefusal(
    { hasText: args.text !== undefined, hasKeys: args.key !== undefined },
    MCP_SEND_VOCABULARY,
  );
  if (illegal !== undefined) throw refuse(illegal, { kind: "text-and-key" });

  if (args.key !== undefined) {
    const encoded = encodeSend(
      { kind: "keys", names: [args.key] },
      MCP_SEND_VOCABULARY,
    );
    if (encoded.kind === "refused")
      throw refuse(encoded.message, { kind: "key-refused", key: args.key });
    return encoded.plan;
  }
  if (args.text !== undefined) {
    // Auto-paste with no override and no stream: a single-line argument types
    // literally, multiline is wrapped so the agent's input box takes it as ONE
    // block. This face has no `--paste` and no file/pipe payload, so both
    // knobs are stated as absent rather than left to a default. `sourceLabel` is
    // this face's ONE text source, named as the caller spells it, so an empty
    // payload is refused as `text is empty` rather than argv's `--file "…"`.
    const encoded = encodeSend(
      {
        kind: "text",
        text: args.text,
        sourceLabel: "text",
        paste: undefined,
        fromStream: false,
      },
      MCP_SEND_VOCABULARY,
    );
    if (encoded.kind === "refused")
      throw refuse(encoded.message, { kind: "text-refused" });
    return encoded.plan;
  }
  throw refuse(
    "nothing to send — pass text (to type) or key (to press, e.g. Enter).",
    { kind: "no-input" },
  );
}

/** The bespoke tool. The client is the injected padiSurface client (typed by
 *  the consumer; the adapter holds it opaquely). */
export const sendInputTool: BespokeTool = {
  input: SendInputArgsSchema,
  mutates: true,
  title: "Send input to a terminal",
  description:
    "Write input to a terminal — text (typed; multiline auto-bracketed-pasted) OR one named key / chord (Enter, Escape, Tab, arrows, C-c, M-b, …), never both in one call. The submit protocol: send the text, wait_outputSettled, then send Enter as its own call.",
  // No `signal`: a surface procedure ref carries no cancellation handle any
  // more (D10/#18 — Effect RPC has none, and interruption is the fiber's), and
  // the handler's effect is already run under the request's signal by
  // `surface-mcp`'s ONE CallTool edge.
  handler: (args, client) => {
    const { id, ...rest } = args as SendInputArgs;
    const plan = resolveSendInputData(rest);
    return Effect.as(
      (client as PadiSurfaceClient).surface.lifecycle.sendInput({
        id,
        data: plan.write,
      }),
      // A named acknowledgement (sendInput's procedure output is void) so the
      // driving agent sees what landed rather than an empty null. The byte count
      // is the encoder's own UTF-8 total for the write it planned — the same
      // number `kolu send` reports for the same send, paste markers included.
      {
        sent:
          rest.key !== undefined
            ? { key: rest.key }
            : { textBytes: plan.bytes },
      },
    );
  },
};
