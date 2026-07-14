import type { Transcript } from "kolu-transcript-core";
import { describe, expect, it } from "vitest";
import {
  assistantCount,
  pickTerminalByTitle,
  replySince,
} from "./coordinator.ts";

describe("pickTerminalByTitle — resolve by title, not id", () => {
  const entries = [
    { id: "aaa", title: "worker-1" },
    { id: "bbb", title: "RT-fable-main" },
    { id: "ccc", title: undefined },
  ];

  it("returns the single terminal with the matching title", () => {
    expect(pickTerminalByTitle(entries, "RT-fable-main").id).toBe("bbb");
  });

  it("throws when no terminal has the title", () => {
    expect(() => pickTerminalByTitle(entries, "nope")).toThrow(
      /no coordinator terminal titled/,
    );
  });

  it("throws when the title is ambiguous", () => {
    const dup = [
      { id: "x", title: "dup" },
      { id: "y", title: "dup" },
    ];
    expect(() => pickTerminalByTitle(dup, "dup")).toThrow(/must be unique/);
  });
});

function transcript(...assistantTexts: string[]): Transcript {
  return {
    agentKind: "claude-code",
    sessionId: "s",
    title: null,
    repoName: null,
    cwd: "/repo",
    model: null,
    contextTokens: null,
    pr: null,
    exportedAt: 0,
    events: assistantTexts.map((text) => ({
      kind: "assistant" as const,
      text,
      model: null,
      ts: null,
    })),
  };
}

describe("replySince / assistantCount — this-turn reply delta", () => {
  it("counts assistant messages", () => {
    expect(assistantCount(transcript("a", "b"))).toBe(2);
    expect(assistantCount(null)).toBe(0);
    expect(assistantCount(transcript())).toBe(0);
  });

  it("returns only the assistant text produced since the baseline", () => {
    const t = transcript("old turn", "new part 1", "new part 2");
    expect(replySince(t, 1)).toBe("new part 1\n\nnew part 2");
  });

  it("is empty when nothing new has landed yet", () => {
    const t = transcript("old turn");
    expect(replySince(t, 1)).toBe("");
    expect(replySince(null, 0)).toBe("");
  });
});
