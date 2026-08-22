/**
 * The CLI face's EXIT CONTRACT, as values.
 *
 * The codes are a user-visible contract — a driving loop branches on them ("the
 * verb said no" vs "my command was wrong" vs "nothing is serving there") — so
 * they live in one module with a test that pins the whole matrix, rather than
 * as five `process.exit(n)` calls scattered through the commands where nothing
 * can see them together.
 *
 *   0    the verb did what it was asked
 *   1    the verb's DECLARED error — its refusal, as JSON on stderr
 *   2    a usage error this face raised (an input that does not decode, an
 *        argument naming no member, a `--json` payload that is not JSON)
 *   3    nothing is serving the endpoint — the dial failed, or the transport
 *        died mid-call
 *   130  interrupted (Ctrl-C)
 *
 * `1` and `2` are the split that matters: a refusal is an ANSWER from the far
 * side and a usage error never reached it, so a loop that retries on 1 must not
 * retry on 2. `3` is separate again because it is about the endpoint, not about
 * the request — the one code that means "try a different `--socket`".
 *
 * Each arm carries the EXACT text it writes, not a fragment a formatter
 * reassembles later, plus `Runtime.errorExitCode` — the marker
 * `NodeRuntime.runMain`'s own teardown reads off the squashed cause. So there is
 * no exit-code ACCESSOR in this module and no exit-code table at the host's run
 * edge: the host hands the failure to {@link runEdge}, writes the line it
 * gets back and re-fails, and the runtime reads the code straight off the
 * error. Neither the line nor the code
 * can drift from the arm that means them, and no command calls `process.exit`.
 *
 * ## 130 is the one arm that is not a value here
 *
 * A Ctrl-C interrupts the fiber; an interruption is not a typed failure, so no
 * `Effect.catch` sees it and no constructor below can be the thing that
 * happens. The code is still the contract's — `Runtime.defaultTeardown` answers
 * an interrupts-only cause with 130 — which is why {@link EXIT} names it: the
 * number is part of the published matrix even though the mechanism is Effect's.
 *
 * ## The name in the message is the BINARY's, not this package's
 *
 * A user reads `olai: no surface at /run/user/1000/olai/surface.sock`, never
 * `surface-cli: …` — the package they installed is not the command they typed.
 * So every constructor takes the binary's own name and puts it in front. That
 * is `info.name` at {@link surfaceCommands}, threaded down, never a constant
 * this package holds.
 */

import { messageOf } from "@kolu/surface/verbs";
import { Data, Runtime } from "effect";

// "What did this failure SAY" is the framework's one derivation
// (`@kolu/surface/verbs`), shared with the MCP face — a second copy here drifted
// from it within the same change that introduced it.
export { messageOf };

/** The published matrix, as data. Exported so a consumer (a host's docs, a
 *  driving script's test) can name the codes rather than re-spell the integers,
 *  and so the matrix test asserts against ONE table. */
export const EXIT = {
  /** The verb did what it was asked. */
  ok: 0,
  /** The verb's own declared error — a refusal from the far side. */
  failed: 1,
  /** A usage error: the request never left this process. */
  usage: 2,
  /** Nothing is serving the endpoint, or the transport died mid-call. */
  unreachable: 3,
  /** Interrupted (Ctrl-C). Effect's own teardown produces it; see the header. */
  interrupted: 130,
} as const;

/** A CLI failure that carries its OWN text and its OWN exit code — the whole
 *  contract above, as one shape.
 *
 *  The arms are CONSTRUCTORS over one class rather than a class each: nothing
 *  discriminates them (no `catchTag` matches one), and four tags for one concept
 *  is a distinction the code has to keep in sync and nothing can read. The code
 *  is DATA, and `Runtime.errorExitCode` is a getter over it.
 *
 *  `errorReported: false` says "this failure has already been reported to the
 *  user": the host prints {@link runEdge}'s one line and Effect's pretty cause
 *  dump on top of it would be noise, not information. */
export class SurfaceCliFailure extends Data.TaggedError("SurfaceCliFailure")<{
  /** Exactly what to write to stderr, newline included. */
  readonly stderr: string;
  readonly code: number;
}> {
  get [Runtime.errorExitCode](): number {
    return this.code;
  }
  readonly [Runtime.errorReported] = false;
}

/** One diagnostic line on stderr in the binary's own voice — the shape every
 *  prose arm below wears, spelled once. Takes the message WITHOUT a newline: a
 *  caller that has to remember `\n` is a caller that can forget it. */
