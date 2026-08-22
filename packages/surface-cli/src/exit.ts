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
 * edge: the host writes the line ({@link reportOf}) and re-fails, and the
 * runtime reads the code straight off the error. Neither the line nor the code
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

import { Data, Runtime } from "effect";

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
 *  user": the host prints {@link reportOf}'s one line and Effect's pretty cause
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

/** The best sentence an arbitrary thrown value has in it — the one place this
 *  package decides what an unknown failure SAYS.
 *
 *  `e instanceof Error ? e.message : String(e)` is ALMOST right and wrong for
 *  the two shapes Effect actually delivers: a `Data.TaggedError` is an `Error`
 *  whose `message` is `""` (its identity lives in `_tag`), and a failure
 *  declared as a plain object is not an `Error` at all, so `String(e)` renders
 *  it `[object Object]`. Both are exactly the failures worth reading. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) {
    if (error.message !== "") return error.message;
    const tag = (error as { _tag?: unknown })._tag;
    return typeof tag === "string" && tag !== "" ? tag : error.name;
  }
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error) ?? String(error);
    } catch {
      return `${error.constructor?.name || "Object"} { ${Object.keys(error).join(", ")} }`;
    }
  }
  return String(error);
}

/** What a host's run edge writes for a failed program.
 *
 *  An arm of the contract writes its own exact text. Anything ELSE — a defect,
 *  a raw rejection from a dependency — is still reported, in the same one-line
 *  shape: a failure that printed nothing would be the silent degradation this
 *  repo treats as a defect. */
export function reportOf(binary: string, error: unknown): string {
  const carried = (error as { readonly stderr?: unknown })?.stderr;
  if (typeof carried === "string") return carried;
  return line(binary, messageOf(error));
}
