/** The composer's grammar: where a completion opens, what it offers, what it
 *  writes back, and which `@name`s become structured mentions — a terminal's
 *  or a piece of work's — when the message finally goes. */

import type { TerminalId } from "kolu-common/surface";
import { openWork, type Work, type WorkId } from "kolu-work";
import { describe, expect, it } from "vitest";
import {
  armedMentions,
  armedMentionText,
  completeToken,
  dropMention,
  filterMentions,
  type MentionCandidate,
  tokenQueryAt,
  withScopeMention,
  workSlug,
} from "./mentions";

const terminal = (
  name: string,
  id: string,
  host = "local",
): MentionCandidate => ({
  kind: "terminal",
  terminalId: id as TerminalId,
  host,
  name,
  intent: `${name} intent`,
  cwd: `/repo/${name}`,
  repo: "KOLU",
  detail: { kind: "intent", text: `${name} intent` },
});

const record = (title: string): Work =>
  openWork({
    key: {
      kind: "branch",
      host: "local",
      repo: "/r",
      branch: title,
      repoBy: "git",
    },
    title,
    at: "2026-11-16T12:00:00.000Z",
    request: { kind: "none" },
  });

const work = (
  title: string,
  id: string,
  standing = "Agents at work",
): MentionCandidate => ({
  kind: "work",
  work: id as WorkId,
  title,
  name: workSlug(title),
  record: record(title),
  standing,
});

const PANE: WorkId = "branch:local/%2Fr/pane" as WorkId;
const fleet = [
  terminal("fix-parser", "11111111-1111-4111-8111-111111111111"),
  terminal("fix-docs", "22222222-2222-4222-8222-222222222222"),
  terminal("odu-cache", "33333333-3333-4333-8333-333333333333"),
];
/** The menu's own order: what needs the human, then what is in progress,
 *  then the terminals. */
const menu = [
  work("Published agents fetchable by any host", "branch:local/%2Fr/agents"),
  work("Page chats open in a pane", PANE),
  ...fleet,
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

  it("offers a work by part of its TITLE — `@pa` is the pane work", () => {
    expect(filterMentions(menu, "pa")[0]).toMatchObject({
      kind: "work",
      title: "Page chats open in a pane",
    });
  });

  it("keeps the works above the terminals, in the order they were given", () => {
    expect(
      filterMentions(menu, "").map((one) =>
        one.kind === "work" ? one.title : one.name,
      ),
    ).toEqual([
      "Published agents fetchable by any host",
      "Page chats open in a pane",
      "fix-parser",
      "fix-docs",
      "odu-cache",
    ]);
  });

  it("puts a work the query is only CONTAINED in above a terminal it starts", () => {
    // `fix` prefixes two terminals and sits in the middle of the work's
    // title. The group outranks the match, so the menu's two headings never
    // interleave.
    const named = [
      work("Nothing left to fix in the parser", "branch:local/%2Fr/fixes"),
      ...fleet,
    ];
    expect(filterMentions(named, "fix").map((one) => one.kind)).toEqual([
      "work",
      "terminal",
      "terminal",
    ]);
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

/** The mentions alone, as the wire carries them. */
const mentionsOf = (text: string, candidates: readonly MentionCandidate[]) =>
  armedMentions(text, candidates).map((one) => one.mention);

describe("the mentions a message carries", () => {
  it("resolves each named terminal once, in order", () => {
    const mentions = mentionsOf(
      "@odu-cache and @fix-parser, then @odu-cache again",
      fleet,
    );
    expect(mentions.map((one) => one.kind === "terminal" && one.name)).toEqual([
      "odu-cache",
      "fix-parser",
    ]);
    expect(mentions[0]).toMatchObject({
      kind: "terminal",
      terminalId: "33333333-3333-4333-8333-333333333333",
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
    const mentions = mentionsOf("@main and @fix-docs", crossHost);
    expect(
      mentions.map((one) =>
        one.kind === "terminal" ? [one.name, one.host] : [],
      ),
    ).toEqual([
      ["main", "remote:zest"],
      ["fix-docs", "local"],
    ]);
  });

  it("resolves a work's SLUG to the work, with the title it has now", () => {
    expect(
      mentionsOf("what is left in @page-chats-open-in-a-pane?", menu),
    ).toEqual([
      { kind: "work", work: PANE, title: "Page chats open in a pane" },
    ]);
  });

  it("gives a token both a work and a terminal answer to to the WORK", () => {
    // The branch a work was cut from often names the terminal working on it.
    const both = [work("fix parser", "branch:local/%2Fr/fix-parser"), ...fleet];
    expect(mentionsOf("@fix-parser go", both)).toEqual([
      {
        kind: "work",
        work: "branch:local/%2Fr/fix-parser",
        title: "fix parser",
      },
    ]);
  });

  it("leaves a name nothing answers to as ordinary prose", () => {
    expect(mentionsOf("@nobody there", fleet)).toEqual([]);
  });

  it("ignores a trigger glued to a word", () => {
    expect(mentionsOf("mail me@fix-parser", fleet)).toEqual([]);
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

describe("workSlug", () => {
  it("is the title as one typeable word", () => {
    expect(workSlug("Page chats open in a pane")).toBe(
      "page-chats-open-in-a-pane",
    );
    expect(workSlug("  Folders inside a work's files! ")).toBe(
      "folders-inside-a-work-s-files",
    );
  });

  it("keeps the letters of a title that is not English", () => {
    expect(workSlug("Разбор строк")).toBe("разбор-строк");
  });
});

describe("armedMentions", () => {
  it("carries the word each mention was typed as: a terminal's name, a work's word", () => {
    expect(
      armedMentions("@fix-docs and @page-chats-open-in-a-pane", menu).map(
        (one) => one.token,
      ),
    ).toEqual(["fix-docs", "page-chats-open-in-a-pane"]);
  });

  it("is what dropMention takes the chip's × to mean", () => {
    const text = "@page-chats-open-in-a-pane what is left?";
    const chip = armedMentions(text, menu)[0];
    expect(chip && dropMention(text, chip.token)).toBe("what is left?");
  });
});

describe("withScopeMention", () => {
  const scope = { kind: "work", work: PANE, title: "Page chats" } as const;

  it("adds the work the chat is pointed at to a message that did not name it", () => {
    expect(withScopeMention([], scope)).toEqual([scope]);
  });

  it("does not name it twice when the words already did", () => {
    const typed = mentionsOf("@page-chats-open-in-a-pane ok", menu);
    expect(withScopeMention(typed, scope)).toEqual(typed);
  });

  it("changes nothing when the chat is about everything", () => {
    const typed = mentionsOf("@fix-docs ok", fleet);
    expect(withScopeMention(typed, null)).toBe(typed);
  });
});
