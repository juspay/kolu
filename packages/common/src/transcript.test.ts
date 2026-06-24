import { describe, expect, it } from "vitest";
import { ExportTranscriptHtmlInputSchema } from "./transcript.ts";

const id = "123e4567-e89b-12d3-a456-426614174000";

describe("ExportTranscriptHtmlInputSchema", () => {
  it("requires an explicit export mode", () => {
    expect(ExportTranscriptHtmlInputSchema.parse({ id, mode: "chat" })).toEqual(
      {
        id,
        mode: "chat",
      },
    );
    expect(ExportTranscriptHtmlInputSchema.parse({ id, mode: "full" })).toEqual(
      {
        id,
        mode: "full",
      },
    );
    expect(() => ExportTranscriptHtmlInputSchema.parse({ id })).toThrow();
  });
});
