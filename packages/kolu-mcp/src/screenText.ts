/**
 * `screen_text` — the MCP face's snapshot read, wrapping padiSurface's
 * `screen.text` with the TAIL mode the driving skills lean on ("read the last
 * N lines" — kaval-tui's `snapshot --viewport` idiom — stays ONE cheap call
 * for the agent instead of a whole-scrollback read it must slice itself).
 *
 * The raw procedure's `startLine`/`endLine` window is an absolute-line
 * addressing an agent can't use without already knowing the buffer length, so
 * the bespoke tool exposes `{ id, tail? }`: omitted tail returns the whole
 * rendered text; `tail: N` returns the last N lines. The slice happens here,
 * beside the padi hop (local socket or the ssh pipe) — the expensive wire is
 * MCP-host↔agent, and that carries only the tail.
 */

import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import type { BespokeTool } from "@kolu/surface-mcp";
import { z } from "zod";

export const ScreenTextArgsSchema = z.object({
  id: TerminalIdSchema,
  tail: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Return only the last N lines (omit for the whole scrollback)."),
});
export type ScreenTextArgs = z.infer<typeof ScreenTextArgsSchema>;

/** Slice the last `tail` NON-BLANK-TAIL lines of `text` — pure, unit-tested.
 *  The rendered buffer ends in a run of blank rows (the viewport below the
 *  cursor), which carry zero information and would otherwise BE the tail
 *  (`tail: 6` of a fresh shell returned six empty lines — caught by the
 *  evidence transcript). So every trailing whitespace-only line is dropped
 *  before the slice; blank lines BETWEEN content are kept verbatim. */
export function tailLines(text: string, tail: number): string {
  const lines = text.split("\n");
  let end = lines.length;
  while (end > 0 && (lines[end - 1] as string).trim() === "") end -= 1;
  return lines.slice(Math.max(0, end - tail), end).join("\n");
}

export const screenTextTool: BespokeTool = {
  input: ScreenTextArgsSchema,
  mutates: false,
  description:
    "A terminal's rendered screen + scrollback as plain text — the snapshot face. Pass tail: N to read only the last N lines (the cheap settle-check read).",
  handler: async (args, client, signal) => {
    const { id, tail } = args as ScreenTextArgs;
    const text: string = await client.surface.screen.text({ id }, { signal });
    return tail === undefined ? text : tailLines(text, tail);
  },
};
