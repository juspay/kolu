/** The composer's grammar: where a completion opens, what it offers, what it
 *  writes back, and which `@name`s become structured mentions when the message
 *  finally goes. */

import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  armedMentionText,
  completeToken,
  dropMention,
  filterMentions,
  type MentionCandidate,
  resolveMentions,
  tokenQueryAt,
} from "./mentions";

const terminal = (
  name: string,
  id: string,
  host = "local",
): MentionCandidate => ({
  terminalId: id as TerminalId,
  host,
  name,
  intent: `${name} intent`,
  cwd: `/repo/${name}`,
  repo: "KOLU",
  state: "working",
});

const fleet = [
  terminal("fix-parser", "11111111-1111-4111-8111-111111111111"),
  terminal("fix-docs", "22222222-2222-4222-8222-222222222222"),
  terminal("odu-cache", "33333333-3333-4333-8333-333333333333"),
];

describe("tokenQueryAt", () => {
  it("finds the token the caret sits in", () => {
    expect(tokenQueryAt("tell @fix", 9, "@")).toEqual({
      start: 5,
      end: 9,
      query: "fix",
    });
  });

  it("opens at the very start of the text", () => {
    expect(tokenQueryAt("@f", 2, "@")).toMatchObject({ query: "f" });
  });

  it("refuses a trigger glued to a word — an email is not a mention", () => {
    expect(tokenQueryAt("me@example.com", 14, "@")).toBeNull();
  });

  it("closes once whitespace is typed", () => {
    expect(tokenQueryAt("@fix-parser ", 12, "@")).toBeNull();
  });

  it("reads the slash grammar with the same rule", () => {
    expect(tokenQueryAt("/comp", 5, "/")).toMatchObject({ query: "comp" });
    expect(tokenQueryAt("a/b", 3, "/")).toBeNull();
  });
});

describe("filterMentions", () => {
  it("ranks a prefix match above a contained one", () => {
    const names = filterMentions(fleet, "fix").map((c) => c.name);
    expect(names).toEqual(["fix-parser", "fix-docs"]);
  });

  it("matches on the intent as well as the name", () => {
    expect(filterMentions(fleet, "cache").map((c) => c.name)).toEqual([
      "odu-cache",
    ]);
  });

  it("offers everything for an empty query", () => {
    expect(filterMentions(fleet, "")).toHaveLength(3);
  });
});

describe("completeToken", () => {
  it("replaces the token and leaves the caret past one space", () => {
    const next = completeToken(
      "tell @fix",
      { start: 5, end: 9, query: "fix" },
      "@",
      "fix-parser",
    );
    expect(next.text).toBe("tell @fix-parser ");
    expect(next.caret).toBe(next.text.length);
  });

  it("keeps whatever followed the token", () => {
    const next = completeToken(
      "tell @fix to stop",
      { start: 5, end: 9, query: "fix" },
      "@",
      "fix-parser",
    );
    expect(next.text).toBe("tell @fix-parser to stop");
  });
});

describe("resolveMentions", () => {
  it("resolves each named terminal once, in order", () => {
    const mentions = resolveMentions(
      "@odu-cache and @fix-parser, then @odu-cache again",
      fleet,
    );
    expect(mentions.map((m) => m.name)).toEqual(["odu-cache", "fix-parser"]);
    expect(mentions[0]).toMatchObject({
      terminalId: fleet[2]?.terminalId,
      cwd: "/repo/odu-cache",
    });
  });

  it("carries the HOST each terminal is on — the other half of `host/id`", () => {
    // A fleet where the warmer `main` is the remote one: the reference that
    // goes out must name THAT machine, or kolu-server joins the id to the
    // wrong half and the agent types into a terminal nobody meant.
    const crossHost = [
      terminal("main", "44444444-4444-4444-8444-444444444444", "remote:zest"),
      terminal("fix-docs", "22222222-2222-4222-8222-222222222222"),
    ];
    const mentions = resolveMentions("@main and @fix-docs", crossHost);
    expect(mentions.map((m) => [m.name, m.host])).toEqual([
      ["main", "remote:zest"],
      ["fix-docs", "local"],
    ]);
  });

  it("leaves a name nothing answers to as ordinary prose", () => {
    expect(resolveMentions("@nobody there", fleet)).toEqual([]);
  });

  it("ignores a trigger glued to a word", () => {
    expect(resolveMentions("mail me@fix-parser", fleet)).toEqual([]);
  });
});

describe("dropMention", () => {
  it("removes every occurrence of the chip's token", () => {
    expect(dropMention("@fix-parser go, @fix-parser now", "fix-parser")).toBe(
      "go, now",
    );
  });

  it("leaves a longer name that merely starts the same", () => {
    expect(dropMention("@fix-parser @fix-docs", "fix-docs")).toBe(
      "@fix-parser",
    );
  });
});

describe("armedMentionText", () => {
  it("prepends the mention, keeping what was already typed", () => {
    expect(armedMentionText("when green, merge it", "fix-parser")).toBe(
      "@fix-parser when green, merge it",
    );
  });

  it("does not arm the same terminal twice", () => {
    expect(armedMentionText("@fix-parser go", "fix-parser")).toBe(
      "@fix-parser go",
    );
  });
});
