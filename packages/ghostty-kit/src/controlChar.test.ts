import { describe, expect, it } from "vitest";
import { controlChar } from "./controlChar.ts";

describe("controlChar", () => {
  it("maps Ctrl+C to ETX so a listener can be interrupted", () => {
    expect(controlChar("c")).toBe("\x03");
    expect(controlChar("C")).toBe("\x03");
  });

  it("leaves non-letter keys alone", () => {
    expect(controlChar("Enter")).toBeNull();
    expect(controlChar("1")).toBeNull();
  });
});
