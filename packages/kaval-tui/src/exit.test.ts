/**
 * The exit-code matrix, pinned.
 *
 * These codes are what an agent-driving loop branches on — "the agent I was
 * driving died" (3) is a different decision from "it never settled" (2), which
 * is a different decision from "my command was wrong" (1) — and `attach` on top
 * of them mirrors the child's own code so a pipeline sees what it would have
 * seen running the program directly. Nothing pinned any of it before the Effect
 * conversion: the whole contract lived in a dozen scattered `process.exit(n)`
 * calls and a reviewer's memory.
 */

import { describe, expect, it } from "vitest";
import {
  AttachChildExited,
  attachExitCode,
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

  it("every wait arm keeps its OWN code — no two collapse together", () => {
    const codes = [
      new CliFailure({ stderr: "" }),
      new WaitTimedOut({ stderr: "" }),
      new WaitTerminalGone({ stderr: "" }),
      new WaitInterrupted({ stderr: "" }),
    ].map(exitCodeOf);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("matches padi-tui's codes, because a driver scripts both", () => {
    // Not an accident to be re-derived per CLI: 2 = timed out, 3 = the terminal
    // went away, 130 = interrupted, in BOTH binaries.
    expect(exitCodeOf(new WaitTimedOut({ stderr: "" }))).toBe(2);
    expect(exitCodeOf(new WaitTerminalGone({ stderr: "" }))).toBe(3);
    expect(exitCodeOf(new WaitInterrupted({ stderr: "" }))).toBe(130);
  });

  it("an unexpected failure still exits NON-ZERO", () => {
    // The one thing that must never happen: a program that failed looking, to a
    // script, exactly like one that worked.
    expect(exitCodeOf(new Error("something nobody anticipated"))).toBe(1);
    expect(exitCodeOf("a thrown string")).toBe(1);
    expect(exitCodeOf(undefined)).toBe(1);
  });
});

describe("attach mirrors the child's exit code", () => {
  it("carries a representable code through verbatim", () => {
    for (const code of [1, 7, 42, 255]) {
      expect(attachExitCode(code)).toBe(code);
      expect(exitCodeOf(new AttachChildExited({ stderr: "", code }))).toBe(code);
    }
  });

  it("degrades an UNREPRESENTABLE code to 1 rather than reporting a wrong one", () => {
    // Node clamps an exit code modulo 256, so passing 256 through would exit 0 —
    // a failed child looking like a clean one. -1 would become 255.
    expect(attachExitCode(256)).toBe(1);
    expect(attachExitCode(-1)).toBe(1);
    expect(attachExitCode(1000)).toBe(1);
  });

  it("a zero child exit is a SUCCESS, so it never mints a failure", () => {
    // The value the caller checks: `attachExitCode(0)` is 0, and `cmdAttach`
    // returns rather than failing on it.
    expect(attachExitCode(0)).toBe(0);
  });
});

describe("what the run edge prints", () => {
  it("an arm prints its own exact line, verbatim", () => {
    expect(
      reportOf(new WaitInterrupted({ stderr: "— interrupted; ab left running\n" })),
    ).toBe("— interrupted; ab left running\n");
    // Note the ABSENCE of a `kaval-tui:` prefix above — the interrupted trailer
    // is a status line, not a diagnostic, and prefixing it would change bytes a
    // user reads.
    expect(reportOf(failure("no command"))).toBe("kaval-tui: no command\n");
  });

  it("attach's own trailer is already printed, so its arm adds nothing", () => {
    // `cmdAttach` writes `— <id> exited (code N)` itself, because that line is
    // owed whether the code is zero or not.
    expect(reportOf(new AttachChildExited({ stderr: "", code: 7 }))).toBe("");
  });

  it("an unexpected failure is still REPORTED, in the CLI's shape", () => {
    // caught-error-must-not-collapse-to-empty: a defect that printed nothing
    // would leave a non-zero exit with no explanation at all.
    expect(reportOf(new Error("socket hung up"))).toBe(
      "kaval-tui: socket hung up\n",
    );
    expect(reportOf("raw string rejection")).toBe(
      "kaval-tui: raw string rejection\n",
    );
  });
});
