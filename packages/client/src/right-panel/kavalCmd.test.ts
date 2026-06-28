import { shellSplit } from "@kolu/shell-quote";
import { describe, expect, it } from "vitest";
import { kavalCmd } from "./kavalCmd.ts";

describe("kavalCmd", () => {
  it("emits a bare command when no socket is pinned", () => {
    expect(kavalCmd("attach", "0a1b2c3d", undefined)).toBe(
      "kaval-tui attach 0a1b2c3d",
    );
    expect(kavalCmd("snapshot", "0a1b2c3d", undefined)).toBe(
      "kaval-tui snapshot 0a1b2c3d",
    );
    expect(kavalCmd("send", "0a1b2c3d", undefined)).toBe(
      "kaval-tui send 0a1b2c3d",
    );
  });

  it("pins a clean socket path unquoted after the id", () => {
    expect(
      kavalCmd("attach", "0a1b2c3d", "/run/user/1000/kaval-9221/pty-host.sock"),
    ).toBe(
      "kaval-tui attach 0a1b2c3d --socket /run/user/1000/kaval-9221/pty-host.sock",
    );
  });

  it("quotes a socket path with spaces so it stays a single argv token", () => {
    const cmd = kavalCmd("attach", "0a1b2c3d", "/tmp/my sock/pty-host.sock");
    // The whole point: a shell re-parsing the copied command recovers the path
    // as ONE argument, not two — so the pasted command targets the right daemon.
    expect(shellSplit(cmd)).toEqual([
      "kaval-tui",
      "attach",
      "0a1b2c3d",
      "--socket",
      "/tmp/my sock/pty-host.sock",
    ]);
  });

  it("neutralizes shell metacharacters in a socket path", () => {
    const cmd = kavalCmd("snapshot", "0a1b2c3d", "/tmp/$(rm -rf ~)/sock");
    // The `$(…)` must be inside a single-quoted run so a paste can't execute it,
    // and re-tokenizing recovers the path verbatim as one argv element.
    expect(cmd).toContain("'/tmp/$(rm -rf ~)/sock'");
    expect(shellSplit(cmd)).toEqual([
      "kaval-tui",
      "snapshot",
      "0a1b2c3d",
      "--socket",
      "/tmp/$(rm -rf ~)/sock",
    ]);
  });
});
