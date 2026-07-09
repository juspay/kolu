import { describe, expect, it } from "vitest";
import { parseCommand } from "./protocol.ts";

describe("parseCommand", () => {
  it("parses a bare state", () => {
    expect(parseCommand("state thinking")).toEqual({
      verb: "state",
      state: "thinking",
      opts: {},
    });
  });

  it("parses codex token opts", () => {
    expect(parseCommand("state waiting input=30000 cached=10000")).toEqual({
      verb: "state",
      state: "waiting",
      opts: { inputTokens: 30000, cachedInputTokens: 10000 },
    });
  });

  it("parses opencode context + todos", () => {
    expect(parseCommand("state tool_use context=23000 todos=5/3")).toEqual({
      verb: "state",
      state: "tool_use",
      opts: { contextTokens: 23000, todos: { total: 5, completed: 3 } },
    });
  });

  it("parses claude task progress + stale-jsonl flag", () => {
    expect(parseCommand("state waiting tasks=5/3 stale-jsonl")).toEqual({
      verb: "state",
      state: "waiting",
      opts: { tasks: { total: 5, completed: 3 }, staleJsonl: true },
    });
  });

  it("parses grok no-active flag", () => {
    expect(parseCommand("state thinking no-active")).toEqual({
      verb: "state",
      state: "thinking",
      opts: { noActive: true },
    });
  });

  it("parses harness seq opt", () => {
    expect(parseCommand("state waiting input=30000 seq=7")).toEqual({
      verb: "state",
      state: "waiting",
      opts: { inputTokens: 30000, seq: 7 },
    });
  });

  it("rejects an unknown state name loudly", () => {
    expect(parseCommand("state thnking")).toEqual({
      verb: "unknown",
      raw: "state thnking",
    });
  });

  it("rejects a bare state verb", () => {
    expect(parseCommand("state")).toEqual({
      verb: "unknown",
      raw: "state",
    });
  });

  it("parses quit", () => {
    expect(parseCommand("quit")).toEqual({ verb: "quit" });
  });

  it("tolerates surrounding whitespace and collapses runs", () => {
    expect(parseCommand("   state   thinking   ")).toEqual({
      verb: "state",
      state: "thinking",
      opts: {},
    });
  });

  it("returns null for a blank line", () => {
    expect(parseCommand("   ")).toBeNull();
  });

  it("flags an unknown verb loudly", () => {
    expect(parseCommand("frobnicate now")).toEqual({
      verb: "unknown",
      raw: "frobnicate",
    });
  });
});
