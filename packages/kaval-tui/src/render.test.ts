import type { PtyHostListEntry } from "kaval";
import { describe, expect, it } from "vitest";
import {
  commandName,
  formatList,
  formatListJson,
  relativeTime,
  tildeify,
} from "./render.ts";

const entry = (over: Partial<PtyHostListEntry>): PtyHostListEntry => ({
  id: "3f9a",
  pid: 12843,
  cwd: "/home/srid/code/kolu",
  lastActivity: 0,
  ...over,
});

describe("relativeTime", () => {
  const now = 1_000_000_000_000;
  it("formats seconds, minutes, hours, days", () => {
    expect(relativeTime(now, now)).toBe("0s");
    expect(relativeTime(now - 5_000, now)).toBe("5s");
    expect(relativeTime(now - 90_000, now)).toBe("1m");
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe("2h");
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe("3d");
  });
  it("floors clock skew at 0s (never negative)", () => {
    expect(relativeTime(now + 10_000, now)).toBe("0s");
  });
});

describe("commandName", () => {
  it("takes the basename of a process path, empty passes through", () => {
    expect(commandName("/run/current-system/sw/bin/bash")).toBe("bash");
    expect(commandName("vim")).toBe("vim");
    expect(commandName("")).toBe("");
    expect(commandName(undefined)).toBe("");
  });
});

describe("tildeify", () => {
  it("collapses $HOME to ~", () => {
    expect(tildeify("/home/srid/code/kolu", "/home/srid")).toBe("~/code/kolu");
    expect(tildeify("/home/srid", "/home/srid")).toBe("~");
  });
  it("leaves non-home paths and a missing home untouched", () => {
    expect(tildeify("/etc/nixos", "/home/srid")).toBe("/etc/nixos");
    expect(tildeify("/home/srid/x")).toBe("/home/srid/x");
    // shares a prefix but isn't actually under home — must NOT be collapsed
    expect(tildeify("/home/sridhar", "/home/srid")).toBe("/home/sridhar");
  });
});

describe("formatList", () => {
  it("renders an honest one-liner for an empty inventory", () => {
    expect(formatList([], { now: 0 })).toBe("no live terminals.");
  });

  it("renders a header + one row each, cmd from title|foreground, cwd tilde'd", () => {
    const now = 60_000;
    const out = formatList(
      [
        entry({
          id: "abc",
          pid: 100,
          cwd: "/home/srid/code/kolu",
          lastActivity: now - 5_000,
          title: "claude: implement",
          foregroundProcess: "node",
        }),
        entry({
          id: "longer-id",
          pid: 12,
          cwd: "/etc",
          lastActivity: now - 120_000,
          title: "",
          foregroundProcess: "vim",
        }),
      ],
      { now, home: "/home/srid" },
    );
    const lines = out.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^ID\s+PID\s+IDLE\s+CMD\s+CWD$/);
    // title wins when set
    expect(lines[1]).toMatch(
      /^abc\s+100\s+5s\s+claude: implement\s+~\/code\/kolu$/,
    );
    // falls back to the foreground command when the title is empty
    expect(lines[2]).toMatch(/^longer-id\s+12\s+2m\s+vim\s+\/etc$/);
  });

  it("shows an em-dash when a terminal has neither title nor foreground", () => {
    const out = formatList(
      [entry({ id: "x", title: "", foregroundProcess: "" })],
      { now: 0 },
    );
    expect(out.split("\n")[1]).toMatch(/—/);
  });
});

describe("formatListJson", () => {
  it("emits a top-level array (jq '.[]'-friendly) carrying the full entry", () => {
    const parsed = JSON.parse(
      formatListJson([
        entry({ id: "x", title: "zsh", foregroundProcess: "zsh" }),
      ]),
    );
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toMatchObject({ id: "x", pid: 12843, title: "zsh" });
  });
});
