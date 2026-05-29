import { describe, expect, it } from "vitest";
import { daemonExecArgv } from "./daemonUtils.ts";

describe("daemonExecArgv", () => {
  it("keeps a loader/import flag and its space-separated value", () => {
    expect(daemonExecArgv(["--import", "tsx"])).toEqual(["--import", "tsx"]);
  });

  it("drops --watch but keeps --import tsx", () => {
    expect(daemonExecArgv(["--watch", "--import", "tsx"])).toEqual([
      "--import",
      "tsx",
    ]);
  });

  it("drops every --inspect* / --debug* variant", () => {
    for (const flag of [
      "--inspect",
      "--inspect-brk",
      "--inspect-port=9229",
      "--inspect-wait",
      "--debug",
      "--debug-brk",
    ]) {
      expect(daemonExecArgv([flag, "--import", "tsx"])).toEqual([
        "--import",
        "tsx",
      ]);
    }
  });

  it("drops --watch-path and consumes its value", () => {
    expect(
      daemonExecArgv(["--watch-path", "./src", "--import", "tsx"]),
    ).toEqual(["--import", "tsx"]);
  });

  it("handles --flag=value syntax (no separate value token)", () => {
    expect(daemonExecArgv(["--enable-source-maps"])).toEqual([
      "--enable-source-maps",
    ]);
  });

  it("passes through an empty argv", () => {
    expect(daemonExecArgv([])).toEqual([]);
  });
});
