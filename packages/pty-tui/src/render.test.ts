import type { PtyHostListEntry } from "@kolu/pty-host";
import { describe, expect, it } from "vitest";
import {
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

  it("renders a header + one row per terminal, cwd tilde'd, columns aligned", () => {
    const now = 60_000;
    const out = formatList(
      [
        entry({
          id: "abc",
          pid: 100,
          cwd: "/home/srid/code/kolu",
          lastActivity: now - 5_000,
        }),
        entry({
          id: "longer-id",
          pid: 12,
          cwd: "/etc",
          lastActivity: now - 120_000,
        }),
      ],
      { now, home: "/home/srid" },
    );
    const lines = out.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^ID\s+PID\s+IDLE\s+CWD$/);
    expect(lines[1]).toMatch(/^abc\s+100\s+5s\s+~\/code\/kolu$/);
    expect(lines[2]).toMatch(/^longer-id\s+12\s+2m\s+\/etc$/);
  });
});

describe("formatListJson", () => {
  it("emits a top-level array (jq '.[]'-friendly), not a wrapper object", () => {
    const parsed = JSON.parse(formatListJson([entry({ id: "x" })]));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toMatchObject({ id: "x", pid: 12843 });
  });
});
