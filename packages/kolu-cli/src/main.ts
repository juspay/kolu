/**
 * kolu — the product binary's entry point (the kolu-cli plan,
 * docs/atlas/src/content/atlas/kolu-cli.mdx). The composition root: the command
 * tree decides, and only the arm the user asked for is ever loaded — each
 * face's boot is a dynamic import inside its handler, so `kolu mcp` never
 * touches the web server's module graph and a terminal verb loads neither.
 *
 * THE run edge, and the ONE place an exit code is decided.
 *
 * `NodeRuntime.runMain` rather than `Effect.runPromise` because kolu-cli's
 * exit-code map is LOCAL and tiny: every failure the program itself raises
 * carries its own `Runtime.errorExitCode`, so the default teardown reads the
 * code straight off the squashed cause. (padi's daemon edge inverts this for the
 * opposite reason — its map lives in the spine's `daemonProcessMain`, which
 * kaval rides too.) `errorReported: false` on those errors is what keeps the
 * user-facing line the ONE named message written below, not Effect's pretty
 * cause dump.
 *
 * The CLI LIBRARY's own errors are the exception this module exists to handle,
 * because they are already on screen by the time they reach here and they do not
 * all mean the same thing:
 *
 *   - `kolu --help` / `kolu --version` — the user ASKED for text, got it, and
 *     that is a successful run. Exit 0.
 *   - bare `kolu`, a typo'd subcommand, a rejected flag — the same
 *     help-was-printed failure, but the user did NOT ask for it. Exit 1, so a
 *     stale `ExecStart=kolu` or a mistyped verb in a script is LOUD rather than
 *     looking like a command that worked. This is the whole point of retiring
 *     the bare-`kolu`-boots-the-server alias: the failure mode it leaves behind
 *     must not be silent.
 *
 * Both arms print nothing extra — the library already rendered the help and the
 * reason — which is what {@link alreadyRendered} is for.
 */

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Runtime } from "effect";
import { Command } from "effect/unstable/cli";
import { serverVersion } from "kolu-server/src/hostname.ts";
import { koluCli } from "./cli.ts";
import { reportOf } from "./exit.ts";

/** The brand every `effect/unstable/cli` error carries.
 *
 *  Matched on the BRAND rather than on `_tag`: the library sets `_tag` to the
 *  short name (`ShowHelp`, `DuplicateOption`, …) and stamps this key alongside
 *  it, so a `_tag.startsWith("~effect/cli/")` test — the obvious-looking one —
 *  silently matches nothing and double-prints every diagnostic. */
const CLI_ERROR_BRAND = "~effect/cli/CliError";

/** Has the CLI library already put this failure's text on screen? A bare `kolu`
 *  printing the subcommand list, `--help`, `--version`, a usage error naming the
 *  flag it rejected — re-reporting any of them would print the diagnostic
 *  twice. */
const alreadyRendered = (err: unknown): boolean =>
  typeof err === "object" && err !== null && CLI_ERROR_BRAND in err;

/** Did the user EXPLICITLY ask for the text they got?
 *
 *  Read off argv rather than off the error, because the library raises the same
 *  `ShowHelp` for "you asked" and "you gave me nothing to do" — and only argv
 *  distinguishes them. Reading `process.argv` here, at the edge, keeps the tree
 *  itself a value a test can run with its own services. */
const askedForText = (): boolean =>
  process.argv
    .slice(2)
    .some(
      (a) => a === "--help" || a === "-h" || a === "--version" || a === "-v",
    );

/** A rendered CLI failure the user did not ask for — exit 1, print nothing (the
 *  library already did). Its own tagged shape so the exit-code marker rides the
 *  error exactly as every other failure's does, leaving the teardown a single
 *  rule rather than a special case. */
class UsageRefused {
  readonly [Runtime.errorExitCode] = 1;
  readonly [Runtime.errorReported] = false;
}

const program = Command.run(koluCli, { version: serverVersion });

NodeRuntime.runMain(
  program.pipe(
    Effect.catch((err) => {
      if (!alreadyRendered(err)) {
        // A failure this program raised: print its ONE line, then let the
        // teardown read the code off the error itself.
        return Effect.flatMap(
          Effect.sync(() => {
            process.stderr.write(reportOf(err));
          }),
          () => Effect.fail(err),
        );
      }
      // Already on screen. Requested text is a successful run; anything else is
      // a usage error that must not look like one.
      return askedForText() ? Effect.void : Effect.fail(new UsageRefused());
    }),
    Effect.provide(NodeServices.layer),
  ),
);
