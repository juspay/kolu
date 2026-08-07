/** Wire-format gate for `GrokInfoSchema`.
 *
 *  `GrokInfo` rides the agent-info wire (server → client) and is folded into
 *  kolu-common's `AgentInfoSchema` union on the `kind` discriminant, so both
 *  directions are pinned here at the BYTE level rather than by
 *  decode-equality: the encoded JSON string (field order included) and the
 *  tolerances a rolling deploy leans on (a newer server's extra key must not
 *  break an older client's decode). */

import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { type GrokInfo, GrokInfoSchema } from "./schemas.ts";

const encode = Schema.encodeSync(GrokInfoSchema);
const decode = Schema.decodeUnknownSync(GrokInfoSchema);
const decodeResult = Schema.decodeUnknownResult(GrokInfoSchema);

const populated: GrokInfo = {
  kind: "grok",
  state: "tool_use",
  sessionId: "0199f0b1-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
  model: "grok-4.5",
  summary: "Wire up the inspector",
  taskProgress: { total: 7, completed: 3 },
  contextTokens: 48213,
  startedAt: 1754006400000,
};

const empty: GrokInfo = {
  kind: "grok",
  state: "waiting",
  sessionId: "0199f0b1-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
  model: null,
  summary: null,
  taskProgress: null,
  contextTokens: null,
  startedAt: null,
};

describe("GrokInfoSchema encoded bytes", () => {
  it("encodes a fully-populated info to the exact legacy JSON string", () => {
    expect(JSON.stringify(encode(populated))).toBe(
      '{"kind":"grok","state":"tool_use","sessionId":"0199f0b1-2c3d-4e5f-8a9b-0c1d2e3f4a5b","model":"grok-4.5","summary":"Wire up the inspector","taskProgress":{"total":7,"completed":3},"contextTokens":48213,"startedAt":1754006400000}',
    );
  });

  it("encodes the all-null (fresh session) info with every key present as null", () => {
    expect(JSON.stringify(encode(empty))).toBe(
      '{"kind":"grok","state":"waiting","sessionId":"0199f0b1-2c3d-4e5f-8a9b-0c1d2e3f4a5b","model":null,"summary":null,"taskProgress":null,"contextTokens":null,"startedAt":null}',
    );
  });

  it("round-trips every state literal through encode → decode", () => {
    for (const state of [
      "thinking",
      "tool_use",
      "waiting",
      "awaiting_user",
    ] as const) {
      expect(
        decode(JSON.parse(JSON.stringify(encode({ ...empty, state })))),
      ).toEqual({
        ...empty,
        state,
      });
    }
  });
});

describe("GrokInfoSchema decoding", () => {
  it("decodes a legacy payload byte-for-byte off the wire", () => {
    expect(
      decode(
        JSON.parse(
          '{"kind":"grok","state":"awaiting_user","sessionId":"abc","model":null,"summary":"Ask","taskProgress":null,"contextTokens":12,"startedAt":null}',
        ),
      ),
    ).toEqual({
      kind: "grok",
      state: "awaiting_user",
      sessionId: "abc",
      model: null,
      summary: "Ask",
      taskProgress: null,
      contextTokens: 12,
      startedAt: null,
    });
  });

  it("tolerates an unknown key a NEWER server added (rolling deploy), dropping it", () => {
    expect(decode({ ...empty, futureField: "surprise" })).toEqual(empty);
  });

  it("rejects a missing field rather than defaulting it", () => {
    const { contextTokens: _dropped, ...missing } = empty;
    expect(Result.isFailure(decodeResult(missing))).toBe(true);
  });

  it("rejects an unknown state literal", () => {
    expect(Result.isFailure(decodeResult({ ...empty, state: "napping" }))).toBe(
      true,
    );
  });

  it("rejects a wrong discriminant", () => {
    expect(Result.isFailure(decodeResult({ ...empty, kind: "codex" }))).toBe(
      true,
    );
  });
});
