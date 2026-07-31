/** Unit coverage for the two parent-edge guards that any tree model needs:
 *  no self-parent, no cycle. Nested depth is allowed (#2059). */

import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getTerminal = vi.fn();

vi.mock("./terminal-registry.ts", () => ({
  getTerminal: (id: string) => getTerminal(id),
  terminalEntries: () => [][Symbol.iterator](),
}));

// Side-effect imports the rest of the module graph; only requireAcyclicParent
// is under test here.
import { requireAcyclicParent } from "./terminals.ts";

const T = (s: string) => s as import("@kolu/terminal-vocab/schema").TerminalId;

describe("requireAcyclicParent", () => {
  beforeEach(() => {
    getTerminal.mockReset();
  });

  it("refuses self-parent", () => {
    expect(() => requireAcyclicParent(T("A"), T("A"))).toThrow(ORPCError);
    expect(() => requireAcyclicParent(T("A"), T("A"))).toThrow(
      /cannot be its own parent/,
    );
  });

  it("allows a nested parent (depth is not limited)", () => {
    // R ← M; attaching G under M is fine.
    getTerminal.mockImplementation((id: string) => {
      if (id === "M") return { meta: { parentId: "R" } };
      if (id === "R") return { meta: { parentId: undefined } };
      return undefined;
    });
    expect(() => requireAcyclicParent(T("G"), T("M"))).not.toThrow();
  });

  it("refuses an edge that would close a cycle", () => {
    // R ← M ← G; reparenting R under G would cycle.
    getTerminal.mockImplementation((id: string) => {
      if (id === "G") return { meta: { parentId: "M" } };
      if (id === "M") return { meta: { parentId: "R" } };
      if (id === "R") return { meta: { parentId: undefined } };
      return undefined;
    });
    expect(() => requireAcyclicParent(T("R"), T("G"))).toThrow(/would cycle/);
  });
});
