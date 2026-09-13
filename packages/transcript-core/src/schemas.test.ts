/** Byte-level contract tests for the transcript IR.
 *
 *  The IR is the contract between vendor loaders and renderers, and it
 *  is JSON-shaped (exports are serialised documents). These tests pin
 *  the ENCODED JSON string — not just decode-equality — so a schema
 *  edit that silently renames a field, reorders a struct, or changes a
 *  discriminant value fails here instead of in a renderer.
 *
 *  The exhaustive arm tables also serve as the "every kind is still
 *  spelled the same" gate: adding an arm without extending the table
 *  fails the count assertion. */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  AGENT_KINDS,
  type ToolInput,
  ToolInputSchema,
  type Transcript,
  type TranscriptEvent,
  TranscriptEventSchema,
  TranscriptPrSchema,
  TranscriptSchema,
} from "./schemas.ts";

const decodeTranscript = Schema.decodeUnknownSync(TranscriptSchema);
const encodeTranscript = Schema.encodeSync(TranscriptSchema);
const decodeToolInput = Schema.decodeUnknownSync(ToolInputSchema);
const encodeToolInput = Schema.encodeSync(ToolInputSchema);
const decodeEvent = Schema.decodeUnknownSync(TranscriptEventSchema);
const encodeEvent = Schema.encodeSync(TranscriptEventSchema);
const toolInputResult = Schema.decodeUnknownResult(ToolInputSchema);

/** One value per `ToolInput` arm, in schema-declaration order. */
const TOOL_INPUTS: ReadonlyArray<ToolInput> = [
  {
    kind: "edit",
    filePath: "/repo/a.ts",
    edits: [{ oldText: "a", newText: "b" }],
  },
  { kind: "write", filePath: "/repo/b.ts", content: "hi" },
  { kind: "patch", text: "--- a\n+++ b\n" },
  { kind: "read", filePath: "/repo/c.ts" },
  { kind: "bash", command: "ls -la" },
  { kind: "glob", pattern: "**/*.ts", path: null },
  { kind: "grep", pattern: "todo", path: "/repo" },
  { kind: "fetch", url: "https://example.com" },
  { kind: "web_search", query: "effect schema" },
  { kind: "skill", name: "atlas", args: null },
  { kind: "task", op: "create", summary: "do a thing" },
  { kind: "ask", question: "which one?" },
  { kind: "plan_mode", op: "exit", plan: "the plan" },
  { kind: "worktree", op: "enter", path: "/repo/.worktrees/x" },
  { kind: "cron", op: "list", summary: null },
  { kind: "monitor", command: "tail -f log" },
  { kind: "lsp", op: "definition", summary: "makeRelativizer" },
  { kind: "mcp_resource", op: "read", uri: "kolu://terminals" },
  { kind: "send_message", to: "agent-2", content: "ping" },
  { kind: "team", op: "delete", summary: "team-7" },
  { kind: "tool_search", query: "select:Read" },
  { kind: "unknown", toolName: "Weird", raw: { a: 1 } },
];

/** One value per `TranscriptEvent` arm, in schema-declaration order. */
const EVENTS: ReadonlyArray<TranscriptEvent> = [
  { kind: "user", text: "hello", ts: 1 },
  { kind: "assistant", text: "hi", model: "claude-opus-5", ts: 2 },
  { kind: "reasoning", text: "thinking", ts: null },
  {
    kind: "tool_call",
    id: "t1",
    toolName: "Bash",
    inputs: { kind: "bash", command: "ls" },
    ts: 3,
  },
  { kind: "tool_result", id: "t1", output: ["a", "b"], isError: false, ts: 4 },
  {
    kind: "subtask_start",
    description: "child run",
    agentName: "explorer",
    sessionId: "s2",
    ts: 5,
  },
  { kind: "subtask_end", ts: 6 },
];

describe("ToolInputSchema", () => {
  it("covers every declared arm exactly once", () => {
    expect(TOOL_INPUTS.map((t) => t.kind)).toEqual([
      "edit",
      "write",
      "patch",
      "read",
      "bash",
      "glob",
      "grep",
      "fetch",
      "web_search",
      "skill",
      "task",
      "ask",
      "plan_mode",
      "worktree",
      "cron",
      "monitor",
      "lsp",
      "mcp_resource",
      "send_message",
      "team",
      "tool_search",
      "unknown",
    ]);
    expect(ToolInputSchema.members.length).toBe(TOOL_INPUTS.length);
  });

  it.each(
    TOOL_INPUTS.map((input) => [input.kind, input] as const),
  )("round-trips the %s arm byte-identically", (_kind, input) => {
    const json = JSON.stringify(encodeToolInput(input));
    expect(json).toBe(JSON.stringify(input));
    expect(decodeToolInput(JSON.parse(json))).toEqual(input);
  });

  it("pins the encoded bytes of the deepest arm", () => {
    expect(
      JSON.stringify(
        encodeToolInput({
          kind: "edit",
          filePath: "/repo/a.ts",
          edits: [
            { oldText: "one", newText: "two" },
            { oldText: "three", newText: "four" },
          ],
        }),
      ),
    ).toBe(
      '{"kind":"edit","filePath":"/repo/a.ts","edits":[{"oldText":"one","newText":"two"},{"oldText":"three","newText":"four"}]}',
    );
  });

  it("rejects an unmodelled kind instead of silently widening", () => {
    const result = toolInputResult({ kind: "telepathy", thought: "x" });
    expect(result._tag).toBe("Failure");
  });

  it("rejects a known kind missing a required field", () => {
    expect(toolInputResult({ kind: "bash" })._tag).toBe("Failure");
  });

  it("keeps `unknown` payloads opaque and unvalidated", () => {
    const nested = {
      kind: "unknown" as const,
      toolName: "Weird",
      raw: { deeply: { nested: [1, "two", null, { three: true }] } },
    };
    expect(JSON.stringify(encodeToolInput(nested))).toBe(
      '{"kind":"unknown","toolName":"Weird","raw":{"deeply":{"nested":[1,"two",null,{"three":true}]}}}',
    );
    expect(decodeToolInput(JSON.parse(JSON.stringify(nested)))).toEqual(nested);
  });
});

