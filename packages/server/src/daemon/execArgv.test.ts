/**
 * Unit tests for `daemonExecArgv` — the filter that decides which node
 * exec flags the detached PTY daemon inherits. The load-bearing case is
 * dropping `--watch` (which would restart the daemon on source edits and
 * kill every PTY mid-dev) while preserving the `--import tsx` loader pair
 * that lets node run the TS entry at all.
 */
import { describe, expect, it } from "vitest";
import { daemonExecArgv } from "./daemonUtils.ts";

describe("daemonExecArgv", () => {
  it("drops --watch but keeps the --import tsx loader pair", () => {
    expect(daemonExecArgv(["--watch", "--import", "tsx"])).toEqual([
      "--import",
      "tsx",
    ]);
  });

  it("drops --inspect (would clash with this process's debug port)", () => {
    expect(daemonExecArgv(["--inspect", "--import", "tsx"])).toEqual([
      "--import",
      "tsx",
    ]);
    expect(daemonExecArgv(["--inspect=9229", "--import=tsx"])).toEqual([
      "--import=tsx",
    ]);
    expect(daemonExecArgv(["--inspect-brk", "--require", "ts-node"])).toEqual([
      "--require",
      "ts-node",
    ]);
  });

  it("drops --debug", () => {
    expect(daemonExecArgv(["--debug", "--import", "tsx"])).toEqual([
      "--import",
      "tsx",
    ]);
  });

  it("drops --watch-path together with its space-separated value", () => {
    expect(
      daemonExecArgv(["--watch-path", "./src", "--import", "tsx"]),
    ).toEqual(["--import", "tsx"]);
  });

  it("preserves loader flags and their values unchanged", () => {
    expect(
      daemonExecArgv([
        "--import",
        "tsx",
        "--experimental-vm-modules",
        "--conditions",
        "development",
      ]),
    ).toEqual([
      "--import",
      "tsx",
      "--experimental-vm-modules",
      "--conditions",
      "development",
    ]);
  });

  it("is a no-op on an empty argv", () => {
    expect(daemonExecArgv([])).toEqual([]);
  });
});
