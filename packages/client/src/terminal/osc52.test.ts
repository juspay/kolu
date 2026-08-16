import { describe, expect, it } from "vitest";
import { decodeOsc52Payload } from "./osc52.ts";

describe("decodeOsc52Payload", () => {
  it("decodes a clipboard write payload", () => {
    expect(decodeOsc52Payload("Zm9v")).toEqual({ kind: "copy", text: "foo" });
  });

  it("decodes UTF-8 yanks, not latin1 mojibake", () => {
    for (const text of ["héllo", "你好"]) {
      const payload = btoa(
        Array.from(new TextEncoder().encode(text), (b) =>
          String.fromCharCode(b),
        ).join(""),
      );
      expect(decodeOsc52Payload(payload)).toEqual({ kind: "copy", text });
    }
  });

  it("recognizes a clipboard query", () => {
    expect(decodeOsc52Payload("?")).toEqual({ kind: "query" });
  });

  it("rejects garbage instead of throwing", () => {
    expect(decodeOsc52Payload("!!!!")).toEqual({ kind: "invalid" });
  });
});
