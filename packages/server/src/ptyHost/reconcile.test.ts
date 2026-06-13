import type { PtyHostListEntry } from "kaval";
import type { SavedTerminal } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { reconcile } from "./reconcile.ts";

function live(id: string, pid = 100): PtyHostListEntry {
  return { id, pid, cwd: "/repo", lastActivity: 0 };
}
function saved(id: string): SavedTerminal {
  return { id, cwd: "/repo", git: null, lastActivityAt: 0 };
}

describe("reconcile", () => {
  it("adopts survivors, restore-cards the rest, reaps orphans", () => {
    const daemon = [live("a"), live("b"), live("orphan")];
    const session = [saved("a"), saved("b"), saved("gone")];
    const plan = reconcile(daemon, session);

    expect(plan.adopt.map((a) => a.saved.id)).toEqual(["a", "b"]);
    expect(plan.adopt.map((a) => a.entry.id)).toEqual(["a", "b"]);
    expect(plan.restoreCard.map((s) => s.id)).toEqual(["gone"]);
    expect(plan.orphanExtras.map((e) => e.id)).toEqual(["orphan"]);
  });

  it("all survived → everything adopted, no restore card, no orphans", () => {
    const plan = reconcile([live("a"), live("b")], [saved("a"), saved("b")]);
    expect(plan.adopt).toHaveLength(2);
    expect(plan.restoreCard).toEqual([]);
    expect(plan.orphanExtras).toEqual([]);
  });

  it("fresh daemon (no survivors) → all saved become the restore card", () => {
    const plan = reconcile([], [saved("a"), saved("b")]);
    expect(plan.adopt).toEqual([]);
    expect(plan.restoreCard.map((s) => s.id)).toEqual(["a", "b"]);
    expect(plan.orphanExtras).toEqual([]);
  });

  it("empty session against live PTYs → all orphans (nothing to adopt)", () => {
    const plan = reconcile([live("x")], []);
    expect(plan.adopt).toEqual([]);
    expect(plan.restoreCard).toEqual([]);
    expect(plan.orphanExtras.map((e) => e.id)).toEqual(["x"]);
  });

  it("preserves the whole saved record on the adopt entry (not just the id)", () => {
    const rich: SavedTerminal = {
      id: "a",
      cwd: "/work",
      git: null,
      lastActivityAt: 5,
      parentId: "p",
      lastAgentCommand: "claude -c",
    };
    const plan = reconcile([live("a")], [rich]);
    expect(plan.adopt[0]?.saved).toBe(rich);
  });
});
