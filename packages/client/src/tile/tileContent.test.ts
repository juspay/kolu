import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { terminalContent, terminalIdOf } from "./tileContent";

const tid = (x: string) => x as TerminalId;

describe("terminalContent", () => {
  it("builds the terminal content variant for a terminal id", () => {
    expect(terminalContent(tid("abc"))).toEqual({
      kind: "terminal",
      terminalId: "abc",
    });
  });
});

describe("terminalIdOf", () => {
  it("narrows a terminal tile's content to its terminal id", () => {
    expect(terminalIdOf(terminalContent(tid("abc")))).toBe("abc");
  });

  it("is null for an absent content (the reachable arm once sleeping lands)", () => {
    expect(terminalIdOf(undefined)).toBeNull();
  });
});
