/**
 * R8 — the two-surface model's correctness, pinned as a round-trip.
 *
 * A terminal is kolu's AUTHORED record (`KoluTerminalFields`) + the sensors'
 * OBSERVED `AwarenessValue`, never one held record. These pin the seams:
 *   - the browser COMPOSES the two at render (`joinTerminalMetadata`);
 *   - the server SAMPLES restore-seeds from the observation at save
 *     (`restoreSeedsFromAwareness`) and rebuilds them on wake (`awarenessFromSeeds`);
 *   - a saved/sleeping record SPLITS into authored + observed
 *     (`authoredActiveFromRecord` / `awarenessSeedFromRecord`) — schema-driven, so a
 *     new field rides through (the #1275 lossy-adoption class stays closed).
 */

import { describe, expect, it } from "vitest";
import {
  type AwarenessValue,
  authoredActiveFromRecord,
  awarenessFromSeeds,
  awarenessSeedFromRecord,
  joinTerminalMetadata,
  type KoluActiveTerminal,
  LOCAL_LOCATION,
  restoreSeedsFromAwareness,
  type SavedActiveTerminal,
  type SleepingTerminal,
} from "./surface.ts";

const authored: KoluActiveTerminal = {
  state: "active",
  location: LOCAL_LOCATION,
  themeName: "rose",
  intent: "fix the auth race",
};

const observed: AwarenessValue = {
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
};

const sleeping: SleepingTerminal = {
  state: "sleeping",
  location: LOCAL_LOCATION,
  cwd: "/work/repo",
  git: null,
  lastActivityAt: 200,
  sleptAt: 999,
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

describe("R8 compose / sample — the two surfaces, never one record", () => {
  it("active: join(authored, observed) yields the full render record", () => {
    const full = joinTerminalMetadata(authored, observed);
    expect(full.state).toBe("active");
    // authored half
    expect((full as { themeName?: string }).themeName).toBe("rose");
    expect(full.location).toEqual(LOCAL_LOCATION);
    // observed half
    const arm = full as typeof full & AwarenessValue;
    expect(arm.cwd).toBe("/work/repo");
    expect(arm.git?.branch).toBe("main");
    expect(arm.lastAgentCommand).toBe("claude --model sonnet");
  });

  it("sleeping: passes through unchanged (cwd/git/pr are its frozen snapshot)", () => {
    expect(joinTerminalMetadata(sleeping, undefined)).toEqual(sleeping);
  });

  it("first-paint flicker: an active terminal whose observation hasn't arrived seeds defaults", () => {
    const full = joinTerminalMetadata(
      authored,
      undefined,
    ) as KoluActiveTerminal & AwarenessValue;
    expect(full.state).toBe("active");
    expect(full.themeName).toBe("rose"); // chrome paints immediately…
    expect(full.cwd).toBe(""); // …badge shows seeded "not yet resolved" until observed
    expect(full.pr).toEqual({ kind: "pending" });
    expect(full.git).toBeNull();
  });

  it("restore-seeds round-trip: awarenessFromSeeds ∘ restoreSeedsFromAwareness", () => {
    const seeds = restoreSeedsFromAwareness(observed);
    // the persisted half only — no live overlay
    expect(seeds).not.toHaveProperty("pr");
    expect(seeds).not.toHaveProperty("agent");
    expect(seeds.cwd).toBe("/work/repo");
    // rebuilt observation: seeds back + live defaults
    const rebuilt = awarenessFromSeeds(seeds);
    expect(rebuilt.cwd).toBe("/work/repo");
    expect(rebuilt.git?.branch).toBe("main");
    expect(rebuilt.pr).toEqual({ kind: "pending" });
    expect(rebuilt.agent).toBeNull();
  });

  it("a saved record splits into authored (no observed) + observed seed", () => {
    const saved: SavedActiveTerminal = {
      id: "11111111-1111-4111-8111-111111111111",
      state: "active",
      location: LOCAL_LOCATION,
      themeName: "rose",
      intent: "fix it",
      cwd: "/work/repo",
      git: null,
      lastActivityAt: 7,
      lastAgentCommand: "codex",
    };
    const a = authoredActiveFromRecord(saved) as Record<string, unknown>;
    expect(a.themeName).toBe("rose");
    expect(a.location).toEqual(LOCAL_LOCATION);
    for (const k of ["cwd", "git", "pr", "agent", "lastAgentCommand"])
      expect(a[k]).toBeUndefined(); // observed stripped from the authored arm

    const seed = awarenessSeedFromRecord(saved);
    expect(seed.cwd).toBe("/work/repo");
    expect(seed.lastAgentCommand).toBe("codex");
    expect(seed.pr).toEqual({ kind: "pending" }); // live half re-derived
  });
});
