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

  it("rewrites Agent tool_call + tool_result into a subtask block", () => {
    // Claude's Agent tool dispatches a sub-agent that runs in an
    // ephemeral process and only writes its final reply text back into
    // the parent's tool_result. Rendering the dispatch as a regular
    // tool call buries it under the "Tools hidden" toggle; surfacing
    // it as subtask_start + assistant + subtask_end makes the dispatch
    // visible by default.
    const lines = [
      JSON.stringify({
        type: "assistant",
        timestamp: "2024-06-01T12:00:01Z",
        message: {
          role: "assistant",
          model: "claude-opus-4-6",
          content: [
            {
              type: "tool_use",
              id: "tu_agent_1",
              name: "Agent",
              input: {
                description: "Codex hook research",
                subagent_type: "general-purpose",
                prompt: "(long prompt that we don't keep)",
              },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2024-06-01T12:00:30Z",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_agent_1",
              content: [{ type: "text", text: "Found it: see file.rs:42" }],
              is_error: false,
            },
          ],
        },
      }),
    ].join("\n");
    const events = parseClaudeCodeJsonl(lines);
    expect(events.map((e) => e.kind)).toEqual([
      "subtask_start",
      "assistant",
      "subtask_end",
    ]);
    const start = events[0];
    if (start?.kind !== "subtask_start") throw new Error("expected start");
    expect(start.description).toBe("Codex hook research");
    expect(start.agentName).toBe("general-purpose");
    expect(start.sessionId).toBeNull();
    const reply = events[1];
    if (reply?.kind !== "assistant") throw new Error("expected assistant");
    expect(reply.text).toBe("Found it: see file.rs:42");
    // The original tool_call/tool_result for Agent are suppressed —
    // their content is now carried by the subtask block.
    expect(events.some((e) => e.kind === "tool_call")).toBe(false);
    expect(events.some((e) => e.kind === "tool_result")).toBe(false);
  });

  it("supports plain-string Agent tool_result content", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tu_a",
              name: "Agent",
              input: { description: "x", subagent_type: "explore" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "tu_a", content: "raw reply" },
          ],
        },
      }),
    ].join("\n");
    const events = parseClaudeCodeJsonl(lines);
    const reply = events.find((e) => e.kind === "assistant");
    if (reply?.kind !== "assistant") throw new Error("expected assistant");
    expect(reply.text).toBe("raw reply");
  });

  it("leaves non-Agent tool calls untouched", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "tu_r", name: "Read", input: { path: "/x" } },
        ],
      },
    });
    const events = parseClaudeCodeJsonl(line);
    expect(events.map((e) => e.kind)).toEqual(["tool_call"]);
  });
});
