/** Wire-format gate for `OmpInfoSchema`.
 *
 *  `OmpInfo` rides the agent-info wire (padi → client) and is folded into
 *  terminal-vocab's `AgentInfoSchema` union on the `kind` discriminant, so both
 *  directions are pinned here at the BYTE level rather than by
 *  decode-equality: the encoded JSON string (field order included) and the
 *  tolerances a rolling deploy leans on. Mirrors pi's gate. */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { type OmpInfo, OmpInfoSchema } from "./schemas.ts";

const encode = Schema.encodeSync(OmpInfoSchema);
const decode = Schema.decodeUnknownSync(OmpInfoSchema);

const SESSION_PATH =
  "/home/u/.omp/agent/sessions/-code-proj/2026-09-14T17-07-12-579Z_01a0a0e3-1843-701b-bfde-c9c816e3e92f.jsonl";

const populated: OmpInfo = {
  kind: "omp",
  state: "awaiting_user",
  sessionId: "01a0a0e3-1843-701b-bfde-c9c816e3e92f",
  sessionPath: SESSION_PATH,
  model: "deepseek-v4.1-flash",
  summary: "Run echo hello bash command",
  taskProgress: null,
  contextTokens: 30676,
  startedAt: 1787509701451,
};

const empty: OmpInfo = {
  kind: "omp",
  state: "waiting",
  sessionId: "01a0a0e3-1843-701b-bfde-c9c816e3e92f",
  sessionPath: SESSION_PATH,
  model: null,
  summary: null,
  taskProgress: null,
  contextTokens: null,
  startedAt: null,
};

describe("OmpInfoSchema encoded bytes", () => {
  it("encodes a fully-populated info to the exact JSON string", () => {
    expect(JSON.stringify(encode(populated))).toBe(
      '{"kind":"omp","state":"awaiting_user","sessionId":"01a0a0e3-1843-701b-bfde-c9c816e3e92f","sessionPath":"/home/u/.omp/agent/sessions/-code-proj/2026-09-14T17-07-12-579Z_01a0a0e3-1843-701b-bfde-c9c816e3e92f.jsonl","model":"deepseek-v4.1-flash","summary":"Run echo hello bash command","taskProgress":null,"contextTokens":30676,"startedAt":1787509701451}',
    );
  });

  it("encodes the all-null (untitled, pre-turn) info with every key present", () => {
    expect(JSON.stringify(encode(empty))).toBe(
      '{"kind":"omp","state":"waiting","sessionId":"01a0a0e3-1843-701b-bfde-c9c816e3e92f","sessionPath":"/home/u/.omp/agent/sessions/-code-proj/2026-09-14T17-07-12-579Z_01a0a0e3-1843-701b-bfde-c9c816e3e92f.jsonl","model":null,"summary":null,"taskProgress":null,"contextTokens":null,"startedAt":null}',
    );
  });

  it("round-trips every state literal through encode → decode", () => {
    for (const state of [
      "thinking",
      "tool_use",
      "awaiting_user",
      "waiting",
    ] as const) {
      expect(
        decode(JSON.parse(JSON.stringify(encode({ ...empty, state })))),
      ).toEqual({ ...empty, state });
    }
  });
});

describe("OmpInfoSchema decoding", () => {
  it("decodes a wire payload byte-for-byte", () => {
    expect(
      decode(
        JSON.parse(
          '{"kind":"omp","state":"tool_use","sessionId":"abc","sessionPath":"/w/x.jsonl","model":"kimi-k3","summary":"CI audit","taskProgress":null,"contextTokens":12,"startedAt":null}',
        ),
      ),
    ).toEqual({
      kind: "omp",
      state: "tool_use",
      sessionId: "abc",
      sessionPath: "/w/x.jsonl",
      model: "kimi-k3",
      summary: "CI audit",
      taskProgress: null,
      contextTokens: 12,
      startedAt: null,
    });
  });

  it("refuses a payload with no session path — the breadcrumb always has one", () => {
    expect(() =>
      decode(
        JSON.parse(
          '{"kind":"omp","state":"tool_use","sessionId":"abc","model":null,"summary":null,"taskProgress":null,"contextTokens":null,"startedAt":null}',
        ),
      ),
    ).toThrow();
  });
});
