import { describe, expect, it } from "vitest";
import { decodeOsc52Payload } from "./osc52.ts";

describe("decodeOsc52Payload", () => {
  it("decodes a clipboard write payload", () => {
    expect(decodeOsc52Payload("Zm9v")).toEqual({ kind: "copy", text: "foo" });
  });

  it("recognizes a clipboard query", () => {
    expect(decodeOsc52Payload("?")).toEqual({ kind: "query" });
  });

  it("rejects garbage instead of throwing", () => {
    expect(decodeOsc52Payload("!!!!")).toEqual({ kind: "invalid" });
  });
});
