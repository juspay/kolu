/**
 * kaval-tui's EXIT CONTRACT, as values.
 *
 * The codes are a user-visible contract — an agent-driving loop branches on them
 * — so they live in one module with a test that pins the whole matrix, rather
 * than as a dozen `process.exit(n)` calls scattered through the verbs where
 * nothing can see them together.
 *
 *   0    the verb did what it was asked
 *   1    a usage error, or the link dropped
 *   2    `wait` ran out of time — the output never met the condition
 *   3    `wait`'s terminal exited before the condition could fire
 *   130  `wait` interrupted (Ctrl+C / SIGTERM / SIGHUP)
 *   n    `attach` mirrors the child's own exit code (0…255; anything
 *        unrepresentable degrades to 1)
 *
 * They mirror `padi-tui`'s deliberately: a driver scripting both should not have
 * to remember two tables. Each arm carries the EXACT line it writes to stderr
 * plus its `Runtime.errorExitCode`, so the run edge is a write and a code read.
 * `errorReported: false` says the failure has already been reported to the user
 * — the CLI prints its own one-line diagnostic, and Effect's pretty cause dump
 * on top of it would be noise.
 */

import { Data, Runtime } from "effect";

/** A usage error or a dropped link — everything the CLI used to call `fail()`
 *  for. Exit 1. */
export class CliFailure extends Data.TaggedError("CliFailure")<{
  readonly stderr: string;
}> {
  readonly [Runtime.errorExitCode] = 1;
  readonly [Runtime.errorReported] = false;
}

/** `wait` ran out of time — the output never met the condition. */
export class WaitTimedOut extends Data.TaggedError("WaitTimedOut")<{
  readonly stderr: string;
}> {
  readonly [Runtime.errorExitCode] = 2;
  readonly [Runtime.errorReported] = false;
}

/** The terminal exited before the condition could fire — it can never land now.
 *  Its own code (3) so a driver tells "the agent I was driving died" from a
 *  timeout (2, still alive but stuck) or an error (1). */
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

/** `attach`'s child exited NON-ZERO: kaval-tui mirrors the child's own code so a
 *  shell pipeline sees what it would have seen running the program directly.
 *  A per-instance code, because the child's is not known until it exits — read
 *  through a getter, which is exactly what `Runtime.getErrorExitCode` looks
 *  for. (A zero exit is a SUCCESS and never mints one of these.) */
export class AttachChildExited extends Data.TaggedError("AttachChildExited")<{
  readonly stderr: string;
  readonly code: number;
}> {
  get [Runtime.errorExitCode](): number {
    return this.code;
  }
  readonly [Runtime.errorReported] = false;
}

/** The one-line diagnostic every usage/link failure carries, prefixed once —
 *  `fail()`'s successor, minus the `process.exit` it used to perform. */
export const failure = (message: string): CliFailure =>
  new CliFailure({ stderr: `kaval-tui: ${message}\n` });

/** What the run edge prints for a failed program.
 *
 *  An arm of the contract prints its own exact line (possibly empty, when it
 *  already wrote its trailer). Anything ELSE — a defect, a raw rejection from a
 *  dependency — is still reported in the CLI's one-line shape: a failure that
 *  printed nothing would be the silent degradation this repo treats as a defect. */
export function reportOf(error: unknown): string {
  const e = error as { readonly stderr?: unknown; readonly message?: unknown };
  if (typeof e?.stderr === "string") return e.stderr;
  return `kaval-tui: ${typeof e?.message === "string" ? e.message : String(error)}\n`;
}

/** The process exit code for a failed program — an arm's own marker, or 1 for
 *  anything unexpected. Never 0: a program that failed must not look like one
 *  that worked. */
export function exitCodeOf(error: unknown): number {
  return Runtime.getErrorExitCode(error);
}

/** The code `attach` leaves with for a child that exited with `exitCode`.
 *  Node clamps an exit code modulo 256, so anything unrepresentable (negative,
 *  >255) would silently become a DIFFERENT code — degrade it to the generic
 *  failure instead of reporting a number the child never returned. */
export function attachExitCode(exitCode: number): number {
  return exitCode >= 0 && exitCode <= 255 ? exitCode : 1;
}
