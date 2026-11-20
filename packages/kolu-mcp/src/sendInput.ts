import { padiOf } from "./bundleClient.ts";
import { type BespokeTool, ToolFailure } from "@kolu/surface-mcp/tools";
import {
  ACCEPTED_KEY_NAMES,
  encodeSend,
  type SendPlan,
  type SendVocabulary,
  sendShapeRefusal,
} from "@kolu/terminal-protocol";
import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import { Effect, Schema } from "effect";

export const SendInputArgsSchema = Schema.Struct({
  id: TerminalIdSchema,
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

const MCP_SEND_VOCABULARY: SendVocabulary = {
  keyName: "key",
  submitRitual:
    "  lifecycle_sendInput { text }   # 1. the text\n" +
    "  wait_outputSettled             # 2. observe the terminal settle\n" +
    "  lifecycle_sendInput { key: 'Enter' }   # 3. submit",
};

export type SendRefusal =
  | { readonly kind: "text-and-key" }
  | { readonly kind: "key-refused"; readonly key: string }
  | { readonly kind: "text-refused" }
  | { readonly kind: "no-input" };

const refuse = (
  message: string,
  detail: SendRefusal,
): ToolFailure<SendRefusal> => new ToolFailure(message, detail);

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

export const sendInputTool: BespokeTool = {
  input: SendInputArgsSchema,
  mutates: true,
  title: "Send input to a terminal",
  description:
    "Write input to a terminal — text (typed; multiline auto-bracketed-pasted) OR one named key / chord (Enter, Escape, Tab, arrows, C-c, M-b, …), never both in one call. The submit protocol: send the text, wait_outputSettled, then send Enter as its own call.",
  handler: (args, client) => {
    const { id, ...rest } = args as SendInputArgs;
    const plan = resolveSendInputData(rest);
    return Effect.as(
      padiOf(client).surface.lifecycle.sendInput({
        id,
        data: plan.write,
      }),
      {
        sent:
          rest.key !== undefined
            ? { key: rest.key }
            : { textBytes: plan.bytes },
      },
    );
  },
};
