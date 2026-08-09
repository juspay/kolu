/**
 * `kolu snapshot <id> [--tail N]` — print what a terminal shows RIGHT NOW as
 * plain text. The verb an agent-driving loop reads a reply with, and the reason
 * the whole CLI can be scripted: stdout is the screen text and nothing else, so
 * `kolu snapshot 3f9c | grep MARK-` matches the terminal's WORDS.
 *
 * ## Why `screen.text` and not the attach stream
 *
 * `terminalAttach`'s first frame is the SERIALIZED xterm screen (VT escape
 * sequences) meant for a late-attaching renderer. Piping that to a tty would
 * replay its control effects, and grepping it would match against escape bytes.
 * `screen.text` is the rendered buffer — the same read the MCP face's
 * `screen_text` tool makes, so the two faces show a driving agent the same
 * thing.
 *
 * ## Why there is no `--viewport`
 *
 * kaval-tui's `snapshot` had one, because kaval's `getScreenText` took an
 * `extent` the DAEMON interpreted ("the last screenful"). padi's `screen.text`
 * takes only `{startLine, endLine}` — absolute line addressing — and no padi
 * member reports a terminal's current grid size, so "the viewport" is not a
 * thing this wire can express. Rather than approximate it client-side (guess a
 * row count and call it the viewport — a silent lie about which lines you are
 * looking at), the flag is simply absent, and `--tail N` is the whole bounding
 * story. That matches `screen_text{tail}` on the MCP face exactly, so the two
 * faces have one contract between them rather than one-and-a-half.
 *
 * ## Why the tail is sliced HERE
 *
 * The slice happens beside the padi hop, and `tailLines` is imported from the
 * MCP face (`kolu-mcp/screenText`) rather than re-derived: it also drops the
 * trailing run of whitespace-only rows, which is what a rendered buffer ends in
 * (the empty viewport below the cursor). Without that, `--tail 6` on a fresh
 * shell prints six blank lines — a real bug caught on the MCP side, and one this
 * verb would otherwise have re-introduced by writing its own three-line slice.
 */

import { shortId } from "@kolu/padi/render";
import { Effect, Option } from "effect";
import { tailLines } from "kolu-mcp/screenText";
import { type Endpoint, withPadi } from "../endpoint.ts";
import { type CliFailure, failure } from "../exit.ts";
import { resolveTerminal, writeErr, writeOut } from "./shared.ts";

/** What the command tree hands this verb (see `snapshot` in `cli.ts`). */
export interface SnapshotArgs {
  readonly id: string;
  readonly tail: Option.Option<number>;
}

// ── the verb ─────────────────────────────────────────────────────────────────

/** Write one block to stdout with exactly one trailing newline. The draining
 *  sink itself is `./shared.ts`'s (a whole screen written to a pipe must flush
 *  before the process exits); only the "exactly one newline" rule is this
 *  verb's. */
const writeOutLine = (text: string): Effect.Effect<void, CliFailure> =>
  writeOut(text.endsWith("\n") ? text : `${text}\n`, "the screen text");

/** How many lines the block we printed actually is — derived from the text we
 *  already hold, so the trailer costs no second round-trip and can never
 *  disagree with what went to stdout. The rendered buffer ends in a newline the
 *  reader does not count as a line of its own. */
const lineCount = (text: string): number =>
  text === "" ? 0 : text.replace(/\n+$/, "").split("\n").length;

/**
 * Dial, resolve the id, read the screen, print it, release. The link is not held
 * past the read — a snapshot is a still image, and `withPadi` closes the scope
 * around the whole body either way.
 */
export const run = Effect.fn("kolu snapshot")(function* (
  endpoint: Endpoint,
  args: SnapshotArgs,
) {
  const tail = Option.getOrUndefined(args.tail);
  // `Flag.integer` already refuses a non-integer; a non-POSITIVE tail is still
  // spellable and means nothing ("the last zero lines"), so refuse it rather
  // than printing an empty snapshot that looks like a dead terminal.
  if (tail !== undefined && tail <= 0) {
    return yield* Effect.fail(
      failure(`--tail takes a positive whole number of lines, got ${tail}.`),
    );
  }

  const { text, id } = yield* withPadi(endpoint, (conn) =>
    Effect.gen(function* () {
      const id = yield* resolveTerminal(conn, args.id);
      const text = yield* Effect.catchTag(
        conn.client.surface.screen.text({ id }),
        "TerminalNotFound",
        () =>
          Effect.fail(
            failure(
              `terminal ${shortId(id)} ended between listing it and reading its screen — nothing to snapshot.`,
            ),
          ),
      );
      return { text, id };
    }),
  );

  const printed = tail === undefined ? text : tailLines(text, tail);
  yield* writeOutLine(printed);
  const lines = lineCount(printed);
  yield* writeErr(
    `— ${shortId(id)} · ${lines} line${lines === 1 ? "" : "s"}\n`,
  );
});
