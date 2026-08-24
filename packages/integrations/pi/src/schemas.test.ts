/** Wire-format gate for `PiInfoSchema`.
 *
 *  `PiInfo` rides the agent-info wire (padi → client) and is folded into
 *  terminal-vocab's `AgentInfoSchema` union on the `kind` discriminant, so
 *  both directions are pinned here at the BYTE level rather than by
 *  decode-equality: the encoded JSON string (field order included) and the
 *  tolerances a rolling deploy leans on. Mirrors grok's gate. */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { type PiInfo, PiInfoSchema } from "./schemas.ts";

const encode = Schema.encodeSync(PiInfoSchema);
const decode = Schema.decodeUnknownSync(PiInfoSchema);

const populated: PiInfo = {
  kind: "pi",
  state: "tool_use",
  sessionId: "01a0302a-b94b-7b18-a3c3-b3f83dfe6fe8",
  model: "claude-sonnet-4-5",
  summary: "CI audit",
  taskProgress: null,
  contextTokens: 128313,
  startedAt: 1787509701451,
};

const empty: PiInfo = {
  kind: "pi",
  state: "waiting",
  sessionId: "01a0302a-b94b-7b18-a3c3-b3f83dfe6fe8",
  model: null,
  summary: null,
  taskProgress: null,
  contextTokens: null,
  startedAt: null,
};

describe("PiInfoSchema encoded bytes", () => {
  it("encodes a fully-populated info to the exact JSON string", () => {
    expect(JSON.stringify(encode(populated))).toBe(
      '{"kind":"pi","state":"tool_use","sessionId":"01a0302a-b94b-7b18-a3c3-b3f83dfe6fe8","model":"claude-sonnet-4-5","summary":"CI audit","taskProgress":null,"contextTokens":128313,"startedAt":1787509701451}',
    );
  });

  it("encodes the all-null (fresh session) info with every key present as null", () => {
    expect(JSON.stringify(encode(empty))).toBe(
      '{"kind":"pi","state":"waiting","sessionId":"01a0302a-b94b-7b18-a3c3-b3f83dfe6fe8","model":null,"summary":null,"taskProgress":null,"contextTokens":null,"startedAt":null}',
    );
  });

  it("round-trips every state literal through encode → decode", () => {
    for (const state of ["thinking", "tool_use", "waiting"] as const) {
      expect(
        decode(JSON.parse(JSON.stringify(encode({ ...empty, state })))),
      ).toEqual({ ...empty, state });
    }
  });
});

describe("PiInfoSchema decoding", () => {
  it("decodes a wire payload byte-for-byte", () => {
    expect(
      decode(
        JSON.parse(
          '{"kind":"pi","state":"thinking","sessionId":"abc","model":"kimi-k3","summary":null,"taskProgress":null,"contextTokens":12,"startedAt":null}',
        ),
      ),
    ).toEqual({
      kind: "pi",
      state: "thinking",
      sessionId: "abc",
      model: "kimi-k3",
      summary: null,
      taskProgress: null,
      contextTokens: 12,
      startedAt: null,
    });
  });
});
