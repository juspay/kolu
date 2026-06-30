import type { PtyHostListEntry } from "kaval";
import {
  type HostLocation,
  LOCAL_LOCATION,
  type SavedSession,
  type SavedTerminal,
} from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { reconcile } from "./reconcile.ts";

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

  it("never adopts a sleeping record, and reaps nothing when its PTY is gone", () => {
    const { adopt, adoptOrphans, reapSleeping } = reconcile(
      [],
      saved(sleepingTerm("s")),
    );
    expect(adopt).toEqual([]);
    expect(adoptOrphans).toEqual([]);
    expect(reapSleeping).toEqual([]);
  });

  it("reaps a sleeping record's crash-surviving PTY — neither adopted nor orphaned", () => {
    // Persist-before-kill crashed after the flip but before the PTY kill: the PTY
    // outlived the sleep. Its id is a saved id, so it's not an orphan — and the
    // record is sleeping, so it's reaped, never re-woken.
    const { adopt, adoptOrphans, reapSleeping } = reconcile(
      [live("s")],
      saved(sleepingTerm("s")),
    );
    expect(adopt).toEqual([]);
    expect(adoptOrphans).toEqual([]);
    expect(reapSleeping.map((e) => e.id)).toEqual(["s"]);
  });

  it("partitions a mixed session: adopt the active survivor, reap the sleeping survivor", () => {
    const { adopt, adoptOrphans, reapSleeping } = reconcile(
      [live("a"), live("s")],
      saved(term("a"), sleepingTerm("s")),
    );
    expect(adopt.map((p) => p.record.id)).toEqual(["a"]);
    expect(adoptOrphans).toEqual([]);
    expect(reapSleeping.map((e) => e.id)).toEqual(["s"]);
  });
});

describe("reconcile — the per-host location filter (PR-0 remote-prep)", () => {
  // The destructive seam F-REMOTE depends on, previously untested: each host's boot
  // reconciles against ITS daemon's live list joined with ONLY the saved records on
  // ITS location. An UNFILTERED join is silently destructive across hosts — a remote
  // active with no LOCAL live PTY reads as an exited shell and the converge DROPS it;
  // a remote sleeping record's id can land in the local `reapSleeping`.
  const REMOTE: HostLocation = { kind: "remote", hostId: "build-box" };

  function remoteTerm(id: string): SavedTerminal {
    return { ...term(id), location: REMOTE };
  }
  function remoteSleeping(id: string): SavedTerminal {
    return { ...sleepingTerm(id), location: REMOTE };
  }

  it("the LOCAL reconcile joins ONLY local saved records — a remote active is neither dropped nor adopted here", () => {
    // The local daemon's live list holds only the LOCAL PTY (a); the saved session
    // has BOTH a local active (a) and a remote active (r). Scoped to the local
    // location, the remote record is invisible to THIS reconcile (the remote host's
    // own reconcile owns it) — so `r` never becomes a phantom orphan, and the converge
    // never drops it as an exited shell.
    const { adopt, adoptOrphans, reapSleeping } = reconcile(
      [live("a")],
      saved(term("a"), remoteTerm("r")),
      LOCAL_LOCATION,
    );
    expect(adopt.map((p) => p.record.id)).toEqual(["a"]);
    expect(adoptOrphans).toEqual([]);
    expect(reapSleeping).toEqual([]);
  });

  it("the LOCAL reconcile does NOT reap a remote host's sleeping record", () => {
    // A remote sleeping record (r) must never enter the local `reapSleeping`: the
    // filter drops it from the local `sleepingIds`, so the local boot can't kill the
    // remote host's dormant terminal.
    const { adopt, adoptOrphans, reapSleeping } = reconcile(
      [live("a")],
      saved(term("a"), remoteSleeping("r")),
      LOCAL_LOCATION,
    );
    expect(adopt.map((p) => p.record.id)).toEqual(["a"]);
    expect(adoptOrphans).toEqual([]);
    expect(reapSleeping).toEqual([]);
  });

  it("the REMOTE reconcile joins ONLY that host's records against its own daemon's list", () => {
    // The remote host's reconcile sees ITS daemon's live list (r) and joins only the
    // remote saved records — the local active (a) is filtered out, never mistaken for
    // an exited remote shell.
    const { adopt, adoptOrphans, reapSleeping } = reconcile(
      [live("r")],
      saved(term("a"), remoteTerm("r")),
      REMOTE,
    );
    expect(adopt.map((p) => p.record.id)).toEqual(["r"]);
    expect(adoptOrphans).toEqual([]);
    expect(reapSleeping).toEqual([]);
  });
});
