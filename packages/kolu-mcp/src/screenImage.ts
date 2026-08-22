/**
 * `screen_image` — the MCP face's PICTURE read, wrapping padiSurface's
 * `screen.image`.
 *
 * The sibling of `screen_text`, and the reason it exists: `screen_text`
 * flattens the screen to characters, which throws away everything a terminal
 * UI uses to MEAN something. Colour is how a diff says added-vs-removed and
 * how a test run says pass-vs-fail; a box-drawing frame is what makes a TUI a
 * layout rather than a wall of punctuation; a highlighted row is what says
 * "this one is selected". An agent driving another agent through kolu reads a
 * text dump and cannot see any of it. This hands the model the same picture a
 * human would look at.
 *
 * `screen_text` stays the default read and this does NOT replace it: text is
 * far cheaper in context, greppable, and enough for "did the command finish".
 * Reach for the image when the answer is visual — a TUI's state, a rendered
 * diff, a chart, "what does the screen actually look like right now".
 *
 * The result is an MCP IMAGE content block, not base64 inside JSON, so a host
 * renders it and the model sees pixels (see `okImage`). The arg schema follows
 * the same annotate-first-check-second law `screen_text` documents at length —
 * the per-field blurbs are what teach an agent that `lines` counts ROWS.
 */

import type { PadiSurfaceClient } from "@kolu/padi/dial";
import { SCREEN_IMAGE_MAX_ROWS } from "@kolu/padi/surface";
import type { BespokeTool } from "@kolu/surface-mcp";
import { okImage } from "@kolu/surface-mcp";
import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import { Schema } from "effect";

export const ScreenImageArgsSchema = Schema.Struct({
  id: TerminalIdSchema,
  lines: Schema.optionalKey(
    Schema.Number.annotate({
      description: `Capture only the last N rendered rows (1-${SCREEN_IMAGE_MAX_ROWS}). Omit for the visible screen, which is almost always what you want.`,
    }).check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(SCREEN_IMAGE_MAX_ROWS),
    ),
  ),
});
export type ScreenImageArgs = typeof ScreenImageArgsSchema.Type;

/** What `screen.image` hands back — the PNG plus the grid it rendered. */
interface ScreenImageReply {
  mimeType: "image/png";
  data: string;
  cols: number;
  rows: number;
}

export const screenImageTool: BespokeTool = {
  input: ScreenImageArgsSchema,
  mutates: false,
  title: "Screenshot a terminal",
  description:
    "A terminal's screen as a PNG image, themed and rendered the way the user sees it — colours, box drawing, highlights and all. Use it when the answer is visual (a TUI's state, a rendered diff, a chart); use screen_text when plain characters will do, since it is much cheaper.",
  handler: (args, client) => {
    const { id, lines } = args as ScreenImageArgs;
    return (client as PadiSurfaceClient).surface.screen.image({
      id,
      // SPREAD, never spell: `lines` is `Schema.optionalKey` on padi's wire and
      // that input is DECODED, so an absent key is accepted where a
      // present-but-`undefined` one is rejected.
      ...(lines !== undefined && { lines }),
    });
  },
  // The picture is the answer, so it travels as an image block; the caller
  // still gets the dimensions (and the bytes) in the structured arm.
  render: (out) => {
    const { data, mimeType, cols, rows } = out as ScreenImageReply;
    // The bytes ride the image block ONLY. Repeating them in the structured
    // arm would double a ~50KB base64 payload for a reader that does not
    // exist on this path — the host renders the image, and an agent reading
    // `structuredContent` wants the dimensions, not the pixels.
    return okImage({ mimeType, data }, { mimeType, cols, rows });
  },
};
