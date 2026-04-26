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

  it("inlines a child subagent run when given an inlineSubtask resolver", () => {
    // Mirrors what the real loader does: the `task` tool's metadata
    // carries `sessionId` (the child session id) and `state.input`
    // carries `description`. The resolver is responsible for loading
    // the child's events; here we stub it.
    const stubChildEvents = [
      { kind: "user" as const, text: "child prompt", ts: 4000 },
      {
        kind: "assistant" as const,
        text: "child reply",
        model: null,
        ts: 4001,
      },
    ];
    const events = eventsFromMessageParts(
      "assistant",
      null,
      3000,
      [
        {
          type: "tool",
          callID: "task_1",
          tool: "task",
          state: {
            status: "completed",
            input: {
              description: "Lowy review of diff",
              subagent_type: "lowy",
            },
            output:
              "task_id: ses_child123 (for resuming)\n\n<task_result>\nLGTM\n</task_result>",
            metadata: { sessionId: "ses_child123" },
          },
        },
      ],
      (childSessionId, description, ts) => [
        {
          kind: "subtask_start",
          description,
          agentName: "lowy",
          sessionId: childSessionId,
          ts,
        },
        ...stubChildEvents,
        { kind: "subtask_end", ts },
      ],
    );
    // tool_call, tool_result, then start, child events, end.
    expect(events.map((e) => e.kind)).toEqual([
      "tool_call",
      "tool_result",
      "subtask_start",
      "user",
      "assistant",
      "subtask_end",
    ]);
    const start = events[2];
    if (start?.kind !== "subtask_start") throw new Error("expected start");
    expect(start.sessionId).toBe("ses_child123");
    expect(start.description).toBe("Lowy review of diff");
    expect(start.agentName).toBe("lowy");
  });

  it("falls back to parsing the child session id from task output when metadata is absent", () => {
    const events = eventsFromMessageParts(
      "assistant",
      null,
      3000,
      [
        {
          type: "tool",
          callID: "task_2",
          tool: "task",
          state: {
            status: "completed",
            input: { description: "Hickey review" },
            output:
              "task_id: ses_fromOutput (resuming...)\n\n<task_result>ok</task_result>",
          },
        },
      ],
      (childSessionId) => [
        {
          kind: "subtask_start",
          description: "x",
          agentName: null,
          sessionId: childSessionId,
          ts: null,
        },
        { kind: "subtask_end", ts: null },
      ],
    );
    const start = events.find((e) => e.kind === "subtask_start");
    if (start?.kind !== "subtask_start") throw new Error("expected start");
    expect(start.sessionId).toBe("ses_fromOutput");
  });

  it("does not inline a subtask for non-task tools", () => {
    const events = eventsFromMessageParts(
      "assistant",
      null,
      3000,
      [
        {
          type: "tool",
          callID: "g_1",
          tool: "glob",
          state: {
            status: "completed",
            input: { pattern: "*.ts" },
            output: "x",
          },
        },
      ],
      () => {
        throw new Error(
          "inlineSubtask should not be called for non-task tools",
        );
      },
    );
    expect(events.map((e) => e.kind)).toEqual(["tool_call", "tool_result"]);
  });

  it("skips empty text and reasoning parts (streaming artifacts)", () => {
    // OpenCode sometimes leaves text parts with empty/whitespace-only
    // text behind — passing those through produced ghost assistant
    // cards in the export with no body.
    const events = eventsFromMessageParts("assistant", null, 1000, [
      { type: "text", text: "" },
      { type: "text", text: "   " },
      { type: "reasoning", text: "" },
      { type: "text", text: "real reply" },
    ]);
    expect(events).toEqual([
      { kind: "assistant", text: "real reply", model: null, ts: 1000 },
    ]);
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
