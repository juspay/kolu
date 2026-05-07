import { describe, expect, it } from "vitest";
import {
  normalizeClaudeToolInput,
  parseClaudeCodeJsonl,
} from "./transcript.ts";

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
          {
            type: "tool_use",
            id: "tu_1",
            name: "Read",
            input: { file_path: "/x" },
          },
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
      inputs: { kind: "read", filePath: "/x" },
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
          {
            type: "tool_use",
            id: "tu_r",
            name: "Read",
            input: { file_path: "/x" },
          },
        ],
      },
    });
    const events = parseClaudeCodeJsonl(line);
    expect(events.map((e) => e.kind)).toEqual(["tool_call"]);
  });
});

describe("normalizeClaudeToolInput", () => {
  it("decodes Edit into kind:edit with one hunk", () => {
    expect(
      normalizeClaudeToolInput("Edit", {
        file_path: "/x.ts",
        old_string: "a",
        new_string: "b",
      }),
    ).toEqual({
      kind: "edit",
      filePath: "/x.ts",
      edits: [{ oldText: "a", newText: "b" }],
    });
  });

  it("decodes MultiEdit into kind:edit with multiple hunks", () => {
    expect(
      normalizeClaudeToolInput("MultiEdit", {
        file_path: "/x.ts",
        edits: [
          { old_string: "a", new_string: "b" },
          { old_string: "c", new_string: "d" },
        ],
      }),
    ).toEqual({
      kind: "edit",
      filePath: "/x.ts",
      edits: [
        { oldText: "a", newText: "b" },
        { oldText: "c", newText: "d" },
      ],
    });
  });

  it("decodes Write into kind:write", () => {
    expect(
      normalizeClaudeToolInput("Write", {
        file_path: "/new.ts",
        content: "hello",
      }),
    ).toEqual({ kind: "write", filePath: "/new.ts", content: "hello" });
  });

  it("decodes Bash into kind:bash", () => {
    expect(normalizeClaudeToolInput("Bash", { command: "ls -la" })).toEqual({
      kind: "bash",
      command: "ls -la",
    });
  });

  it("decodes Read into kind:read", () => {
    expect(normalizeClaudeToolInput("Read", { file_path: "/x" })).toEqual({
      kind: "read",
      filePath: "/x",
    });
  });

  it("decodes Glob with optional path", () => {
    expect(
      normalizeClaudeToolInput("Glob", { pattern: "**/*.ts", path: "/proj" }),
    ).toEqual({ kind: "glob", pattern: "**/*.ts", path: "/proj" });
    expect(normalizeClaudeToolInput("Glob", { pattern: "*.md" })).toEqual({
      kind: "glob",
      pattern: "*.md",
      path: null,
    });
  });

  it("falls through to unknown for tools we don't model", () => {
    const raw = { weird: "shape" };
    expect(normalizeClaudeToolInput("VendorThing", raw)).toEqual({
      kind: "unknown",
      toolName: "VendorThing",
      raw,
    });
  });

  it("normalizes Skill invocations (with args)", () => {
    expect(
      normalizeClaudeToolInput("Skill", {
        skill: "lowy",
        args: "evaluate this proposal",
      }),
    ).toEqual({
      kind: "skill",
      name: "lowy",
      args: "evaluate this proposal",
    });
  });

  it("normalizes Skill invocations without args (slash-command form)", () => {
    expect(normalizeClaudeToolInput("Skill", { skill: "ci" })).toEqual({
      kind: "skill",
      name: "ci",
      args: null,
    });
  });

  it("decodes WebSearch into kind:web_search", () => {
    expect(
      normalizeClaudeToolInput("WebSearch", {
        query: "claude code tools reference",
      }),
    ).toEqual({ kind: "web_search", query: "claude code tools reference" });
  });

  it("decodes PowerShell into kind:bash (same shape, same intent)", () => {
    expect(
      normalizeClaudeToolInput("PowerShell", {
        command: "Get-Process | Sort-Object CPU",
      }),
    ).toEqual({ kind: "bash", command: "Get-Process | Sort-Object CPU" });
  });

  it("decodes the full Task family into kind:task with op-discriminated summaries", () => {
    expect(
      normalizeClaudeToolInput("TaskCreate", {
        subject: "evidence",
        description: "Capture PR evidence if configured",
      }),
    ).toEqual({ kind: "task", op: "create", summary: "evidence" });
    expect(
      normalizeClaudeToolInput("TaskUpdate", {
        taskId: "5",
        status: "in_progress",
      }),
    ).toEqual({ kind: "task", op: "update", summary: "5" });
    expect(normalizeClaudeToolInput("TaskGet", { taskId: "7" })).toEqual({
      kind: "task",
      op: "get",
      summary: "7",
    });
    expect(normalizeClaudeToolInput("TaskList", {})).toEqual({
      kind: "task",
      op: "list",
      summary: null,
    });
    expect(normalizeClaudeToolInput("TaskOutput", { taskId: "9" })).toEqual({
      kind: "task",
      op: "output",
      summary: "9",
    });
    expect(normalizeClaudeToolInput("TaskStop", { taskId: "11" })).toEqual({
      kind: "task",
      op: "stop",
      summary: "11",
    });
    expect(
      normalizeClaudeToolInput("TodoWrite", {
        todos: [{ id: 1 }, { id: 2 }, { id: 3 }],
      }),
    ).toEqual({ kind: "task", op: "write", summary: "3 todos" });
  });

  it("decodes AskUserQuestion into kind:ask", () => {
    expect(
      normalizeClaudeToolInput("AskUserQuestion", {
        question: "Which database?",
      }),
    ).toEqual({ kind: "ask", question: "Which database?" });
  });

  it("decodes plan-mode transitions into kind:plan_mode", () => {
    expect(
      normalizeClaudeToolInput("EnterPlanMode", { plan: "step 1\nstep 2" }),
    ).toEqual({ kind: "plan_mode", op: "enter", plan: "step 1\nstep 2" });
    expect(normalizeClaudeToolInput("ExitPlanMode", {})).toEqual({
      kind: "plan_mode",
      op: "exit",
      plan: null,
    });
  });

  it("decodes worktree transitions into kind:worktree", () => {
    expect(
      normalizeClaudeToolInput("EnterWorktree", { path: "/feat/x" }),
    ).toEqual({ kind: "worktree", op: "enter", path: "/feat/x" });
    expect(normalizeClaudeToolInput("ExitWorktree", {})).toEqual({
      kind: "worktree",
      op: "exit",
      path: null,
    });
  });

  it("decodes Cron tools into kind:cron", () => {
    expect(
      normalizeClaudeToolInput("CronCreate", {
        when: "*/5 * * * *",
        prompt: "check CI",
      }),
    ).toEqual({ kind: "cron", op: "create", summary: "check CI" });
    expect(normalizeClaudeToolInput("CronDelete", { id: "c-1" })).toEqual({
      kind: "cron",
      op: "delete",
      summary: "c-1",
    });
    expect(normalizeClaudeToolInput("CronList", {})).toEqual({
      kind: "cron",
      op: "list",
      summary: null,
    });
  });

  it("decodes Monitor into kind:monitor", () => {
    expect(
      normalizeClaudeToolInput("Monitor", { command: "tail -f log" }),
    ).toEqual({ kind: "monitor", command: "tail -f log" });
  });

  it("decodes MCP resource tools into kind:mcp_resource", () => {
    expect(normalizeClaudeToolInput("ListMcpResourcesTool", {})).toEqual({
      kind: "mcp_resource",
      op: "list",
      uri: null,
    });
    expect(
      normalizeClaudeToolInput("ReadMcpResourceTool", {
        uri: "mcp://server/x",
      }),
    ).toEqual({ kind: "mcp_resource", op: "read", uri: "mcp://server/x" });
  });

  it("decodes SendMessage into kind:send_message", () => {
    expect(
      normalizeClaudeToolInput("SendMessage", {
        to: "agent-7",
        content: "ping",
      }),
    ).toEqual({ kind: "send_message", to: "agent-7", content: "ping" });
  });

  it("decodes Team tools into kind:team", () => {
    expect(
      normalizeClaudeToolInput("TeamCreate", {
        teammates: [{ name: "a" }, { name: "b" }],
      }),
    ).toEqual({ kind: "team", op: "create", summary: "2 teammates" });
    expect(normalizeClaudeToolInput("TeamDelete", { teamId: "t-3" })).toEqual({
      kind: "team",
      op: "delete",
      summary: "t-3",
    });
  });

  it("decodes ToolSearch into kind:tool_search", () => {
    expect(
      normalizeClaudeToolInput("ToolSearch", { query: "screenshot" }),
    ).toEqual({ kind: "tool_search", query: "screenshot" });
  });
});
