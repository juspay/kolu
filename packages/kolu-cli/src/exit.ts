/**
 * `kolu`'s EXIT CONTRACT, as values.
 *
 * The codes are a user-visible contract — driving loops branch on them ("the
 * agent I was waiting for died" vs "it never settled" vs "my command was
 * wrong") — so they live in one module with a test that pins the whole matrix,
 * rather than as five `process.exit(n)` calls scattered through the verbs where
 * nothing can see them together.
 *
 *   0    the verb did what it was asked
 *   1    a usage error, or the padi link dropped
 *   2    `wait` ran out of time — the condition never landed
 *   3    `wait`'s terminal exited before reaching the condition
 *   130  interrupted (Ctrl+C / SIGTERM / SIGHUP)
 *
 * This is the contract `padi-tui` and `kaval-tui` each carried a copy of; the
 * verbs that graduated onto `kolu` bring it with them, so a driving loop that
 * branched on those codes keeps working against the new spelling.
 *
 * Each arm carries the EXACT line it writes to stderr, not a fragment a
 * formatter reassembles later, plus `Runtime.errorExitCode` — the marker
 * `NodeRuntime.runMain`'s own teardown reads off the squashed cause. So there is
 * no exit-code ACCESSOR in this module and no exit-code table at the edge:
 * `main.ts` writes the line ({@link reportOf}) and re-fails, and the runtime
 * reads the code straight off the error. Neither the line nor the code can drift
 * from the arm that means them, and no verb calls `process.exit`.
 *
 * `errorReported: false` on every one of them says "this failure has already
 * been reported to the user" — the CLI prints its own one-line diagnostic, and
 * Effect's pretty cause dump on top of it would be noise, not information.
 *
 * ## The sentences live here too, as CONSTRUCTORS
 *
 * A verb passes FACTS — the short id, the elapsed ms, the condition it was
 * waiting for — and the arm renders its own line. That is what makes the matrix
 * test able to build real instances rather than fabricating stderr strings no
 * verb ever writes: a test that asserts a shape over its own literals is
 * asserting nothing about the product. Every line starts `kolu: `, including
 * the interrupted one — see {@link waitInterrupted}.
 *
 * ## Every exit-code-bearing class is in here
 *
 * Including the two the faces raise ({@link ReservedFaceError},
 * {@link UsageRefused}), which used to sit in `cli.ts` and `main.ts`. A module
 * whose whole reason to exist is that nothing can see the codes apart cannot
 * hold two thirds of them.
 */

import { Data, Runtime } from "effect";

/** A usage error or a dropped link — everything a verb used to call `fail()`
 *  for. Exit 1. */
export class CliFailure extends Data.TaggedError("CliFailure")<{
  readonly stderr: string;
}> {
  readonly [Runtime.errorExitCode] = 1;
  readonly [Runtime.errorReported] = false;
}

/** `wait` ran out of time — the condition never landed. Its own code (2) so a
 *  driver tells it from a usage/link error. */
export class WaitTimedOut extends Data.TaggedError("WaitTimedOut")<{
  readonly stderr: string;
}> {
  readonly [Runtime.errorExitCode] = 2;
  readonly [Runtime.errorReported] = false;
}

/** The watched terminal exited before reaching the condition — the wait can
 *  never land now. Its own code (3) so a driver tells "the agent I was driving
 *  died" from a timeout (2, still alive but stuck) or an error (1). */
export class WaitTerminalGone extends Data.TaggedError("WaitTerminalGone")<{
  readonly stderr: string;
}> {
  readonly [Runtime.errorExitCode] = 3;
  readonly [Runtime.errorReported] = false;
}

/** A Ctrl+C (or an external stop) during a `wait`. The conventional 130. */
export class WaitInterrupted extends Data.TaggedError("WaitInterrupted")<{
  readonly stderr: string;
}> {
  readonly [Runtime.errorExitCode] = 130;
  readonly [Runtime.errorReported] = false;
}

/** A face the plan RESERVES but has not shipped (`kolu tui`).
 *
 *  `Data.TaggedError`, not `Schema.TaggedError`: this error never crosses a wire
 *  — it is raised and handled inside one process — so it needs a `_tag` to match
 *  on, not a codec. */
export class ReservedFaceError extends Data.TaggedError("ReservedFaceError")<{
  readonly message: string;
}> {
  readonly [Runtime.errorExitCode] = 1;
  readonly [Runtime.errorReported] = false;
}

/** A rendered CLI-LIBRARY failure the user did not ask for — a bare `kolu`, a
 *  typo'd subcommand, a rejected flag. Exit 1, and it prints NOTHING because the
 *  library already printed the usage and the reason; `main.ts` explains which
 *  library failures reach this and which are a successful run.
 *
 *  Its own shape so the exit-code marker rides the error exactly as every other
 *  arm's does, leaving the teardown one rule rather than a special case. */
export class UsageRefused {
  readonly [Runtime.errorExitCode] = 1;
  readonly [Runtime.errorReported] = false;
}

/** The one-line diagnostic every usage/link failure carries, prefixed once. */
export const failure = (message: string): CliFailure =>
  new CliFailure({ stderr: `kolu: ${message}\n` });

/** The named fail-fast for a face that is planned but not shipped. */
export const reservedFace = (face: string): ReservedFaceError =>
  new ReservedFaceError({
    message: `kolu ${face} is not shipped yet — it lands in a later PR of the kolu-cli plan: https://kolu.dev/atlas/kolu-cli.html`,
  });

/** `wait` ran out of time. Reports the outcome's OWN elapsed (always populated)
 *  rather than the `--timeout` flag, which is optional — a future non-timer
 *  timeout route could otherwise print "undefinedms". */
export const waitTimedOut = (facts: {
  readonly terminal: string;
  readonly elapsedMs: number;
  readonly describe: string;
}): WaitTimedOut =>
  new WaitTimedOut({
    stderr: `kolu: timed out after ${facts.elapsedMs}ms waiting for ${facts.terminal} to reach ${facts.describe}.\n`,
  });

/** The watched terminal exited before the condition landed. */
export const waitTerminalGone = (facts: {
  readonly terminal: string;
  readonly describe: string;
}): WaitTerminalGone =>
  new WaitTerminalGone({
    stderr: `kolu: ${facts.terminal} exited before reaching ${facts.describe} — its terminal is gone.\n`,
  });

/** A Ctrl+C during a `wait` — and it wears the `kolu: ` prefix like every other
 *  arm.
 *
 *  It used to be written `— interrupted; …`, the shape of a SUCCESS trailer
 *  (`metTrailer`'s), which made it the one arm of a stderr contract that a
 *  driving loop could not recognize by the same test as the other three. The
 *  line was the bug, not the rule: this is a FAILURE arm, it rides the error
 *  channel, and it exits 130. `terminal` names what is still running, which is
 *  the fact the user can act on. */
export const waitInterrupted = (facts: {
  readonly terminal: string;
}): WaitInterrupted =>
  new WaitInterrupted({
    stderr: `kolu: interrupted; ${facts.terminal} left running\n`,
  });

/** What the run edge prints for a failed program.
 *
 *  An arm of the contract prints its own exact line. Anything ELSE — a defect, a
 *  raw rejection from a dependency — is still reported, in the CLI's one-line
 *  shape: a failure that printed nothing would be the silent-degradation this
 *  repo treats as a defect. */
export function reportOf(error: unknown): string {
  const e = error as { readonly stderr?: unknown; readonly message?: unknown };
  if (typeof e?.stderr === "string") return e.stderr;
  return `kolu: ${typeof e?.message === "string" ? e.message : String(error)}\n`;
}
