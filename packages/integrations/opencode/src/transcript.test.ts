import { describe, expect, it } from "vitest";
import { eventsFromMessageParts } from "./transcript.ts";

describe("eventsFromMessageParts", () => {
  it("returns [] for empty parts", () => {
    expect(eventsFromMessageParts("user", null, null, [])).toEqual([]);
  });

  it("emits user text from a user message's text part", () => {
    expect(
      eventsFromMessageParts("user", null, 1000, [
        { type: "text", text: "Hi" },
      ]),
    ).toEqual([{ kind: "user", text: "Hi", ts: 1000 }]);
  });

  it("emits assistant text + reasoning from an assistant message", () => {
    const events = eventsFromMessageParts(
      "assistant",
      "litellm/glm-latest",
      2000,
      [
        { type: "reasoning", text: "thinking..." },
        { type: "text", text: "Reply." },
      ],
    );
    expect(events).toEqual([
      { kind: "reasoning", text: "thinking...", ts: 2000 },
      {
        kind: "assistant",
        text: "Reply.",
        model: "litellm/glm-latest",
        ts: 2000,
      },
    ]);
  });

  it("pairs a completed tool part into call + result events", () => {
    const events = eventsFromMessageParts("assistant", null, 3000, [
      {
        type: "tool",
        callID: "call_1",
        tool: "glob",
        state: {
          status: "completed",
          input: { pattern: "**/*.ts" },
          output: "file.ts",
        },
      },
    ]);
    expect(events).toEqual([
      {
        kind: "tool_call",
        id: "call_1",
        toolName: "glob",
        inputs: { pattern: "**/*.ts" },
        ts: 3000,
      },
      {
        kind: "tool_result",
        id: "call_1",
        output: "file.ts",
        isError: false,
        ts: 3000,
      },
    ]);
  });

  it("emits a call without a result for an in-flight tool part", () => {
    const events = eventsFromMessageParts("assistant", null, 3000, [
      {
        type: "tool",
        callID: "call_2",
        tool: "edit",
        state: { status: "running", input: { path: "/x" } },
      },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "tool_call", toolName: "edit" });
  });

  it("flags isError on tool parts with status=error", () => {
    const events = eventsFromMessageParts("assistant", null, 3000, [
      {
        type: "tool",
        callID: "call_3",
        tool: "exec",
        state: { status: "error", output: "non-zero exit" },
      },
    ]);
    expect(events[1]).toMatchObject({ kind: "tool_result", isError: true });
  });

  it("skips lifecycle and metadata part types", () => {
    expect(
      eventsFromMessageParts("assistant", null, 1000, [
        { type: "step-start" },
        { type: "step-finish" },
        { type: "compaction" },
        { type: "agent" },
        { type: "subtask" },
        { type: "file", filename: "x.md" },
        { type: "patch" },
      ]),
    ).toEqual([]);
  });
});
