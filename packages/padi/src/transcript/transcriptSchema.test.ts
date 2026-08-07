import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ExportTranscriptHtmlInputSchema } from "./transcriptSchema.ts";

const id = "123e4567-e89b-12d3-a456-426614174000";
const decode = Schema.decodeUnknownSync(ExportTranscriptHtmlInputSchema);
const encode = Schema.encodeUnknownSync(ExportTranscriptHtmlInputSchema);

describe("ExportTranscriptHtmlInputSchema", () => {
  it("requires an explicit export mode", () => {
    expect(decode({ id, mode: "chat" })).toEqual({ id, mode: "chat" });
    expect(decode({ id, mode: "full" })).toEqual({ id, mode: "full" });
    expect(() => decode({ id })).toThrow();
  });

  it("refuses an id that is not a UUID", () => {
    expect(() => decode({ id: "not-a-uuid", mode: "chat" })).toThrow();
  });

  it("BYTES: the wire form is the two keys in declaration order", () => {
    expect(JSON.stringify(encode(decode({ id, mode: "full" })))).toBe(
      `{"id":"${id}","mode":"full"}`,
    );
  });
});
