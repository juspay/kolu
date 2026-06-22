/**
 * R8 — the dissolved fold's correctness, pinned as a round-trip.
 *
 * R8 splits one internal record onto two surfaces (kolu's own fields +
 * `AwarenessValue`) and rebuilds it on the client by id. The invariant that
 * makes that safe: `join(projectKolu(m), projectAwareness(m)) === m` for an
 * active record, and a sleeping record passes through both ways unchanged (it has
 * no live awareness half). If a future field lands on the wrong base, this test
 * fails rather than silently dropping it across the wire.
 */

import { describe, expect, it } from "vitest";
import {
  type ActiveTerminal,
  joinTerminalMetadata,
  LOCAL_LOCATION,
  projectAwareness,
  projectKoluFields,
  type SleepingTerminal,
} from "./surface.ts";

const active: ActiveTerminal = {
  state: "active",
  location: LOCAL_LOCATION,
  // awareness half
  cwd: "/work/repo",
  git: {
    repoRoot: "/work/repo",
    repoName: "repo",
    worktreePath: "/work/repo",
    branch: "main",
    isWorktree: false,
    mainRepoRoot: "/work/repo",
    remoteUrl: null,
  },
  lastActivityAt: 123,
  lastAgentCommand: "claude --model sonnet",
  agentSession: { kind: "claude-code", id: "sess-1" },
  pr: { kind: "pending" },
  agent: null,
  foreground: null,
  // kolu half
  themeName: "rose",
  intent: "fix the auth race",
};

const sleeping: SleepingTerminal = {
  state: "sleeping",
  location: LOCAL_LOCATION,
  cwd: "/work/repo",
  git: null,
  lastActivityAt: 200,
  sleptAt: 999,
  // a FROZEN pr snapshot — the dormant tile's data, kolu-owned
  pr: {
    kind: "ok",
    value: {
      number: 42,
      title: "Fix the auth race",
      url: "https://github.com/o/r/pull/42",
      state: "open",
      checks: "pass",
      checkRuns: [],
    },
  },
  themeName: "rose",
};

describe("R8 project / join — the dissolved fold reconstructs losslessly", () => {
  it("active: join(projectKolu, projectAwareness) === the original record", () => {
    const rebuilt = joinTerminalMetadata(
      projectKoluFields(active),
      projectAwareness(active),
    );
    expect(rebuilt).toEqual(active);
  });

  it("projectKolu drops the awareness overlay from an active record", () => {
    const kolu = projectKoluFields(active) as Record<string, unknown>;
    expect(kolu.state).toBe("active");
    expect(kolu.location).toEqual(LOCAL_LOCATION);
    expect(kolu.themeName).toBe("rose");
    // none of the awareness fields ride kolu's half
    for (const k of [
      "cwd",
      "git",
      "pr",
      "agent",
      "foreground",
      "lastActivityAt",
    ])
      expect(kolu[k]).toBeUndefined();
  });

  it("projectAwareness carries only the generic awareness value", () => {
    const a = projectAwareness(active) as Record<string, unknown>;
    expect(a.cwd).toBe("/work/repo");
    expect(a.pr).toEqual({ kind: "pending" });
    // none of kolu's own fields leak onto the awareness wire
    for (const k of ["location", "state", "themeName", "intent"])
      expect(a[k]).toBeUndefined();
  });

  it("sleeping: passes through both directions unchanged (no live awareness half)", () => {
    expect(projectKoluFields(sleeping)).toEqual(sleeping);
    expect(
      joinTerminalMetadata(projectKoluFields(sleeping), undefined),
    ).toEqual(sleeping);
  });

  it("first-paint flicker: an active terminal whose awareness half hasn't arrived seeds defaults", () => {
    const rebuilt = joinTerminalMetadata(projectKoluFields(active), undefined);
    expect(rebuilt.state).toBe("active");
    // chrome paints immediately…
    expect((rebuilt as ActiveTerminal).themeName).toBe("rose");
    // …and the badge shows the seeded "not yet resolved" awareness until the
    // awareness snapshot lands (cwd empty, PR pending).
    const arm = rebuilt as ActiveTerminal;
    expect(arm.cwd).toBe("");
    expect(arm.pr).toEqual({ kind: "pending" });
    expect(arm.git).toBeNull();
  });
});
