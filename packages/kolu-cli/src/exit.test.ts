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
  reservedFace,
  UsageRefused,
  waitInterrupted,
  waitTerminalGone,
  waitTimedOut,
} from "./exit.ts";

/** Every arm of the contract, built THE WAY THE PRODUCT BUILDS IT — through the
 *  constructors in `exit.ts` — beside the code `README.md` promises for it. One
 *  table so the matrix is readable as a matrix, which is the reason the codes
 *  live in one module in the first place.
 *
 *  The arms used to be fabricated here (`new WaitTimedOut({stderr: "kolu:
 *  timed out\n"})` — a string no verb ever writes), so the shape assertions
 *  below were testing this file's own literals. They caught nothing, and what
 *  they did not catch was real: the interrupted arm shipped a line with no
 *  `kolu: ` prefix at all.
 *
 *  The last element is the line the arm puts on stderr, or `null` for the two
 *  that print NOTHING because the CLI library already rendered the usage
 *  (`UsageRefused`) — those still carry a code, which is exactly why they must
 *  be visible in this table. */
const MATRIX = [
  ["usage error / dropped link", failure("nope"), 1, "kolu: nope\n"],
  [
    "wait timed out",
    waitTimedOut({
      terminal: "a1b2c3d4",
      elapsedMs: 900,
      describe: "awaiting",
    }),
    2,
    "kolu: timed out after 900ms waiting for a1b2c3d4 to reach awaiting.\n",
  ],
  [
    "wait's terminal exited",
    waitTerminalGone({ terminal: "a1b2c3d4", describe: "awaiting" }),
    3,
    "kolu: a1b2c3d4 exited before reaching awaiting — its terminal is gone.\n",
  ],
  [
    "interrupted",
    waitInterrupted({ terminal: "a1b2c3d4" }),
    130,
    "kolu: interrupted; a1b2c3d4 left running\n",
  ],
  [
    "a reserved face",
    reservedFace("tui"),
    1,
    `kolu: ${reservedFace("tui").message}\n`,
  ],
  ["a usage error the library already printed", new UsageRefused(), 1, null],
] as const satisfies ReadonlyArray<
  readonly [string, unknown, number, string | null]
>;

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

  it("gives the wait arms DISTINCT codes — 2 and 3 are the pair a driver reads", () => {
    // "still alive but stuck" (2, retryable) vs "the agent I was driving died"
    // (3, not). Collapsing any two of these onto one number would still pass the
    // per-arm assertions above while destroying the branch that motivates them.
    // (The three `1` arms are deliberately one code: "your command was wrong or
    // the link dropped" is one thing to a driver, however it was reached.)
    const distinct = MATRIX.filter(([, , code]) => code !== 1);
    const codes = distinct.map(([, error]) => Runtime.getErrorExitCode(error));
    expect(new Set(codes).size).toBe(distinct.length);
  });

  it("marks every arm already-reported, so the CLI's one line is the whole output", () => {
    // `errorReported: false` is what suppresses Effect's pretty cause dump on
    // top of the named stderr line — part of the contract in the same sense the
    // number is: a driving loop parses stderr.
    for (const [, error] of MATRIX) {
      expect(reportedFlagOf(error)).toBe(false);
    }
  });

  it("writes ONE `kolu: `-prefixed line per arm — every arm, the same test", () => {
    // The assertion the old fabricated matrix could not make: these are the real
    // lines the verbs produce. `UsageRefused` carries none by design (the CLI
    // library already rendered the usage), which is stated as `null` rather than
    // left as a gap.
    for (const [, error, , line] of MATRIX) {
      if (line === null) continue;
      expect(reportOf(error)).toBe(line);
      expect(line).toMatch(/^kolu: /);
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
    const e = failure(
      'no terminal matching "3f9" — `kolu ls` shows the live ones.',
    );
    expect(e).toBeInstanceOf(CliFailure);
    expect(e.stderr).toBe(
      'kolu: no terminal matching "3f9" — `kolu ls` shows the live ones.\n',
    );
  });
});
