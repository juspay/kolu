import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  type ClaudeCodeInfo,
  ClaudeCodeInfoSchema,
  ClaudeWorkflowSchema,
} from "./schemas.ts";

/** `ClaudeCodeInfo` rides the surface wire (agent info on a terminal snapshot,
 *  which is also persisted), so the ENCODED JSON — key set, key order, value
 *  shapes — is a contract with every client build that may be older or newer
 *  than the server emitting it. These fixtures pin the bytes, not just
 *  decode-equality. */
describe("ClaudeCodeInfoSchema wire bytes", () => {
  const encode = Schema.encodeSync(ClaudeCodeInfoSchema);
  const decode = Schema.decodeUnknownSync(ClaudeCodeInfoSchema);

  const nullFields: ClaudeCodeInfo = {
    kind: "claude-code",
    state: "thinking",
    sessionId: "019db605-0000-7000-8000-000000000000",
    model: null,
    summary: null,
    taskProgress: null,
    workflow: null,
    contextTokens: null,
    startedAt: null,
  };

  const populated: ClaudeCodeInfo = {
    kind: "claude-code",
    state: "running_background",
    sessionId: "019db605-0000-7000-8000-000000000000",
    model: "claude-opus-4-6",
    summary: "Fix the session watcher",
    taskProgress: { total: 4, completed: 2 },
    workflow: { name: "deep-research", status: "running", agents: 12 },
    contextTokens: 47_000,
    startedAt: 1_767_225_600_000,
  };

  it("encodes a brand-new session byte-for-byte", () => {
    expect(JSON.stringify(encode(nullFields))).toBe(
      '{"kind":"claude-code","state":"thinking","sessionId":"019db605-0000-7000-8000-000000000000","model":null,"summary":null,"taskProgress":null,"workflow":null,"contextTokens":null,"startedAt":null}',
    );
  });

  it("encodes a fully-populated session byte-for-byte", () => {
    expect(JSON.stringify(encode(populated))).toBe(
      '{"kind":"claude-code","state":"running_background","sessionId":"019db605-0000-7000-8000-000000000000","model":"claude-opus-4-6","summary":"Fix the session watcher","taskProgress":{"total":4,"completed":2},"workflow":{"name":"deep-research","status":"running","agents":12},"contextTokens":47000,"startedAt":1767225600000}',
    );
  });

  it("round-trips every wire fixture through decode", () => {
    for (const info of [nullFields, populated]) {
      expect(decode(JSON.parse(JSON.stringify(encode(info))))).toEqual(info);
    }
  });

  it("accepts every state literal", () => {
    for (const state of [
      "thinking",
      "tool_use",
      "waiting",
      "awaiting_user",
      "running_background",
    ] as const) {
      expect(decode({ ...nullFields, state }).state).toBe(state);
    }
  });

  it("rejects an unknown state and a missing required key", () => {
    const attempt = Schema.decodeUnknownResult(ClaudeCodeInfoSchema);
    expect(
      Result.isFailure(attempt({ ...nullFields, state: "compacting" })),
    ).toBe(true);
    const { workflow: _dropped, ...missingKey } = nullFields;
    expect(Result.isFailure(attempt(missingKey))).toBe(true);
  });
});

/** `ClaudeWorkflow` is the fan-out snapshot embedded in `ClaudeCodeInfo`, and
 *  the target of the workflow-journal decode in `core.ts`. Its own bytes are
 *  pinned here so a field rename cannot slip through the embedding above. */
describe("ClaudeWorkflowSchema wire bytes", () => {
  it("encodes byte-for-byte", () => {
    expect(
      JSON.stringify(
        Schema.encodeSync(ClaudeWorkflowSchema)({
          name: "deep-research",
          status: "completed",
          agents: 3,
        }),
      ),
    ).toBe('{"name":"deep-research","status":"completed","agents":3}');
  });
});
