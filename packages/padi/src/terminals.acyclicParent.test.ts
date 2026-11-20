import { TerminalParentCycle } from "@kolu/padi-client/surface";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getTerminal = vi.fn();

vi.mock("./terminal-registry.ts", () => ({
  getTerminal: (id: string) => getTerminal(id),
  terminalEntries: () => [][Symbol.iterator](),
}));

import { requireAcyclicParent } from "./terminals.ts";

const T = (s: string) => s as import("@kolu/terminal-vocab/schema").TerminalId;

describe("requireAcyclicParent", () => {
  beforeEach(() => {
    getTerminal.mockReset();
  });

  it("refuses self-parent with the DECLARED tagged error", () => {
    expect(() => requireAcyclicParent(T("A"), T("A"))).toThrow(
      TerminalParentCycle,
    );
    expect(() => requireAcyclicParent(T("A"), T("A"))).toThrow(
      /cannot be its own parent/,
    );
  });

  it("the refusal carries the two ids and its reason as DATA, not prose", () => {
    let raised: unknown;
    try {
      requireAcyclicParent(T("A"), T("A"));
    } catch (err) {
      raised = err;
    }
    expect(raised).toBeInstanceOf(TerminalParentCycle);
    const e = raised as TerminalParentCycle;
    expect(e._tag).toBe("TerminalParentCycle");
    expect({
      childId: e.childId,
      parentId: e.parentId,
      reason: e.reason,
    }).toEqual({ childId: "A", parentId: "A", reason: "self" });
  });

  it("allows a nested parent (depth is not limited)", () => {
    getTerminal.mockImplementation((id: string) => {
      if (id === "M") return { meta: { parentId: "R" } };
      if (id === "R") return { meta: { parentId: undefined } };
      return undefined;
    });
    expect(() => requireAcyclicParent(T("G"), T("M"))).not.toThrow();
  });

  it("refuses an edge that would close a cycle", () => {
    getTerminal.mockImplementation((id: string) => {
      if (id === "G") return { meta: { parentId: "M" } };
      if (id === "M") return { meta: { parentId: "R" } };
      if (id === "R") return { meta: { parentId: undefined } };
      return undefined;
    });
    expect(() => requireAcyclicParent(T("R"), T("G"))).toThrow(/would cycle/);
  });
});
