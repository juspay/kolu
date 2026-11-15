import { describe, expect, it } from "vitest";
import { isReadingReport } from "./readingReports.ts";

describe("isReadingReport", () => {
  it("passes focus in and focus out", () => {
    expect(isReadingReport("\x1b[I")).toBe(true);
    expect(isReadingReport("\x1b[O")).toBe(true);
  });

  it("passes SGR wheel up and down, with modifiers", () => {
    expect(isReadingReport("\x1b[<64;10;5M")).toBe(true);
    expect(isReadingReport("\x1b[<65;10;5M")).toBe(true);
    // ctrl (16) + wheel down
    expect(isReadingReport("\x1b[<81;3;9M")).toBe(true);
  });

  it("blocks clicks, drags and the extra buttons", () => {
    expect(isReadingReport("\x1b[<0;10;5M")).toBe(false);
    expect(isReadingReport("\x1b[<0;10;5m")).toBe(false);
    expect(isReadingReport("\x1b[<32;11;5M")).toBe(false);
    expect(isReadingReport("\x1b[<128;10;5M")).toBe(false);
  });

  it("blocks typing, including keys that look like a report's tail", () => {
    expect(isReadingReport("I")).toBe(false);
    expect(isReadingReport("\x1b[A")).toBe(false);
    expect(isReadingReport("hello\x1b[I")).toBe(false);
  });
});
