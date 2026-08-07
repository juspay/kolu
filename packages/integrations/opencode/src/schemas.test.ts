/** Byte-level wire contract for `OpenCodeInfoSchema`.
 *
 *  `OpenCodeInfo` rides the surface wire to the client (agent info on a
 *  terminal). The encoded JSON — key ORDER included — is the contract, so
 *  these tests assert the exact `JSON.stringify` output rather than mere
 *  decode-equality, and pin the decode direction for the payloads a peer
 *  actually emits. */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { type OpenCodeInfo, OpenCodeInfoSchema } from "./schemas.ts";

const encode = Schema.encodeSync(OpenCodeInfoSchema);
const decode = Schema.decodeUnknownSync(OpenCodeInfoSchema);

describe("OpenCodeInfoSchema — encoded bytes", () => {
  it("encodes a fully-populated record to the exact wire JSON", () => {
    const info: OpenCodeInfo = {
      kind: "opencode",
      state: "tool_use",
      sessionId: "ses_01H8XYZ",
      model: "litellm/glm-latest",
      summary: "Refactor the WAL watcher",
      taskProgress: { total: 5, completed: 2 },
      contextTokens: 41_233,
      startedAt: 1_750_000_000_000,
    };

    expect(JSON.stringify(encode(info))).toBe(
      '{"kind":"opencode","state":"tool_use","sessionId":"ses_01H8XYZ",' +
        '"model":"litellm/glm-latest","summary":"Refactor the WAL watcher",' +
        '"taskProgress":{"total":5,"completed":2},"contextTokens":41233,' +
        '"startedAt":1750000000000}',
    );
  });

  it("encodes the all-null (fresh session) record with explicit nulls, not absent keys", () => {
    const info: OpenCodeInfo = {
      kind: "opencode",
      state: "waiting",
      sessionId: "ses_new",
      model: null,
      summary: null,
      taskProgress: null,
      contextTokens: null,
      startedAt: null,
    };

    expect(JSON.stringify(encode(info))).toBe(
      '{"kind":"opencode","state":"waiting","sessionId":"ses_new",' +
        '"model":null,"summary":null,"taskProgress":null,' +
        '"contextTokens":null,"startedAt":null}',
    );
  });
});

describe("OpenCodeInfoSchema — decode", () => {
  it("round-trips every state literal", () => {
    for (const state of [
      "thinking",
      "tool_use",
      "waiting",
      "awaiting_user",
    ] as const) {
      const wire = {
        kind: "opencode",
        state,
        sessionId: "ses_x",
        model: null,
        summary: null,
        taskProgress: null,
        contextTokens: null,
        startedAt: null,
      };
      expect(encode(decode(wire))).toEqual(wire);
    }
  });

  it("rejects an unknown state literal", () => {
    expect(() =>
      decode({
        kind: "opencode",
        state: "compacting",
        sessionId: "ses_x",
        model: null,
        summary: null,
        taskProgress: null,
        contextTokens: null,
        startedAt: null,
      }),
    ).toThrow();
  });

  it("rejects a record missing a nullable key — null is required, absence is not", () => {
    expect(() =>
      decode({
        kind: "opencode",
        state: "waiting",
        sessionId: "ses_x",
        model: null,
        summary: null,
        taskProgress: null,
        contextTokens: null,
        // startedAt absent
      }),
    ).toThrow();
  });
});
