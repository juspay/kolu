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
 *
 * The arg schema is an Effect Schema. Its per-field blurbs are not decoration:
 * they are what teaches a coding agent that `tail` counts LINES. Two authoring
 * laws make them land where a host renders them, both pinned by
 * `argSchemas.test.ts`:
 *
 *   - **ANNOTATE FIRST, CHECK SECOND.** `SchemaAST.annotate` attaches to the
 *     schema's LAST CHECK when it has one, and the converter emits a check's
 *     annotations inside an `allOf` branch — where no MCP host looks for a
 *     property description. `Schema.Int` is itself `Schema.Number.check(isInt())`,
 *     so even a bare `Schema.Int.annotate({description})` loses the blurb. The
 *     spelling that keeps it on the property node is to annotate the CHECK-FREE
 *     base and add every check after.
 *   - the numeric must still advertise as an INTEGER, never as bare
 *     `Schema.Number` (whose encoded form also admits the STRINGS
 *     `"NaN"`/`"Infinity"` — D8/#14 divergence 2). `.check(Schema.isInt())`
 *     supplies exactly that, and it composes with the law above.
 *
 * The annotation also has to sit INSIDE `optionalKey` — on the encoded-side
 * node, before any wrapper — which is `jsonschema.ts`'s own stated law.
 */

// The tail slice is padi's — a pure fold over `screen.text`'s own reply shape,
// shared with `kolu snapshot --tail`, which used to import it from THIS module
// (a CLI verb reaching sideways into a face's adapter).
import { tailLines } from "@kolu/padi-client/screenTail";
import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type { BespokeTool } from "@kolu/surface-mcp/tools";
import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import { Effect, Schema } from "effect";

export const ScreenTextArgsSchema = Schema.Struct({
  id: TerminalIdSchema,
  tail: Schema.optionalKey(
    Schema.Number.annotate({
      description:
        "Return only the last N lines (omit for the whole scrollback).",
    }).check(Schema.isInt(), Schema.isGreaterThan(0)),
  ),
});
export type ScreenTextArgs = typeof ScreenTextArgsSchema.Type;

export const screenTextTool: BespokeTool = {
  input: ScreenTextArgsSchema,
  mutates: false,
  title: "Read a terminal's screen",
  description:
    "A terminal's rendered screen + scrollback as plain text — the snapshot face. Pass tail: N to read only the last N lines (the cheap settle-check read).",
  // No `signal`: a surface procedure ref carries no cancellation handle any
  // more (D10/#18 — Effect RPC has none, and interruption is the fiber's), and
  // the handler's effect is already run under the request's signal by
  // `surface-mcp`'s ONE CallTool edge.
  handler: (args, client) => {
    const { id, tail } = args as ScreenTextArgs;
    return Effect.map(
      (client as PadiSurfaceClient).surface.screen.text({ id }),
      (text: string) => (tail === undefined ? text : tailLines(text, tail)),
    );
  },
};
