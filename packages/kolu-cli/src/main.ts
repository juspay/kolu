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
 *
 * ## The one arm that does NOT come through here: 130
 *
 * `runMain` turns SIGINT/SIGTERM into fiber interruption, and an interrupt is
 * not a typed failure: the catchCause below PASSES IT THROUGH untouched (the
 * runtime's own teardown answers an interrupts-only cause with 130), and no
 * constructor here can be the thing that happens instead — but the LINE that
 * rides it has to be written before the cause unwinds, from a finalizer, which
 * is what `verbs/wait.ts`'s `withInterruptReport` does. So: every arm's line
 * is written here EXCEPT the interrupted one, and that is a property of
 * Effect's interruption, not a second reporting policy.
 *
 * ## And the arm `catch` never saw: a defect
 *
 * The catch is `catchCause`, not `catch`, on purpose: a DEFECT is not a
 * failure, and a defect reaching `runMain`'s own reporting gets its pretty
 * dump written onto STDOUT — the data channel every face of this binary
 * prints on (`kolu ls --json`, `kolu snapshot`, `kolu surface get …`), where
 * the dump is a corrupted pipe, not a report. A defect is folded into the
 * one-line shape below (exit 1, as before) — see {@link failureFor}.
 */

// SUBPATH imports, never the `@effect/platform-node` barrel. The barrel
// re-exports the whole platform — HTTP server, cluster transports, the worker
// runner, and with them ioredis / undici / ws / msgpackr and node:http,
// node:zlib, node:child_process — and it does so BEFORE `cli.ts` is even
// reached, which is the largest hole one can put in the lazy-loading contract
// stated above: `kolu ls` would pay for a web server it never boots. Two
// symbols, two subpaths, measured at 391 → 257 loaded modules and −34% wall
// clock on `kolu --help`, −21% on a real verb. This is the spelling the rest of
// the repo already uses (`surface/src/peer-server.ts`, `unix-socket.ts`,
// `links/wire.ts`).
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Cause, Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { serverVersion } from "kolu-server/src/hostname.ts";
import { koluCli } from "./cli.ts";
import {
  CliFailure,
  errorMessage,
  isContractArm,
  reportOf,
  UsageRefused,
} from "./exit.ts";

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
 *  `ShowHelp` for "you asked" and "you gave me nothing to do", and the only
 *  signal the value carries — `ShowHelp.errors` — says the opposite of what this
 *  binary promises for the second case: bare `kolu` arrives with an EMPTY
 *  `errors` (the root simply has no handler), which the library scores 0 and the
 *  contract above scores 1. Only argv separates them. Reading `process.argv`
 *  here, at the edge, keeps the tree itself a value a test can run with its own
 *  services.
 *
 *  Only the tokens BEFORE the first `--` are kolu's. Everything after it is the
 *  payload argv — the agent `kolu create` is about to launch — and that agent's
 *  own flags are none of kolu's business:
 *
 *      kolu create --nope -- claude --help
 *
 *  is a usage error (`--nope`) carrying somebody else's `--help`. Scanning the
 *  whole of argv read that `--help` as "the user asked for text" and exited 0,
 *  so a script saw a rejected flag as a command that worked — the exact silence
 *  this module exists to prevent. The parser draws the same line (it hands the
 *  post-`--` tokens through as trailing operands and never looks for its own
 *  flags in them), so matching it here keeps ONE story about who owns a token.
 *
 *  With the pinned `effect` this arm is a GUARD rather than the mechanism: the
 *  built-in `--help` / `--version` are action flags that print and return
 *  SUCCESS, so a real help request never reaches this catch at all. That is the
 *  library's choice, not its contract — earlier parsers raised a zero-coded
 *  `ShowHelp` instead — and the arm costs one argv read to keep the exit
 *  contract stated here true under either. */
const askedForText = (): boolean => {
  const given = process.argv.slice(2);
  const separator = given.indexOf("--");
  const kolusOwn = separator === -1 ? given : given.slice(0, separator);
  return kolusOwn.some(
    (a) => a === "--help" || a === "-h" || a === "--version" || a === "-v",
  );
};

const program = Command.run(koluCli, { version: serverVersion });

/** What the edge re-fails a non-library failure with.
 *
 *  A failure this binary raised KEEPS its identity: an arm of either face's
 *  contract (kolu-cli's `CliFailure`, the surface face's `SurfaceCliFailure`)
 *  carries its own exact line and its own exit code, so it re-fails as-is and
 *  the teardown reads the code off it. A failure that is NO arm — a defect a
 *  command let escape — gets neither fidelity: it gets the ONE-LINE shape of
 *  `reportOf`, written HERE (not by the runtime's reporter), and exit 1.
 *
 *  The wrap is what makes "stdout is data" true of a crash. Left alone, a
 *  defect reached `runMain`'s own reporting (`tapCause` + `Effect.logError`),
 *  whose default logger writes the pretty dump ONTO STDOUT — the channel every
 *  face of this binary prints data on (`kolu ls --json`, `kolu snapshot`,
 *  `kolu surface get …`), so a crashing verb corrupted the very pipe a driver
 *  was reading. The wrapped envelope marks itself already-reported, so the run
 *  edge prints exactly one line, on stderr, and nothing else says it again.
 *  The dump was never part of the contract: exit 1 was, and stays. */
const failureFor = (err: unknown): CliFailure | unknown =>
  isContractArm(err)
    ? err
    : // Identity is BY TAG, never by the `.stderr` payload: a foreign rejection
      // carrying one (an execa-style process error) is a defect to wrap, not a
      // contract arm — untagged, it would ride through marker-free and the
      // runtime's own reporter would dump its cause ONTO STDOUT beside the
      // wrapped line, double-speaking the one place "stdout is data" holds.
      new CliFailure({
        reason: errorMessage(err),
        stderr: reportOf(err),
        code: 1,
      });

NodeRuntime.runMain(
  program.pipe(
    Effect.catchCause((cause) => {
      // A Ctrl-C is the 130 the contract publishes, the runtime's own teardown
      // reading an interrupts-only cause — never a typed failure of ours, so
      // hand the cause straight back, untouched.
      if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
      const err = Cause.squash(cause);
      if (!alreadyRendered(err)) {
        const out = failureFor(err);
        // A failure this program raised (or a defect that escaped it — see the
        // header): print its ONE line, then let the teardown read the code off
        // the failure itself.
        return Effect.flatMap(
          Effect.sync(() => {
            process.stderr.write(reportOf(out));
          }),
          () => Effect.fail(out),
        );
      }
      // Already on screen. Requested text is a successful run; anything else is
      // a usage error that must not look like one.
      return askedForText() ? Effect.void : Effect.fail(new UsageRefused());
    }),
    Effect.provide(NodeServices.layer),
  ),
);
