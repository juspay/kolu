import {
  LOCAL_LOCATION,
  type SavedSession,
  type SavedTerminal,
} from "@kolu/padi-client/surface";
import type { PtyHostListEntry } from "kaval";
import { describe, expect, it } from "vitest";
import { type ReconcileResult, reconcile } from "./reconcile.ts";

function live(id: string, pid = 1000): PtyHostListEntry {
  return { id, pid, cwd: "/x", lastActivity: 0 };
}
function term(id: string): SavedTerminal {
  return {
    id,
    state: "active",
    cwd: "/x",
    git: { kind: "none" },
    pr: { kind: "absent" },
    location: LOCAL_LOCATION,
    lastActivityAt: 0,
    promptedAt: null,
    restoreTarget: {
      kind: "exact",
      agent: {
        kind: "claude-code",
        sessionId: `${id}-sess`,
        resumeRef: `${id}-sess`,
      },
      argv: [],
    },
  };
}
function sleepingTerm(id: string): SavedTerminal {
  return {
    id,
    state: "sleeping",
    sleptAt: 1,
    cwd: "/x",
    git: { kind: "none" },
    pr: { kind: "absent" },
    location: LOCAL_LOCATION,
    lastActivityAt: 0,
    promptedAt: null,
    restoreTarget: {
      kind: "exact",
      agent: {
        kind: "claude-code",
        sessionId: `${id}-sess`,
        resumeRef: `${id}-sess`,
      },
      argv: [],
    },
  };
}
function saved(...terminals: SavedTerminal[]): SavedSession {
  return { terminals, activeTerminalId: terminals[0]?.id ?? null, savedAt: 1 };
}

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
    expect(adoptedRecords(plan)).toEqual([t]);
    expect(adoptedSteps(plan)[0]?.live.id).toBe("a");
    expect(adoptOrphans).toEqual([]);
  });

  it("DROPS a saved terminal with no live PTY — an exited shell, in neither list", () => {
    const a = term("a");
    const b = term("b");
    const { plan, adoptOrphans } = reconcile([live("a")], saved(a, b));
    expect(adoptedRecords(plan).map((r) => r.id)).toEqual(["a"]);
    expect(adoptOrphans).toEqual([]);
  });

  it("a live PTY with no saved record is an orphan to ADOPT, not reap (F1)", () => {
    const a = term("a");
    const { plan, adoptOrphans } = reconcile([live("a"), live("z")], saved(a));
    expect(adoptedRecords(plan).map((r) => r.id)).toEqual(["a"]);
    expect(adoptOrphans.map((e) => e.id)).toEqual(["z"]);
  });

  it("partial survival: adopts the saved-live, drops the exited, adopts the orphan", () => {
    const a = term("a");
    const b = term("b");
    const { plan, adoptOrphans } = reconcile(
      [live("a"), live("c")],
      saved(a, b),
    );
    expect(adoptedRecords(plan).map((r) => r.id)).toEqual(["a"]);
    expect(adoptOrphans.map((e) => e.id)).toEqual(["c"]);
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
      [live("c"), live("a"), live("b")],
      saved(a, b, c),
    );
    expect(adoptedRecords(plan).map((r) => r.id)).toEqual(["a", "b", "c"]);
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
