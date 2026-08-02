import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { type CodexInfo, CodexInfoSchema } from "./schemas.ts";

/** `CodexInfo` rides the surface wire (agent info on a terminal snapshot), so
 *  the ENCODED JSON — key set, key order, value shapes — is a contract with
 *  every client build that may be older or newer than the server emitting it.
 *  These fixtures pin the bytes, not just decode-equality. */
describe("CodexInfoSchema wire bytes", () => {
  const encode = Schema.encodeSync(CodexInfoSchema);
  const decode = Schema.decodeUnknownSync(CodexInfoSchema);

  const nullFields: CodexInfo = {
    kind: "codex",
    state: "thinking",
    sessionId: "019db605-0000-7000-8000-000000000000",
    model: null,
    summary: null,
    taskProgress: null,
    contextTokens: null,
    startedAt: null,
  };

  const populated: CodexInfo = {
    kind: "codex",
    state: "awaiting_user",
    sessionId: "019db605-0000-7000-8000-000000000000",
    model: "gpt-5.4",
    summary: "Fix the WAL watcher",
    taskProgress: { total: 3, completed: 1 },
    contextTokens: 12_345,
    startedAt: 1_767_225_600_000,
  };

  it("encodes a brand-new thread byte-for-byte", () => {
    expect(JSON.stringify(encode(nullFields))).toBe(
      '{"kind":"codex","state":"thinking","sessionId":"019db605-0000-7000-8000-000000000000","model":null,"summary":null,"taskProgress":null,"contextTokens":null,"startedAt":null}',
    );
  });

  it("encodes a fully-populated thread byte-for-byte", () => {
    expect(JSON.stringify(encode(populated))).toBe(
      '{"kind":"codex","state":"awaiting_user","sessionId":"019db605-0000-7000-8000-000000000000","model":"gpt-5.4","summary":"Fix the WAL watcher","taskProgress":{"total":3,"completed":1},"contextTokens":12345,"startedAt":1767225600000}',
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
    ] as const) {
      expect(decode({ ...nullFields, state }).state).toBe(state);
    }
  });

  it("rejects an unknown state and a missing required key", () => {
    const attempt = Schema.decodeUnknownResult(CodexInfoSchema);
    expect(
      Result.isFailure(attempt({ ...nullFields, state: "compacting" })),
    ).toBe(true);
    const { startedAt: _dropped, ...missingKey } = nullFields;
    expect(Result.isFailure(attempt(missingKey))).toBe(true);
  });
});
