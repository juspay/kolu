import { refusingAsleep } from "./asleep.ts";
import { padiOf } from "./bundleClient.ts";
import { ScreenTextTailSchema } from "@kolu/padi-client/surface";
import type { BespokeTool } from "@kolu/surface-mcp/tools";
import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import { Schema } from "effect";

export const ScreenTextArgsSchema = Schema.Struct({
  id: TerminalIdSchema,
  tail: Schema.optionalKey(
    ScreenTextTailSchema.annotate({
      description:
        "Return only the last N lines (omit for the whole scrollback).",
    }),
  ),
});
export type ScreenTextArgs = typeof ScreenTextArgsSchema.Type;

export const screenTextTool: BespokeTool = {
  input: ScreenTextArgsSchema,
  mutates: false,
  title: "Read a terminal's screen",
  description:
    "A terminal's rendered screen + scrollback as plain text — the snapshot face. Pass tail: N to read only the last N lines (the cheap settle-check read).",
  handler: (args, client) => {
    const { id, tail } = args as ScreenTextArgs;
    return refusingAsleep(
      padiOf(client).surface.screen.text(
        tail === undefined ? { id } : { id, tail },
      ),
    );
  },
};
