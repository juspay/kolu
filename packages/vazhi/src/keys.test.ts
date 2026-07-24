import { describe, expect, it } from "vitest";
import { splitKeys } from "./keys.ts";

describe("splitKeys", () => {
  it("keeps an arrow key whole", () => {
    expect(splitKeys("\x1b[A")).toEqual(["\x1b[A"]);
    expect(splitKeys("\x1b[B")).toEqual(["\x1b[B"]);
  });

  it("splits a burst of typing into single keys", () => {
    expect(splitKeys("pu-")).toEqual(["p", "u", "-"]);
  });

  it("separates an escape sequence from the keys around it", () => {
    expect(splitKeys("a\x1b[Bx")).toEqual(["a", "\x1b[B", "x"]);
  });

  it("keeps a parameterised sequence whole", () => {
    // Shift+arrow and friends carry parameters before the final byte.
    expect(splitKeys("\x1b[1;5A")).toEqual(["\x1b[1;5A"]);
  });

  it("passes a lone escape through — that is the esc key", () => {
    expect(splitKeys("\x1b")).toEqual(["\x1b"]);
  });

  it("passes control characters through as themselves", () => {
    expect(splitKeys("\x03")).toEqual(["\x03"]);
    expect(splitKeys("\r")).toEqual(["\r"]);
    expect(splitKeys("\x7f")).toEqual(["\x7f"]);
  });

  it("does not lose bytes from an unterminated sequence", () => {
    expect(splitKeys("\x1b[1").join("")).toBe("\x1b[1");
  });
});
