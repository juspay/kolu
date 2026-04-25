import { describe, expect, it } from "vitest";
import { cwdBasename, shortenCwd } from "./path";

describe("shortenCwd", () => {
  it.each([
    { input: "/home/alice/projects", expected: "~/projects" },
    { input: "/root/projects", expected: "~/projects" },
    { input: "/home/alice", expected: "~" },
    { input: "/root", expected: "~" },
    { input: "/home", expected: "/home" },
    { input: "/var/log", expected: "/var/log" },
    { input: "/home/bob/a/b/c", expected: "~/a/b/c" },
  ])("shortenCwd($input) → $expected", ({ input, expected }) => {
    expect(shortenCwd(input)).toBe(expected);
  });
});

describe("cwdBasename", () => {
  it.each([
    { input: "/home/alice/projects", expected: "projects" },
    { input: "/home/alice", expected: "~" },
    { input: "/root", expected: "~" },
    { input: "/var/log", expected: "log" },
    { input: "/home/bob/a/b/c", expected: "c" },
  ])("cwdBasename($input) → $expected", ({ input, expected }) => {
    expect(cwdBasename(input)).toBe(expected);
  });
});
