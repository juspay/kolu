import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { type PiInfo, PiInfoSchema, piSteerPane } from "./schemas.ts";

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
  lastPromptText: "audit the CI lanes",
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
  lastPromptText: null,
};

describe("PiInfoSchema encoded bytes", () => {
  it("encodes a fully-populated info to the exact JSON string", () => {
    expect(JSON.stringify(encode(populated))).toBe(
      '{"kind":"pi","state":"tool_use","sessionId":"01a0302a-b94b-7b18-a3c3-b3f83dfe6fe8","sessionPath":"/home/u/.pi/agent/sessions/--home-u-code--/2026-08-24T00-00-00-000Z_01a0302a-b94b-7b18-a3c3-b3f83dfe6fe8.jsonl","model":"claude-sonnet-4-5","summary":"CI audit","taskProgress":null,"contextTokens":128313,"startedAt":1787509701451,"lastPromptId":"f674c007","lastPromptText":"audit the CI lanes"}',
    );
  });

  it("encodes the all-null (fresh session) info with every key present as null", () => {
    expect(JSON.stringify(encode(empty))).toBe(
      '{"kind":"pi","state":"waiting","sessionId":"01a0302a-b94b-7b18-a3c3-b3f83dfe6fe8","sessionPath":"/home/u/.pi/agent/sessions/--home-u-code--/2026-08-24T00-00-00-000Z_01a0302a-b94b-7b18-a3c3-b3f83dfe6fe8.jsonl","model":null,"summary":null,"taskProgress":null,"contextTokens":null,"startedAt":null,"lastPromptId":null,"lastPromptText":null}',
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
          '{"kind":"pi","state":"thinking","sessionId":"abc","sessionPath":"/w/x.jsonl","model":"kimi-k3","summary":null,"taskProgress":null,"contextTokens":12,"startedAt":null,"lastPromptId":"u1","lastPromptText":"take the second branch"}',
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
      lastPromptText: "take the second branch",
    });
  });
});

describe("piSteerPane", () => {
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
    expect(piSteerPane(HELD, "PI-STEER-ONE")).toEqual({ kind: "holds" });
    expect(piSteerPane(HELD, "something else")).toEqual({ kind: "absent" });
    expect(piSteerPane(HELD, "PI-STEER-ONE and also run the tests")).toEqual({
      kind: "absent",
    });
  });

  it("an open pane whose rows kolu cannot read is UNREADABLE, never absent", () => {
    const unparsed = [
      " Steering → PI-STEER-ONE (a label a later pi draws differently)",
      " ↳ Alt+Up to edit all queued messages",
    ].join("\n");
    expect(piSteerPane(unparsed, "PI-STEER-ONE").kind).toBe("unreadable");
  });

  it("no pane at all is absent", () => {
    expect(piSteerPane("── ⠦ Working ──\n", "PI-STEER-ONE")).toEqual({
      kind: "absent",
    });
  });
});
