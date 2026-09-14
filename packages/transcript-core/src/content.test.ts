import { describe, expect, it } from "vitest";
import { contentToText } from "./content.ts";

describe("contentToText", () => {
  it("joins text blocks from array content", () => {
    expect(
      contentToText([
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ]),
    ).toBe("hello\nworld");
  });

  it("returns a bare string content", () => {
    expect(contentToText("plain")).toBe("plain");
  });
});
