import { describe, expect, it } from "vitest";
import { normalizeCodexToolInput, parseCodexRollout } from "./transcript.ts";

function lines(...objs: unknown[]): string {
  return `${objs.map((o) => JSON.stringify(o)).join("\n")}\n`;
}

describe("parseCodexRollout", () => {
  it("returns [] for an empty rollout", () => {
    expect(parseCodexRollout("")).toEqual([]);
  });

  it("emits user from event_msg:user_message", () => {
    const content = lines({
      timestamp: "2024-06-01T12:00:00Z",
      type: "event_msg",
      payload: { type: "user_message", message: "Hi" },
    });
    expect(parseCodexRollout(content)).toEqual([
      { kind: "user", text: "Hi", ts: Date.parse("2024-06-01T12:00:00Z") },
    ]);
  });

  it("emits assistant from event_msg:agent_message", () => {
    const content = lines({
      timestamp: "2024-06-01T12:00:01Z",
      type: "event_msg",
      payload: { type: "agent_message", message: "Reply." },
    });
    expect(parseCodexRollout(content)).toEqual([
      {
        kind: "assistant",
        text: "Reply.",
        model: null,
        ts: Date.parse("2024-06-01T12:00:01Z"),
      },
    ]);
  });

  it("emits reasoning from response_item:reasoning summary parts", () => {
    const content = lines({
      type: "response_item",
      payload: {
        type: "reasoning",
        summary: [
          { type: "summary_text", text: "First step." },
          { type: "summary_text", text: "Second step." },
        ],
      },
    });
    const out = parseCodexRollout(content);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "reasoning",
      text: "First step.\nSecond step.",
    });
  });

  it("parses a function_call's JSON arguments string", () => {
    const content = lines({
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: '{"cmd":"ls"}',
        call_id: "call_1",
      },
    });
    expect(parseCodexRollout(content)).toEqual([
      {
        kind: "tool_call",
        id: "call_1",
        toolName: "exec_command",
        inputs: { kind: "bash", command: "ls" },
        ts: null,
      },
    ]);
  });

  it("decodes apply_patch's raw string into kind:patch", () => {
    const content = lines({
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        name: "apply_patch",
        input: "*** Begin Patch\n…",
        call_id: "call_2",
      },
    });
    const out = parseCodexRollout(content);
    expect(out[0]).toMatchObject({
      kind: "tool_call",
      toolName: "apply_patch",
      inputs: { kind: "patch", text: "*** Begin Patch\n…" },
    });
  });

  it("emits tool_result from function_call_output", () => {
    const content = lines({
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call_1",
        output: '{"ok":true}',
      },
    });
    expect(parseCodexRollout(content)).toEqual([
      {
        kind: "tool_result",
        id: "call_1",
        output: { ok: true },
        isError: false,
        ts: null,
      },
    ]);
  });

  it("skips session_meta, turn_context, lifecycle, and developer messages", () => {
    const content = lines(
      { type: "session_meta", payload: { id: "x" } },
      { type: "turn_context", payload: { turn_id: "t1" } },
      { type: "event_msg", payload: { type: "task_started", turn_id: "t1" } },
      { type: "event_msg", payload: { type: "task_complete", turn_id: "t1" } },
      { type: "event_msg", payload: { type: "token_count", info: null } },
      {
        type: "response_item",
        payload: { type: "message", role: "developer", content: [] },
      },
    );
    expect(parseCodexRollout(content)).toEqual([]);
  });

  it("skips malformed JSON lines silently", () => {
    const content = `not-json\n${JSON.stringify({
      type: "event_msg",
      payload: { type: "user_message", message: "Hi" },
    })}\n{\n`;
    expect(parseCodexRollout(content)).toHaveLength(1);
  });
});

describe("normalizeCodexToolInput", () => {
  it("decodes exec_command (cmd string) into kind:bash", () => {
    expect(normalizeCodexToolInput("exec_command", { cmd: "ls" })).toEqual({
      kind: "bash",
      command: "ls",
    });
  });

  it("decodes exec_command (command array) into kind:bash with joined argv", () => {
    expect(
      normalizeCodexToolInput("exec_command", { command: ["ls", "-la"] }),
    ).toEqual({ kind: "bash", command: "ls -la" });
  });

  it("decodes apply_patch from a raw string", () => {
    expect(normalizeCodexToolInput("apply_patch", "*** Begin Patch")).toEqual({
      kind: "patch",
      text: "*** Begin Patch",
    });
  });

  it("decodes apply_patch from an object with patch field", () => {
    expect(
      normalizeCodexToolInput("apply_patch", { patch: "diff text" }),
    ).toEqual({ kind: "patch", text: "diff text" });
  });

  it("decodes read_file into kind:read", () => {
    expect(normalizeCodexToolInput("read_file", { path: "/x" })).toEqual({
      kind: "read",
      filePath: "/x",
    });
  });

  it("decodes web_fetch into kind:fetch", () => {
    expect(
      normalizeCodexToolInput("web_fetch", { url: "https://x.example" }),
    ).toEqual({ kind: "fetch", url: "https://x.example" });
  });

  it("falls through to unknown for tools we don't model", () => {
    expect(normalizeCodexToolInput("vendor_tool", { foo: 1 })).toEqual({
      kind: "unknown",
      toolName: "vendor_tool",
      raw: { foo: 1 },
    });
  });

  it("normalizes Skill invocations", () => {
    expect(
      normalizeCodexToolInput("skill", { skill: "lowy", args: "evaluate" }),
    ).toEqual({ kind: "skill", name: "lowy", args: "evaluate" });
  });

  it("decodes web_search into kind:web_search", () => {
    expect(
      normalizeCodexToolInput("web_search", { query: "anything" }),
    ).toEqual({ kind: "web_search", query: "anything" });
  });
});
