/** Wire-format gate for `PiInfoSchema`.
 *
 *  `PiInfo` rides the agent-info wire (padi → client) and is folded into
 *  terminal-vocab's `AgentInfoSchema` union on the `kind` discriminant, so
 *  both directions are pinned here at the BYTE level rather than by
 *  decode-equality: the encoded JSON string (field order included) and the
 *  tolerances a rolling deploy leans on. Mirrors grok's gate. */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { type PiInfo, PiInfoSchema, piSteerHeld } from "./schemas.ts";

const encode = Schema.encodeSync(PiInfoSchema);
const decode = Schema.decodeUnknownSync(PiInfoSchema);

const populated: PiInfo = {
  kind: "pi",
  state: "tool_use",
  sessionId: "01a0302a-b94b-7b18-a3c3-b3f83dfe6fe8",
  sessionPath:
    "/home/u/.pi/agent/sessions/--home-u-code--/2026-08-24T00-00-00-000Z_01a0302a-b94b-7b18-a3c3-b3f83dfe6fe8.jsonl",
  model: "claude-sonnet-4-5",
  summary: "CI audit",
  taskProgress: null,
  contextTokens: 128313,
  startedAt: 1787509701451,
  lastPromptId: "f674c007",
};

const empty: PiInfo = {
  kind: "pi",
  state: "waiting",
  sessionId: "01a0302a-b94b-7b18-a3c3-b3f83dfe6fe8",
  sessionPath:
    "/home/u/.pi/agent/sessions/--home-u-code--/2026-08-24T00-00-00-000Z_01a0302a-b94b-7b18-a3c3-b3f83dfe6fe8.jsonl",
  model: null,
  summary: null,
  taskProgress: null,
  contextTokens: null,
  startedAt: null,
  lastPromptId: null,
};

describe("PiInfoSchema encoded bytes", () => {
  it("encodes a fully-populated info to the exact JSON string", () => {
    expect(JSON.stringify(encode(populated))).toBe(
      '{"kind":"pi","state":"tool_use","sessionId":"01a0302a-b94b-7b18-a3c3-b3f83dfe6fe8","sessionPath":"/home/u/.pi/agent/sessions/--home-u-code--/2026-08-24T00-00-00-000Z_01a0302a-b94b-7b18-a3c3-b3f83dfe6fe8.jsonl","model":"claude-sonnet-4-5","summary":"CI audit","taskProgress":null,"contextTokens":128313,"startedAt":1787509701451,"lastPromptId":"f674c007"}',
    );
  });

  it("encodes the all-null (fresh session) info with every key present as null", () => {
    expect(JSON.stringify(encode(empty))).toBe(
      '{"kind":"pi","state":"waiting","sessionId":"01a0302a-b94b-7b18-a3c3-b3f83dfe6fe8","sessionPath":"/home/u/.pi/agent/sessions/--home-u-code--/2026-08-24T00-00-00-000Z_01a0302a-b94b-7b18-a3c3-b3f83dfe6fe8.jsonl","model":null,"summary":null,"taskProgress":null,"contextTokens":null,"startedAt":null,"lastPromptId":null}',
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
          '{"kind":"pi","state":"thinking","sessionId":"abc","sessionPath":"/w/x.jsonl","model":"kimi-k3","summary":null,"taskProgress":null,"contextTokens":12,"startedAt":null,"lastPromptId":"u1"}',
        ),
      ),
    ).toEqual({
      kind: "pi",
      state: "thinking",
      sessionId: "abc",
      sessionPath: "/w/x.jsonl",
      model: "kimi-k3",
      summary: null,
      taskProgress: null,
      contextTokens: 12,
      startedAt: null,
      lastPromptId: "u1",
    });
  });
});

describe("piSteerHeld", () => {
  /** The steering pane as pi 1.5.2 drew it in an 80-column kolu terminal on
   *  2026-11-15, while a `bash` call held a steer. */
  const HELD = [
    " Elapsed 18.0s                                                                  ",
    "",
    " Steering: PI-STEER-ONE                                                         ",
    " ↳ Alt+Up to edit all queued messages                                           ",
    "",
    "── ⠦ Working ───────────────────────────────────────────────────────────────────",
  ].join("\n");

  it("finds its own line in the pane, and only its own", () => {
    expect(piSteerHeld(HELD, "PI-STEER-ONE")).toBe(true);
    expect(piSteerHeld(HELD, "something else")).toBe(false);
  });
});
