/**
 * `kolu snapshot <id> [--tail N]` — print a terminal's RENDERED BUFFER as plain
 * text. The verb an agent-driving loop reads a reply with, and the reason the
 * whole CLI can be scripted: stdout is that text and nothing else, so
 * `kolu snapshot 3f9c | grep MARK-` matches the terminal's WORDS.
 *
 * A bare snapshot is the WHOLE buffer — scrollback and viewport together, which
 * on a long-running agent is thousands of lines, not a screenful. Calling that
 * "what the terminal shows now" (as this header and `--help` both once did) is
 * the kind of small lie a driving loop pays for; `--tail N` is the read that
 * answers "what's on screen".
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
 * takes an absolute `{startLine, endLine}` window or a `tail` — and neither
 * is "the viewport". Rather than approximate it client-side (guess a row count
 * and call it the viewport — a silent lie about which lines you are looking
 * at), the flag is simply absent, and `--tail N` is the whole bounding story.
 * That matches `screen_text{tail}` on the MCP face exactly, so the two faces
 * have one contract between them rather than one-and-a-half. `--tail N` rides
 * `screen.text` as `tail`; padi defines and applies the cut
 * (`@kolu/padi-client/screenTail`).
 */

import { shortId } from "@kolu/padi/render";
import { Effect } from "effect";
import type { Command } from "effect/cli";
// `import type` — fully erased, so this does NOT re-enter the command tree at
// runtime and the per-face dynamic-import fence is untouched.
import type { snapshotFlags } from "../cli.ts";
import { type Endpoint, withPadi } from "../endpoint.ts";
import { failure } from "../exit.ts";
import { resolveTerminal, writeErr, writeOutBlock } from "./shared.ts";

/** What the command tree hands this verb — DERIVED from `snapshotFlags` in
 *  `cli.ts`, which also carries the "a positive whole number of lines" rule, so
 *  `tail` arrives here already legal (or the parse already refused). */
export type SnapshotArgs = Command.Command.Config.Infer<typeof snapshotFlags>;

// ── the verb ─────────────────────────────────────────────────────────────────

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
  // `--tail` arrives legal or not at all: `Flag.Int` refuses a non-integer
  // and `positiveLines` refuses a non-positive one, both during the parse (see
  // `cli.ts`). "The last zero lines" means nothing and would print an empty
  // snapshot that reads like a dead terminal — so it is unspellable, not
  // re-checked here.
  const tail = args.tail;

  const { text, id } = yield* withPadi(endpoint, (conn) =>
    Effect.gen(function* () {
      const id = yield* resolveTerminal(conn, args.id);
      const text = yield* Effect.catchTag(
        conn.client.surface.screen.text(
          tail === undefined ? { id } : { id, tail },
        ),
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

  yield* writeOutBlock(text, "the screen text");
  const lines = lineCount(text);
  yield* writeErr(
    `— ${shortId(id)} · ${lines} line${lines === 1 ? "" : "s"}\n`,
  );
});
