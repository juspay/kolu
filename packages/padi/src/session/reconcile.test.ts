import type { PtyHostListEntry } from "kaval";
import { describe, expect, it } from "vitest";
import { reconcile, type ReconcileResult } from "./reconcile.ts";
import {
  LOCAL_LOCATION,
  type SavedSession,
  type SavedTerminal,
} from "../vocab.ts";

// reconcile joins on `id` only — these builders carry just enough shape.
function live(id: string, pid = 1000): PtyHostListEntry {
  return { id, pid, cwd: "/x", lastActivity: 0 };
}
function term(id: string): SavedTerminal {
  return {
    id,
    state: "active",
    cwd: "/x",
    git: null,
    pr: { kind: "absent" }, // pr is restore-relevant (persisted) post-cutover
    location: LOCAL_LOCATION,
    lastActivityAt: 0,
    // The fold-derived `restoreTarget` — must ride through whole-record adoption
    // (#1275), replacing the deleted sticky `agentSession` + bare `resumeAgent`.
    restoreTarget: {
      kind: "exact",
      command: "claude",
      agent: { kind: "claude-code", sessionId: `${id}-sess` },
    },
  };
}
function sleepingTerm(id: string): SavedTerminal {
  return {
    id,
    state: "sleeping",
    sleptAt: 1,
    cwd: "/x",
    git: null,
    pr: { kind: "absent" }, // pr rides the persisted observation now (no frozen-pr special case)
    location: LOCAL_LOCATION,
    lastActivityAt: 0,
    restoreTarget: {
      kind: "exact",
      command: "claude",
      agent: { kind: "claude-code", sessionId: `${id}-sess` },
    },
  };
}
function saved(...terminals: SavedTerminal[]): SavedSession {
  return { terminals, activeTerminalId: terminals[0]?.id ?? null, savedAt: 1 };
}

/** The plan's adopt steps, in plan order. These read the ORDERED plan rather
 *  than a separate `adopt` array: that array existed only so the caller could
 *  re-derive an ordering this module already had, and once the caller took the
 *  plan it had no production reader left — a set beside a sequence that carries
 *  the same pairs is a second answer waiting to disagree. */
function adoptedSteps(plan: ReconcileResult["plan"]) {
  return plan.filter((s) => s.kind === "adopt");
}
function adoptedRecords(plan: ReconcileResult["plan"]) {
  return adoptedSteps(plan).map((s) => s.record);
}

describe("reconcile — boot-time adoption partition (B3.3)", () => {
  it("adopts a saved terminal whose PTY is still alive, as the whole record", () => {
    const t = term("a");
    const { plan, adoptOrphans } = reconcile([live("a")], saved(t));
    expect(adoptedRecords(plan)).toEqual([t]); // the WHOLE record, never rebuilt
    expect(adoptedSteps(plan)[0]?.live.id).toBe("a"); // paired with its live PTY (the join)
    expect(adoptOrphans).toEqual([]);
  });

  it("DROPS a saved terminal with no live PTY — an exited shell, in neither list", () => {
    const a = term("a");
    const b = term("b"); // 'b' exited in the restart window — not live
    const { plan, adoptOrphans } = reconcile([live("a")], saved(a, b));
    expect(adoptedRecords(plan).map((r) => r.id)).toEqual(["a"]); // 'b' dropped, not restore-carded
    expect(adoptOrphans).toEqual([]);
  });

  it("a live PTY with no saved record is an orphan to ADOPT, not reap (F1)", () => {
    // 'z' is live in the daemon but absent from the debounced saved session —
    // a create that raced the restart. It must survive (adopt), never be killed.
    const a = term("a");
    const { plan, adoptOrphans } = reconcile([live("a"), live("z")], saved(a));
    expect(adoptedRecords(plan).map((r) => r.id)).toEqual(["a"]);
    expect(adoptOrphans.map((e) => e.id)).toEqual(["z"]); // adopted from the snapshot
  });

  it("partial survival: adopts the saved-live, drops the exited, adopts the orphan", () => {
    const a = term("a"); // live + saved → adopt whole-record
    const b = term("b"); // saved but exited → drop
    const { plan, adoptOrphans } = reconcile(
      [live("a"), live("c")], // 'c' is a live orphan; 'b' is gone
      saved(a, b),
    );
    expect(adoptedRecords(plan).map((r) => r.id)).toEqual(["a"]);
    expect(adoptOrphans.map((e) => e.id)).toEqual(["c"]); // adopted, not reaped
  });

  it("no saved session: every live PTY is an orphan to adopt", () => {
    const { plan, adoptOrphans } = reconcile([live("a"), live("b")], null);
    expect(adoptedRecords(plan)).toEqual([]);
    expect(adoptOrphans.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("empty daemon: nothing adopted, nothing orphaned (saved shells all dropped)", () => {
    const { plan, adoptOrphans } = reconcile([], saved(term("a")));
    expect(adoptedRecords(plan)).toEqual([]);
    expect(adoptOrphans).toEqual([]);
  });

  it("keeps the SAVED order in the adopt list, not the daemon's list order", () => {
    const [a, b, c] = [term("a"), term("b"), term("c")];
    const { plan } = reconcile(
      [live("c"), live("a"), live("b")], // daemon order differs
      saved(a, b, c),
    );
    expect(adoptedRecords(plan).map((r) => r.id)).toEqual(["a", "b", "c"]); // saved order wins
  });

  it("never adopts a sleeping record, and reaps nothing when its PTY is gone", () => {
    const { plan, adoptOrphans, reapSleeping } = reconcile(
      [],
      saved(sleepingTerm("s")),
    );
    expect(adoptedRecords(plan)).toEqual([]);
    expect(adoptOrphans).toEqual([]);
    expect(reapSleeping).toEqual([]);
  });

  it("reaps a sleeping record's crash-surviving PTY — neither adopted nor orphaned", () => {
    // Persist-before-kill crashed after the flip but before the PTY kill: the PTY
    // outlived the sleep. Its id is a saved id, so it's not an orphan — and the
    // record is sleeping, so it's reaped, never re-woken.
    const { plan, adoptOrphans, reapSleeping } = reconcile(
      [live("s")],
      saved(sleepingTerm("s")),
    );
    expect(adoptedRecords(plan)).toEqual([]);
    expect(adoptOrphans).toEqual([]);
    expect(reapSleeping.map((e) => e.id)).toEqual(["s"]);
  });

  it("partitions a mixed session: adopt the active survivor, reap the sleeping survivor", () => {
    const { plan, adoptOrphans, reapSleeping } = reconcile(
      [live("a"), live("s")],
      saved(term("a"), sleepingTerm("s")),
    );
    expect(adoptedRecords(plan).map((r) => r.id)).toEqual(["a"]);
    expect(adoptOrphans).toEqual([]);
    expect(reapSleeping.map((e) => e.id)).toEqual(["s"]);
  });
});
