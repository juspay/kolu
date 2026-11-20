import { refusingAsleep } from "./asleep.ts";
import { padiOf } from "./bundleClient.ts";
import type { PadiScreenImageOutput } from "@kolu/padi-client/surface";
import {
  SCREEN_IMAGE_MAX_ROWS,
  ScreenImageLinesSchema,
} from "@kolu/padi-client/surface";
import type { BespokeTool } from "@kolu/surface-mcp/tools";
import { okImage } from "@kolu/surface-mcp/tools";
import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import { Schema } from "effect";

export const ScreenImageArgsSchema = Schema.Struct({
  id: TerminalIdSchema,
  lines: Schema.optionalKey(
    ScreenImageLinesSchema.annotate({
      description: `Capture only the last N rendered rows (1-${SCREEN_IMAGE_MAX_ROWS}). Omit for the visible screen, which is almost always what you want.`,
    }),
  ),
});
export type ScreenImageArgs = typeof ScreenImageArgsSchema.Type;

export const screenImageTool: BespokeTool = {
  input: ScreenImageArgsSchema,
  mutates: false,
  title: "Screenshot a terminal",
  description:
    "A terminal's screen as a PNG image, themed and rendered the way the user sees it — colours, box drawing, highlights and all. Use it when the answer is visual (a TUI's state, a rendered diff, a chart); use screen_text when plain characters will do, since it is much cheaper.",
  handler: (args, client) => {
    const { id, lines } = args as ScreenImageArgs;
    return refusingAsleep(
      padiOf(client).surface.screen.image({
        id,
        ...(lines !== undefined && { lines }),
      }),
    );
  },
  render: (out) => {
    const { data, mimeType, cols, rows } = out as PadiScreenImageOutput;
    return okImage({ mimeType, data }, { mimeType, cols, rows });
  },
};
