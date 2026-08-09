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
 * Effect's own teardown reads. So `main.ts`'s run edge is a write and a code
 * read, with nothing left to get wrong, and neither the line nor the code can
 * drift from the arm that means them.
 *
 * `errorReported: false` on every one of them says "this failure has already
 * been reported to the user" — the CLI prints its own one-line diagnostic, and
 * Effect's pretty cause dump on top of it would be noise, not information.
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

/** The one-line diagnostic every usage/link failure carries, prefixed once. */
export const failure = (message: string): CliFailure =>
  new CliFailure({ stderr: `kolu: ${message}\n` });

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

/** The process exit code for a failed program — an arm's own marker, or 1 for
 *  anything unexpected. Never 0: a program that failed must not look like one
 *  that worked. */
export function exitCodeOf(error: unknown): number {
  return Runtime.getErrorExitCode(error);
}
