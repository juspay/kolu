/**
 * Pins the ONE lane-attribution memory both watch sources read: that a departed
 * terminal's edge outlives its record for exactly the frame that reports it,
 * that a survivor's unchanged edge is not rebuilt, and that an id this memory
 * has never seen RAISES rather than answering with an empty edge.
 */

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
    // OMITTED, never `undefined` — these ride optionalKey wire fields.
    expect(edges.edgeOf("b" as TerminalId)).toEqual({});
  });

  it("keeps a DEPARTED terminal's edge for the frame that reports it, and drops it after", () => {
    const edges = createEdgeMemory();
    edges.observe(frame({ a: { parentId: "boss" }, anchor: {} }));
    edges.observe(frame({ anchor: {} }));
    expect([...edges.departed()]).toEqual([["a", { parentId: "boss" }]]);
    // The record is gone, but the lane it left is still attributable — which is
    // what lets a `gone` event reach the supervisor that was watching it.
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
    // …and a CHANGED edge is replaced, so nothing reads a stale parent.
    edges.observe(frame({ a: { parentId: "other" } }));
    expect(edges.edgeOf("a" as TerminalId)).toEqual({ parentId: "other" });
  });

  it("RAISES for a terminal it has never seen rather than answering `{}`", () => {
    const edges = createEdgeMemory();
    edges.observe(frame({ a: {} }));
    // An empty edge is a real answer ("a root with no intent"), so a miss must
    // not be spelled the same way — a source only asks about ids from the frame
    // this memory just took.
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
