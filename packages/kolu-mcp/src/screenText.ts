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

/** Slice the last `tail` lines of `text` — pure, unit-tested. A trailing
 *  newline delimits an empty final line the terminal never renders, so it is
 *  dropped BEFORE the slice (tail:1 of "a\nb\n" is "b", not ""). */
export function tailLines(text: string, tail: number): string {
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-tail).join("\n");
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
