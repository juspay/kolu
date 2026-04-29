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

  it("decodes apply_patch's raw string into kind:patch (unified-diff text)", () => {
    const content = lines({
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        name: "apply_patch",
        input: "*** Begin Patch\n*** Add File: foo\n+x\n*** End Patch\n",
        call_id: "call_2",
      },
    });
    const out = parseCodexRollout(content);
    if (out[0]?.kind !== "tool_call") throw new Error("expected tool_call");
    if (out[0].inputs.kind !== "patch") throw new Error("expected patch");
    expect(out[0].inputs.text).toContain("diff --git a/foo b/foo");
    expect(out[0].inputs.text).not.toContain("*** Begin Patch");
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

  it("decodes apply_patch from a raw envelope into unified-diff text", () => {
    const out = normalizeCodexToolInput(
      "apply_patch",
      "*** Begin Patch\n*** Add File: x\n+y\n*** End Patch\n",
    );
    if (out.kind !== "patch") throw new Error("expected kind:patch");
    expect(out.text).toContain("diff --git a/x b/x");
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

  it("converts Codex's *** Begin Patch envelope into unified diff", () => {
    const envelope = [
      "*** Begin Patch",
      "*** Add File: foo.ts",
      "+const a = 1;",
      "+const b = 2;",
      "*** Update File: bar.ts",
      "@@",
      " context line",
      "-old line",
      "+new line",
      "*** Delete File: baz.ts",
      "-dead line",
      "*** End Patch",
    ].join("\n");
    const out = normalizeCodexToolInput("apply_patch", envelope);
    if (out.kind !== "patch") throw new Error("expected kind:patch");
    // Every file lands as its own `diff --git` block — multi-file
    // payloads round-trip through Pierre's `parsePatchFiles`.
    expect(out.text).toContain("diff --git a/foo.ts b/foo.ts");
    expect(out.text).toContain("new file mode 100644");
    expect(out.text).toContain("@@ -0,0 +1,2 @@");
    expect(out.text).toContain("diff --git a/bar.ts b/bar.ts");
    expect(out.text).toContain(" context line");
    expect(out.text).toContain("-old line");
    expect(out.text).toContain("+new line");
    expect(out.text).toContain("diff --git a/baz.ts b/baz.ts");
    expect(out.text).toContain("deleted file mode 100644");
    // The original envelope markers don't leak through.
    expect(out.text).not.toContain("*** Begin Patch");
    expect(out.text).not.toContain("*** Add File:");
  });

  it("passes through plain unified-diff payloads unchanged", () => {
    const diff =
      "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n";
    const out = normalizeCodexToolInput("apply_patch", diff);
    if (out.kind !== "patch") throw new Error("expected kind:patch");
    expect(out.text).toBe(diff);
  });

  it("handles *** Move to: by emitting the destination path", () => {
    const envelope = [
      "*** Begin Patch",
      "*** Update File: old/path.ts",
      "*** Move to: new/path.ts",
      "@@",
      "-x",
      "+y",
      "*** End Patch",
    ].join("\n");
    const out = normalizeCodexToolInput("apply_patch", envelope);
    if (out.kind !== "patch") throw new Error("expected kind:patch");
    expect(out.text).toContain("diff --git a/new/path.ts b/new/path.ts");
    expect(out.text).not.toContain("old/path.ts");
  });
});
