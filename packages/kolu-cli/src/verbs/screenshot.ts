/**
 * `kolu screenshot <id> [--lines N] [-o FILE]` — write a terminal's screen as a
 * PNG, themed and rendered the way the user sees it.
 *
 * The picture twin of `kolu snapshot`. Where `snapshot` flattens the screen to
 * characters — losing the colour that says pass-vs-fail, the box drawing that
 * makes a TUI a layout, the highlight that says "this row is selected" — this
 * keeps all of it. Same daemon-side renderer the browser's copy-screenshot
 * action and the `screen_image` MCP tool use, so all three faces show the same
 * picture of the same terminal.
 *
 * ## Why the default is a FILE, not stdout
 *
 * PNG is binary, and this CLI's whole scriptability rests on stdout being the
 * answer and nothing else (`kolu snapshot 3f9c | grep MARK-`). Spraying image
 * bytes into a terminal is the one output that can leave the reader's tty in a
 * broken state, so bytes go to stdout ONLY when the caller asked for it
 * explicitly with `-o -` and redirected it. Otherwise the file is written and
 * its path is reported on stderr, keeping stdout empty and the pipeline honest.
 *
 * ## Why `--lines` and not `--tail`
 *
 * It bounds ROWS OF THE PICTURE, which is a different question from `snapshot
 * --tail`'s "how much text do I want back". The default is the viewport — the
 * live grid's own height, resolved daemon-side because only the daemon knows
 * how tall the PTY currently is — which is what "screenshot the terminal"
 * means to anyone who asks for it.
 */

import { writeFile } from "node:fs/promises";
import { shortId } from "@kolu/padi/render";
import { Effect } from "effect";
import type { Command } from "effect/unstable/cli";
// `import type` — fully erased, so this does NOT re-enter the command tree at
// runtime and the per-face dynamic-import fence is untouched.
import type { screenshotFlags } from "../cli.ts";
import { type Endpoint, withPadi } from "../endpoint.ts";
import { errorMessage, failure } from "../exit.ts";
import { resolveTerminal, writeErr, writeOut } from "./shared.ts";

/** What the command tree hands this verb — DERIVED from `screenshotFlags` in
 *  `cli.ts`, which carries the "a positive whole number of rows, capped" rule,
 *  so `lines` arrives here already legal (or the parse already refused). */
export type ScreenshotArgs = Command.Command.Config.Infer<
  typeof screenshotFlags
>;

/** The sentinel that means "write the bytes to stdout". Spelled `-` because
 *  that is what every other tool spells it, and it must be TYPED by the caller
 *  — there is no way to get binary on stdout by accident. */
const STDOUT = "-";

/** Where the PNG goes when the caller named no path. A timestamp would need a
 *  clock in a verb that otherwise has none, and an overwrite of a fixed name is
 *  what a caller who did not choose a path almost always wants — they are
 *  looking at the picture, not collecting a series. */
const DEFAULT_OUT = "kolu-screenshot.png";

export const run = Effect.fn("kolu screenshot")(function* (
  endpoint: Endpoint,
  args: ScreenshotArgs,
) {
  const lines = args.lines;

  const { image, id } = yield* withPadi(endpoint, (conn) =>
    Effect.gen(function* () {
      const id = yield* resolveTerminal(conn, args.id);
      const image = yield* Effect.catchTag(
        conn.client.surface.screen.image({
          id,
          // SPREAD, never spell: `lines` is `optionalKey` on padi's wire and
          // that input is DECODED, so an absent key is accepted where a
          // present-but-`undefined` one is rejected.
          ...(lines !== undefined && { lines }),
        }),
        "TerminalNotFound",
        () =>
          Effect.fail(
            failure(
              `terminal ${shortId(id)} ended between listing it and reading its screen — nothing to screenshot.`,
            ),
          ),
      );
      return { image, id };
    }),
  );

  const png = Buffer.from(image.data, "base64");
  const out = args.out ?? DEFAULT_OUT;

  if (out === STDOUT) {
    // The SAME stdout path every other verb uses — backpressure-aware, and
    // treating a hung-up reader (`kolu screenshot … -o - | head -c 100`) as a
    // complete run rather than a failure. Writing the bytes here by hand is
    // what made this verb the only one in the CLI that exited non-zero on a
    // pipe the reader closed.
    yield* writeOut(png, "the PNG");
    yield* writeErr(
      `— ${shortId(id)} · ${image.cols}x${image.rows} · ${png.length} bytes\n`,
    );
    return;
  }

  yield* Effect.tryPromise({
    try: () => writeFile(out, png),
    catch: (err) => failure(`could not write ${out}: ${errorMessage(err)}`),
  });
  yield* writeErr(
    `— ${shortId(id)} · ${image.cols}x${image.rows} · ${png.length} bytes → ${out}\n`,
  );
});
