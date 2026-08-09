/**
 * The exit-code matrix, pinned (the kolu-cli plan,
 * docs/atlas/src/content/atlas/kolu-cli.mdx).
 *
 * `README.md` publishes these codes as a USER-VISIBLE contract — driving loops
 * branch on them ("the agent I was waiting for died" vs "it never settled" vs
 * "my command was wrong") — and `padi-tui`/`kaval-tui` each carried a copy of
 * the same numbers, so a script written against the old binaries must keep
 * working against the new spelling. A contract nothing asserts is a comment:
 * renumber an arm and the only thing that notices is somebody's overnight run.
 *
 * Why this reads the codes through `Runtime.getErrorExitCode` rather than off
 * the class fields: that call IS the lookup Effect's teardown performs on the
 * squashed cause at `main.ts`'s run edge — which is why `exit.ts` deliberately
 * ships no exit-code accessor of its own. Asserting the field directly would pin
 * the literal we wrote while leaving the question that actually matters — does
 * the marker survive the trip to the process exit code — untested. So each arm
 * is built the way a verb builds it and read the way the runtime reads it.
 *
 * The `0` arm has no error class to pin (a program that succeeds raises
 * nothing), and it is asserted at the other end of the same lookup: an
 * unexpected non-contract failure must NOT come back as 0, or a failed run would
 * look like one that worked.
 */

import { Runtime } from "effect";
import { describe, expect, it } from "vitest";
import {
  CliFailure,
  failure,
  reportOf,
  WaitInterrupted,
  WaitTerminalGone,
  WaitTimedOut,
} from "./exit.ts";

/** Every arm of the contract, built as a verb builds it, beside the code
 *  `README.md` promises for it. One table so the matrix is readable as a
 *  matrix — the reason the codes live in one module in the first place. */
const MATRIX = [
  ["usage error / dropped link", failure("nope"), 1],
  ["wait timed out", new WaitTimedOut({ stderr: "kolu: timed out\n" }), 2],
  [
    "wait's terminal exited",
    new WaitTerminalGone({ stderr: "kolu: gone\n" }),
    3,
  ],
  ["interrupted", new WaitInterrupted({ stderr: "kolu: interrupted\n" }), 130],
] as const satisfies ReadonlyArray<readonly [string, unknown, number]>;

/** Has this error told the runtime "my message is already on screen"? Read off
 *  the same marker key the arms stamp — Effect ships it as a branded string
 *  (`"~effect/Runtime/errorReported"`), not a symbol, and publishes the
 *  type-level key under the same name, so the cast names THAT rather than
 *  widening to `Record<string, unknown>`. */
const reportedFlagOf = (error: unknown): unknown =>
  (error as Record<Runtime.errorReported, unknown>)[Runtime.errorReported];

describe("the exit-code contract", () => {
  it.each(MATRIX)("%s exits %i", (_name, error, code) => {
    expect(Runtime.getErrorExitCode(error)).toBe(code);
  });

  it("gives each arm a DISTINCT code — 2 and 3 are the pair a driver reads", () => {
    // "still alive but stuck" (2, retryable) vs "the agent I was driving died"
    // (3, not). Collapsing any two of these onto one number would still pass the
    // per-arm assertions above while destroying the branch that motivates them.
    const codes = MATRIX.map(([, error]) => Runtime.getErrorExitCode(error));
    expect(new Set(codes).size).toBe(MATRIX.length);
  });

  it("marks every arm already-reported, so the CLI's one line is the whole output", () => {
    // `errorReported: false` is what suppresses Effect's pretty cause dump on
    // top of the named stderr line — part of the contract in the same sense the
    // number is: a driving loop parses stderr.
    for (const [, error] of MATRIX) {
      expect(reportedFlagOf(error)).toBe(false);
      expect(reportOf(error)).toMatch(/^kolu: /);
    }
  });

  it("never reports 0 for a failure that carries no marker", () => {
    // A defect or a raw rejection from a dependency still has to exit non-zero:
    // a program that failed must not look like one that worked.
    const defect = new Error("a dependency blew up");
    expect(Runtime.getErrorExitCode(defect)).toBe(1);
    expect(reportOf(defect)).toBe("kolu: a dependency blew up\n");
  });

  it("keeps CliFailure's stderr the ONE prefixed line `failure()` wrote", () => {
    const e = failure('no terminal matching "3f9" — `kolu ls` shows the live ones.');
    expect(e).toBeInstanceOf(CliFailure);
    expect(e.stderr).toBe(
      'kolu: no terminal matching "3f9" — `kolu ls` shows the live ones.\n',
    );
  });
});
