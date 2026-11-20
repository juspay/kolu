import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { frame } from "./attentionFixture.testlib.ts";
import { createEdgeMemory } from "./edgeMemory.ts";

describe("createEdgeMemory", () => {
  it("projects a live terminal's attribution, omitting what it has none of", () => {
    const edges = createEdgeMemory();
    edges.observe(frame({ a: { parentId: "boss", intent: "review" }, b: {} }));
    expect(edges.edgeOf("a" as TerminalId)).toEqual({
      parentId: "boss",
      intent: "review",
    });
    expect(edges.edgeOf("b" as TerminalId)).toEqual({});
  });

  it("keeps a DEPARTED terminal's edge for the frame that reports it, and drops it after", () => {
    const edges = createEdgeMemory();
    edges.observe(frame({ a: { parentId: "boss" }, anchor: {} }));
    edges.observe(frame({ anchor: {} }));
    expect([...edges.departed()]).toEqual([["a", { parentId: "boss" }]]);
    expect(edges.edgeOf("a" as TerminalId)).toEqual({ parentId: "boss" });
    edges.observe(frame({ anchor: {} }));
    expect([...edges.departed()]).toEqual([]);
    expect(() => edges.edgeOf("a" as TerminalId)).toThrow(/come apart/);
  });

  it("maintains a survivor in place — an unchanged edge is not rebuilt", () => {
    const edges = createEdgeMemory();
    edges.observe(frame({ a: { parentId: "boss" } }));
    const first = edges.edgeOf("a" as TerminalId);
    edges.observe(frame({ a: { parentId: "boss" } }));
    expect(edges.edgeOf("a" as TerminalId)).toBe(first);
    edges.observe(frame({ a: { parentId: "other" } }));
    expect(edges.edgeOf("a" as TerminalId)).toEqual({ parentId: "other" });
  });

  it("RAISES for a terminal it has never seen rather than answering `{}`", () => {
    const edges = createEdgeMemory();
    edges.observe(frame({ a: {} }));
    expect(() => edges.edgeOf("ghost" as TerminalId)).toThrow(
      /no remembered supervision edge/,
    );
  });

  it("forgets everything on dispose", () => {
    const edges = createEdgeMemory();
    edges.observe(frame({ a: {} }));
    edges.dispose();
    expect(() => edges.edgeOf("a" as TerminalId)).toThrow();
  });
});
