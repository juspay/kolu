/**
 * The exit-code matrix, pinned.
 *
 * These five codes are what a driving loop branches on — "the agent I was
 * waiting for died" (3) is a different decision from "it never settled" (2),
 * which is a different decision from "my command was wrong" (1). Nothing pinned
 * them before the Effect conversion, which meant the whole contract lived in
 * five scattered `process.exit(n)` calls and a reviewer's memory. It lives in
 * `exit.ts` now, and this is the test that says so.
 */

import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  CliFailure,
  exitCodeOf,
  failure,
  reportOf,
  WaitInterrupted,
  WaitTerminalGone,
  WaitTimedOut,
} from "./exit.ts";

describe("the exit-code matrix", () => {
  it.each([
    ["CliFailure", new CliFailure({ stderr: "x\n" }), 1],
    ["WaitTimedOut", new WaitTimedOut({ stderr: "x\n" }), 2],
    ["WaitTerminalGone", new WaitTerminalGone({ stderr: "x\n" }), 3],
    ["WaitInterrupted", new WaitInterrupted({ stderr: "x\n" }), 130],
  ])("%s exits %i", (tag, error, code) => {
    expect(error._tag).toBe(tag);
    expect(exitCodeOf(error)).toBe(code);
  });

  it("every arm keeps its OWN code — no two collapse together", () => {
    const codes = [
      new CliFailure({ stderr: "" }),
      new WaitTimedOut({ stderr: "" }),
      new WaitTerminalGone({ stderr: "" }),
      new WaitInterrupted({ stderr: "" }),
    ].map(exitCodeOf);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("an unexpected failure still exits NON-ZERO", () => {
    // The one thing that must never happen: a program that failed looking, to a
    // script, exactly like one that worked.
    expect(exitCodeOf(new Error("something nobody anticipated"))).toBe(1);
    expect(exitCodeOf("a thrown string")).toBe(1);
    expect(exitCodeOf(undefined)).toBe(1);
  });
});

describe("what the run edge prints", () => {
  it("an arm prints its own exact line, verbatim", () => {
    expect(reportOf(new WaitInterrupted({ stderr: "— interrupted; ab left waiting\n" }))).toBe(
      "— interrupted; ab left waiting\n",
    );
    // Note the ABSENCE of a `padi-tui:` prefix above — the interrupted trailer
    // is a status line, not a diagnostic, and prefixing it would change bytes a
    // user reads.
    expect(reportOf(failure("no command"))).toBe("padi-tui: no command\n");
  });

  it("an unexpected failure is still REPORTED, in the CLI's shape", () => {
    // caught-error-must-not-collapse-to-empty: a defect that printed nothing
    // would leave a non-zero exit with no explanation at all.
    expect(reportOf(new Error("socket hung up"))).toBe(
      "padi-tui: socket hung up\n",
    );
    expect(reportOf("raw string rejection")).toBe(
      "padi-tui: raw string rejection\n",
    );
  });
});

describe("the arms compose as ordinary typed failures", () => {
  it("a failed program carries its arm on the error channel, not a thrown exit", () => {
    const exit = Effect.runSyncExit(
      Effect.fail(new WaitTerminalGone({ stderr: "gone\n" })),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
