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
    const { adopt, adoptOrphans } = reconcile([live("a")], saved(t));
    expect(adopt.map((a) => a.record)).toEqual([t]); // the WHOLE record, never rebuilt
    expect(adopt[0]?.live.id).toBe("a"); // paired with its live PTY (the join)
    expect(adoptOrphans).toEqual([]);
  });

  it("DROPS a saved terminal with no live PTY — an exited shell, in neither list", () => {
    const a = term("a");
    const b = term("b"); // 'b' exited in the restart window — not live
    const { adopt, adoptOrphans } = reconcile([live("a")], saved(a, b));
    expect(adopt.map((a) => a.record.id)).toEqual(["a"]); // 'b' dropped, not restore-carded
    expect(adoptOrphans).toEqual([]);
  });

  it("a live PTY with no saved record is an orphan to ADOPT, not reap (F1)", () => {
    // 'z' is live in the daemon but absent from the debounced saved session —
    // a create that raced the restart. It must survive (adopt), never be killed.
    const a = term("a");
    const { adopt, adoptOrphans } = reconcile([live("a"), live("z")], saved(a));
    expect(adopt.map((a) => a.record.id)).toEqual(["a"]);
    expect(adoptOrphans.map((e) => e.id)).toEqual(["z"]); // adopted from the snapshot
  });

  it("partial survival: adopts the saved-live, drops the exited, adopts the orphan", () => {
    const a = term("a"); // live + saved → adopt whole-record
    const b = term("b"); // saved but exited → drop
    const { adopt, adoptOrphans } = reconcile(
      [live("a"), live("c")], // 'c' is a live orphan; 'b' is gone
      saved(a, b),
    );
    expect(adopt.map((a) => a.record.id)).toEqual(["a"]);
    expect(adoptOrphans.map((e) => e.id)).toEqual(["c"]); // adopted, not reaped
  });

  it("no saved session: every live PTY is an orphan to adopt", () => {
    const { adopt, adoptOrphans } = reconcile([live("a"), live("b")], null);
    expect(adopt).toEqual([]);
    expect(adoptOrphans.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("empty daemon: nothing adopted, nothing orphaned (saved shells all dropped)", () => {
    const { adopt, adoptOrphans } = reconcile([], saved(term("a")));
    expect(adopt).toEqual([]);
    expect(adoptOrphans).toEqual([]);
  });

  it("keeps the SAVED order in the adopt list, not the daemon's list order", () => {
    const [a, b, c] = [term("a"), term("b"), term("c")];
    const { adopt } = reconcile(
      [live("c"), live("a"), live("b")], // daemon order differs
      saved(a, b, c),
    );
    expect(adopt.map((a) => a.record.id)).toEqual(["a", "b", "c"]); // saved order wins
  });
});
