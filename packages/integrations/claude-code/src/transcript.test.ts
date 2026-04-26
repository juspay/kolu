import { describe, expect, it } from "vitest";
import { parseClaudeCodeJsonl } from "./transcript.ts";

describe("parseClaudeCodeJsonl", () => {
  it("returns [] for an empty transcript", () => {
    expect(parseClaudeCodeJsonl("")).toEqual([]);
  });

  it("parses a string user message", () => {
    const line = JSON.stringify({
      type: "user",
      timestamp: "2024-06-01T12:00:00Z",
      message: { role: "user", content: "Hello" },
    });
    expect(parseClaudeCodeJsonl(line)).toEqual([
      { kind: "user", text: "Hello", ts: Date.parse("2024-06-01T12:00:00Z") },
    ]);
  });

  it("fans assistant content blocks into text + thinking + tool_use events", () => {
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2024-06-01T12:00:01Z",
      message: {
        role: "assistant",
        model: "claude-opus-4-6",
        content: [
          { type: "thinking", thinking: "let me think" },
          { type: "text", text: "Here is my reply." },
          { type: "tool_use", id: "tu_1", name: "Read", input: { path: "/x" } },
        ],
      },
    });
    const events = parseClaudeCodeJsonl(line);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      kind: "reasoning",
      text: "let me think",
    });
    expect(events[1]).toMatchObject({
      kind: "assistant",
      text: "Here is my reply.",
      model: "claude-opus-4-6",
    });
    expect(events[2]).toMatchObject({
      kind: "tool_call",
      id: "tu_1",
      toolName: "Read",
      inputs: { path: "/x" },
    });
  });

  it("emits tool_result events from user-line tool_result blocks", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu_1",
            content: "ok",
            is_error: false,
          },
        ],
      },
    });
    expect(parseClaudeCodeJsonl(line)).toEqual([
      {
        kind: "tool_result",
        id: "tu_1",
        output: "ok",
        isError: false,
        ts: null,
      },
    ]);
  });

  it("flags is_error: true on tool_result blocks", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu_2",
            content: "boom",
            is_error: true,
          },
        ],
      },
    });
    expect(parseClaudeCodeJsonl(line)[0]).toMatchObject({
      kind: "tool_result",
      isError: true,
    });
  });

  it("skips malformed JSON lines silently", () => {
    const lines = [
      "not json",
      JSON.stringify({
        type: "user",
        message: { content: "ok" },
      }),
      "{",
    ].join("\n");
    expect(parseClaudeCodeJsonl(lines)).toHaveLength(1);
  });

  it("ignores entries without a recognized type", () => {
    const line = JSON.stringify({ type: "summary", summary: "auto" });
    expect(parseClaudeCodeJsonl(line)).toEqual([]);
  });
});
