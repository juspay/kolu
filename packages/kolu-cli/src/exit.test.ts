import { Runtime } from "effect";
import { describe, expect, it } from "vitest";
import {
  CliFailure,
  failure,
  renderDiagnostic,
  reservedFace,
  terminalAsleep,
  UsageRefused,
  waitInterrupted,
  waitTerminalGone,
  waitTimedOut,
} from "./exit.ts";

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
    "the terminal is asleep",
    terminalAsleep({
      terminal: "a1b2c3d4",
      state: "sleeping",
      attempted: "read its screen",
    }),
    4,
    "kolu: a1b2c3d4 is asleep — wake it in kolu, then read its screen again.\n",
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

const reportedFlagOf = (error: unknown): unknown =>
  (error as Record<Runtime.errorReported, unknown>)[Runtime.errorReported];

describe("the exit-code contract", () => {
  it.each(MATRIX)("%s exits %i", (_name, error, code) => {
    expect(Runtime.getErrorExitCode(error)).toBe(code);
  });

  it("gives the wait arms DISTINCT codes — 2 and 3 are the pair a driver reads", () => {
    const distinct = MATRIX.filter(([, , code]) => code !== 1);
    const codes = distinct.map(([, error]) => Runtime.getErrorExitCode(error));
    expect(new Set(codes).size).toBe(distinct.length);
  });

  it("marks every arm already-reported, so the CLI's one line is the whole output", () => {
    for (const [, error] of MATRIX) {
      expect(reportedFlagOf(error)).toBe(false);
    }
  });

  it("writes ONE `kolu: `-prefixed line per arm — every arm, the same test", () => {
    for (const [, error, , line] of MATRIX) {
      if (line === null) continue;
      expect(renderDiagnostic(error)).toBe(line);
      expect(line).toMatch(/^kolu: /);
    }
  });

  it("says PARKED in its own words, on the same code", () => {
    const parked = terminalAsleep({
      terminal: "a1b2c3d4",
      state: "parked",
      attempted: "read its screen",
    });
    expect(Runtime.getErrorExitCode(parked)).toBe(4);
    expect(renderDiagnostic(parked)).toBe(
      "kolu: a1b2c3d4 is parked — a saved terminal waiting to be restored, with no live screen; restore the session, then read its screen again.\n",
    );
  });

  it("never reports 0 for a failure that carries no marker", () => {
    const defect = new Error("a dependency blew up");
    expect(Runtime.getErrorExitCode(defect)).toBe(1);
    expect(renderDiagnostic(defect)).toBe("kolu: a dependency blew up\n");
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
