import type { PtyHostListEntry } from "kaval";
import type { SavedSession, SavedTerminal } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { reconcile } from "./reconcile.ts";

// reconcile joins on `id` only — these builders carry just enough shape.
function live(id: string, pid = 1000): PtyHostListEntry {
  return { id, pid, cwd: "/x", lastActivity: 0 };
}
function term(id: string): SavedTerminal {
  return { id, cwd: "/x", git: null, lastActivityAt: 0 };
}
function saved(...terminals: SavedTerminal[]): SavedSession {
  return { terminals, activeTerminalId: terminals[0]?.id ?? null, savedAt: 1 };
}

describe("reconcile — boot-time adoption partition (B3.3)", () => {
  it("adopts a saved terminal whose PTY is still alive, as the whole record", () => {
    const t = term("a");
    const { adopt, orphanExtras } = reconcile([live("a")], saved(t));
    expect(adopt).toEqual([t]); // the WHOLE record (by reference), never rebuilt
    expect(orphanExtras).toEqual([]);
  });

  it("DROPS a saved terminal with no live PTY — an exited shell, in neither list", () => {
    const a = term("a");
    const b = term("b"); // 'b' exited in the restart window — not live
    const { adopt, orphanExtras } = reconcile([live("a")], saved(a, b));
    expect(adopt.map((t) => t.id)).toEqual(["a"]); // 'b' dropped, not restore-carded
    expect(orphanExtras).toEqual([]);
  });

  it("flags a live PTY with no saved record as an orphan (reap, never respawn)", () => {
    const a = term("a");
    const { adopt, orphanExtras } = reconcile([live("a"), live("z")], saved(a));
    expect(adopt.map((t) => t.id)).toEqual(["a"]);
    expect(orphanExtras.map((e) => e.id)).toEqual(["z"]); // 'z' has no saved record
  });

  it("partial survival: adopts the live, drops the exited, reaps the orphan", () => {
    const a = term("a"); // live → adopt
    const b = term("b"); // exited → drop
    const { adopt, orphanExtras } = reconcile(
      [live("a"), live("c")], // 'c' is an orphan; 'b' is gone
      saved(a, b),
    );
    expect(adopt.map((t) => t.id)).toEqual(["a"]);
    expect(orphanExtras.map((e) => e.id)).toEqual(["c"]);
  });

  it("no saved session: every live PTY is an orphan", () => {
    const { adopt, orphanExtras } = reconcile([live("a"), live("b")], null);
    expect(adopt).toEqual([]);
    expect(orphanExtras.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("empty daemon: nothing adopted, nothing orphaned (saved shells all dropped)", () => {
    const { adopt, orphanExtras } = reconcile([], saved(term("a")));
    expect(adopt).toEqual([]);
    expect(orphanExtras).toEqual([]);
  });

  it("keeps the SAVED order in the adopt list, not the daemon's list order", () => {
    const [a, b, c] = [term("a"), term("b"), term("c")];
    const { adopt } = reconcile(
      [live("c"), live("a"), live("b")], // daemon order differs
      saved(a, b, c),
    );
    expect(adopt.map((t) => t.id)).toEqual(["a", "b", "c"]); // saved order wins
  });
});