const line = (binary: string, message: string): string =>
  `${binary}: ${message}\n`;

/** A usage error — the request never left this process (exit 2). The argument
 *  did not decode, the `--json` payload was not JSON, the member named nothing.
 *
 *  Its own code, distinct from a refusal's, because only one of the two means
 *  the far side answered. A loop that retries a refusal must not retry a typo. */
export const usage = (binary: string, message: string): SurfaceCliFailure =>
  new SurfaceCliFailure({
    stderr: line(binary, message),
    code: EXIT.usage,
  });

/** Nothing is serving the endpoint (exit 3) — the dial failed, or the transport
 *  died under an in-flight call. `where` names the endpoint as the user spelled
 *  it, because that is the fact they can act on; `detail` is the transport's own
 *  words, kept rather than flattened to "connection failed". */
export const unreachable = (
  binary: string,
  where: string,
  detail: string,
): SurfaceCliFailure =>
  new SurfaceCliFailure({
    stderr: line(binary, `no surface at ${where} — ${detail}`),
    code: EXIT.unreachable,
  });

/** The verb's DECLARED error (exit 1) — its refusal, as JSON on stderr.
 *
 *  JSON and not prose, and on stderr and not stdout: a refusal is machine-
 *  readable data the caller can act on ("these three children are not done" is
 *  a list, not a sentence to parse back apart), but it is not the verb's
 *  ANSWER, so it must not land in the stream a pipe is reading. Both halves of
 *  that are the reason this arm exists separately from {@link usage}. */
export const refused = (payload: unknown): SurfaceCliFailure =>
  new SurfaceCliFailure({
    stderr: `${JSON.stringify(payload)}\n`,
    code: EXIT.failed,
  });

/** The brand every `effect/unstable/cli` error carries.
 *
 *  Matched on the BRAND rather than on `_tag`: the library sets `_tag` to the
 *  short name (`ShowHelp`, `DuplicateOption`, …) and stamps this key alongside
 *  it, so a `_tag.startsWith("~effect/cli/")` test — the obvious-looking one —
 *  silently matches nothing and double-prints every diagnostic. */
const CLI_ERROR_BRAND = "~effect/cli/CliError";

/** Has the CLI LIBRARY already put this failure's text on screen? A typo'd
 *  subcommand, a rejected flag, a value an enum does not admit — the library
 *  renders the reason and the usage itself, so re-reporting it would print the
 *  diagnostic twice. */
const alreadyRendered = (error: unknown): boolean =>
  typeof error === "object" && error !== null && CLI_ERROR_BRAND in error;

/** What a host's RUN EDGE should do with a failed program: write `stderr` (when
 *  it is non-empty), then fail with `failure`, whose exit-code marker the
 *  runtime's own teardown reads.
 *
 *  This exists so the exit matrix above is TRUE of a real binary rather than
 *  true of the failures this package happens to raise. Two of the five arms are
 *  not this package's to raise at all:
 *
 *    - a refusal from the CLI LIBRARY — a rejected flag, an unknown subcommand,
 *      a value outside a choice — is a usage error by every reading of the
 *      matrix, but it arrives already rendered and carrying no code of ours.
 *      Left alone it takes whatever the host's own catch-all does with it,
 *      which is how "a usage error is exit 2" quietly became "sometimes 2,
 *      sometimes whatever". Here it becomes {@link EXIT.usage}, printing
 *      nothing more, because the library already printed it.
 *    - `--help` and `--version` are ACTION flags in the pinned `effect`: they
 *      print and return SUCCESS, so they never reach this function. That is the
 *      library's choice rather than its contract, which is why the arm above is
 *      written as "a rendered failure is a usage error" and not as "every
 *      CliError is one" — a rendered SUCCESS is not a failure and does not
 *      arrive.
 *
 *  Everything else keeps its own verdict: a {@link SurfaceCliFailure} carries
 *  the exact line it means and the code that goes with it, and an arbitrary
 *  defect is reported in the same one-line shape rather than vanishing. */
export function runEdge(
  binary: string,
  error: unknown,
): { readonly stderr: string; readonly failure: unknown } {
  const carried = (error as { readonly stderr?: unknown })?.stderr;
  if (typeof carried === "string") return { stderr: carried, failure: error };
  if (alreadyRendered(error)) {
    return {
      stderr: "",
      failure: new SurfaceCliFailure({ stderr: "", code: EXIT.usage }),
    };
  }
  return { stderr: line(binary, messageOf(error)), failure: error };
}