describe("TranscriptEventSchema", () => {
  it("covers every declared arm exactly once", () => {
    expect(EVENTS.map((e) => e.kind)).toEqual([
      "user",
      "assistant",
      "reasoning",
      "tool_call",
      "tool_result",
      "subtask_start",
      "subtask_end",
    ]);
    expect(TranscriptEventSchema.members.length).toBe(EVENTS.length);
  });

  it.each(
    EVENTS.map((event) => [event.kind, event] as const),
  )("round-trips the %s arm byte-identically", (_kind, event) => {
    const json = JSON.stringify(encodeEvent(event));
    expect(json).toBe(JSON.stringify(event));
    expect(decodeEvent(JSON.parse(json))).toEqual(event);
  });

  it("pins the encoded bytes of a nested tool_call", () => {
    expect(
      JSON.stringify(
        encodeEvent({
          kind: "tool_call",
          id: null,
          toolName: "Glob",
          inputs: { kind: "glob", pattern: "**/*.ts", path: null },
          ts: null,
        }),
      ),
    ).toBe(
      '{"kind":"tool_call","id":null,"toolName":"Glob","inputs":{"kind":"glob","pattern":"**/*.ts","path":null},"ts":null}',
    );
  });
});

describe("TranscriptSchema", () => {
  const transcript: Transcript = {
    agentKind: "claude-code",
    sessionId: "sess-1",
    title: "A session",
    repoName: "juspay/kolu",
    cwd: "/repo",
    model: "claude-opus-5",
    contextTokens: 1234,
    pr: { number: 42, url: "https://github.com/juspay/kolu/pull/42" },
    exportedAt: 1700000000000,
    events: EVENTS,
  };

  it("pins the encoded document bytes", () => {
    expect(JSON.stringify(encodeTranscript(transcript))).toBe(
      '{"agentKind":"claude-code","sessionId":"sess-1","title":"A session","repoName":"juspay/kolu","cwd":"/repo","model":"claude-opus-5","contextTokens":1234,"pr":{"number":42,"url":"https://github.com/juspay/kolu/pull/42"},"exportedAt":1700000000000,"events":' +
        JSON.stringify(EVENTS) +
        "}",
    );
  });

  it("decodes a document back to the same value", () => {
    const json = JSON.stringify(encodeTranscript(transcript));
    expect(decodeTranscript(JSON.parse(json))).toEqual(transcript);
  });

  it("pins the encoded bytes of an all-nulls header", () => {
    expect(
      JSON.stringify(
        encodeTranscript({
          agentKind: "codex",
          sessionId: "s",
          title: null,
          repoName: null,
          cwd: null,
          model: null,
          contextTokens: null,
          pr: null,
          exportedAt: 0,
          events: [],
        }),
      ),
    ).toBe(
      '{"agentKind":"codex","sessionId":"s","title":null,"repoName":null,"cwd":null,"model":null,"contextTokens":null,"pr":null,"exportedAt":0,"events":[]}',
    );
  });

  it("accepts every agent kind", () => {
    for (const agentKind of AGENT_KINDS) {
      expect(
        decodeTranscript({
          agentKind,
          sessionId: "s",
          title: null,
          repoName: null,
          cwd: null,
          model: null,
          contextTokens: null,
          pr: null,
          exportedAt: 0,
          events: [],
        }).agentKind,
      ).toBe(agentKind);
    }
  });

  it("rejects an unlisted agent kind", () => {
    expect(
      Schema.decodeUnknownResult(TranscriptSchema)({
        agentKind: "cursor",
        sessionId: "s",
        title: null,
        repoName: null,
        cwd: null,
        model: null,
        contextTokens: null,
        pr: null,
        exportedAt: 0,
        events: [],
      })._tag,
    ).toBe("Failure");
  });
});

describe("TranscriptPrSchema", () => {
  it("pins the encoded bytes", () => {
    expect(
      JSON.stringify(
        Schema.encodeSync(TranscriptPrSchema)({
          number: 7,
          url: "https://example.com/pull/7",
        }),
      ),
    ).toBe('{"number":7,"url":"https://example.com/pull/7"}');
  });
});
