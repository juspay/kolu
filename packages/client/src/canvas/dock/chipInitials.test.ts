import type { TerminalMetadata } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import { chipInitials } from "./chipInitials";

function info(group: string, label: string): TerminalDisplayInfo {
  return {
    repoColor: "#000",
    branchColor: "#000",
    annotationColor: "#000",
    meta: {
      cwd: "/tmp",
      git: null,
      pr: { kind: "absent" },
      agent: null,
      foreground: null,
      lastActivityAt: 0,
    },
    subCount: 0,
    key: { group, label },
  };
}

function meta(intent?: string): TerminalMetadata {
  return {
    cwd: "/tmp",
    git: null,
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
    lastActivityAt: 0,
    intent,
  };
}

describe("chipInitials", () => {
  it("uppercase first letter of repo, lowercase first letter of branch when no intent", () => {
    expect(chipInitials(meta(), info("kolu", "main"))).toEqual({
      repo: "K",
      sub: "m",
      subIsGlyph: false,
    });
  });

  it("takes branch tail after the last slash", () => {
    expect(chipInitials(meta(), info("kolu", "feat/dock-bare"))).toEqual({
      repo: "K",
      sub: "d",
      subIsGlyph: false,
    });
  });

  it("prefers intent line-1 over branch when set", () => {
    expect(chipInitials(meta("refactor pass"), info("kolu", "main"))).toEqual({
      repo: "K",
      sub: "r",
      subIsGlyph: false,
    });
  });

  it("surfaces an emoji prefix as the sub glyph", () => {
    expect(chipInitials(meta("🛟 FLOAT/right"), info("kolu", "main"))).toEqual({
      repo: "K",
      sub: "🛟",
      subIsGlyph: true,
    });
  });

  it("keeps ZWJ-joined emoji as one grapheme", () => {
    expect(chipInitials(meta("🏳️‍🌈 pride"), info("kolu", "main"))).toEqual({
      repo: "K",
      sub: "🏳️‍🌈",
      subIsGlyph: true,
    });
  });

  it("keeps flag emoji as one grapheme", () => {
    expect(chipInitials(meta("🇺🇸 ship"), info("kolu", "main"))).toEqual({
      repo: "K",
      sub: "🇺🇸",
      subIsGlyph: true,
    });
  });

  it("strips leading markdown emphasis", () => {
    expect(chipInitials(meta("**urgent** fix"), info("kolu", "main"))).toEqual({
      repo: "K",
      sub: "u",
      subIsGlyph: false,
    });
  });

  it("strips leading heading hash", () => {
    expect(chipInitials(meta("## header"), info("kolu", "main"))).toEqual({
      repo: "K",
      sub: "h",
      subIsGlyph: false,
    });
  });

  it("strips leading blockquote and code-fence marks", () => {
    expect(chipInitials(meta("> quoted"), info("kolu", "main"))).toEqual({
      repo: "K",
      sub: "q",
      subIsGlyph: false,
    });
    expect(chipInitials(meta("`code`"), info("kolu", "main"))).toEqual({
      repo: "K",
      sub: "c",
      subIsGlyph: false,
    });
  });

  it("uses only line 1 of a multi-line intent", () => {
    expect(
      chipInitials(meta("🛟 lifeline\n\nlonger body"), info("kolu", "main")),
    ).toEqual({ repo: "K", sub: "🛟", subIsGlyph: true });
  });

  it("falls back to branch when intent is markdown-chrome only", () => {
    expect(chipInitials(meta("***"), info("kolu", "feat/dock-bare"))).toEqual({
      repo: "K",
      sub: "d",
      subIsGlyph: false,
    });
  });

  it("strips intent leading whitespace before extracting", () => {
    expect(chipInitials(meta("   spaced"), info("kolu", "main"))).toEqual({
      repo: "K",
      sub: "s",
      subIsGlyph: false,
    });
  });

  it("falls back to ? when repo and branch are unrenderable", () => {
    expect(chipInitials(meta(), info("---", ""))).toEqual({
      repo: "?",
      sub: "?",
      subIsGlyph: false,
    });
  });

  it("uppercases repo letter even when repo has leading punctuation", () => {
    expect(chipInitials(meta(), info(".dotfiles", "main"))).toEqual({
      repo: "D",
      sub: "m",
      subIsGlyph: false,
    });
  });
});
