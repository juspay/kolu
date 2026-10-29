import { LOCAL_LOCATION, type SavedTerminal } from "@kolu/padi-client/surface";
import { describe, expect, it } from "vitest";
import { resumableTerminalIds } from "./resumable.ts";

const base = {
  cwd: "/work/repo",
  git: { kind: "none" },
  pr: { kind: "absent" as const },
  location: LOCAL_LOCATION,
  lastActivityAt: 0,
  promptedAt: null,
} as const;

/** A claude-code native session id — a UUID, the only shape that passes
 *  `resumeFormFor`'s shell-safe id gate (so the `exact` target actually
 *  resumes rather than waking to a bare shell). */
const CLAUDE_ID = "12341234-1234-1234-1234-123412341234";

const exactTarget = (
  argv: readonly string[] = [],
): SavedTerminal["restoreTarget"] => ({
  kind: "exact",
  agent: { kind: "claude-code", sessionId: CLAUDE_ID, resumeRef: CLAUDE_ID },
  argv: [...argv],
});

const activeWithAgent: SavedTerminal = {
  ...base,
  id: "active-agent",
  state: "active",
  restoreTarget: exactTarget(["--permission-mode", "auto"]),
};
const sleepingWithAgent: SavedTerminal = {
  ...base,
  id: "sleeping-agent",
  state: "sleeping",
  sleptAt: 1,
  restoreTarget: exactTarget(["--permission-mode", "auto"]),
};
const activeNoAgent: SavedTerminal = {
  ...base,
  id: "active-bare",
  state: "active",
};
const activeQuitToShell: SavedTerminal = {
  ...base,
  id: "active-quit",
  state: "active",
  restoreTarget: { kind: "none" },
};
const subWithAgent: SavedTerminal = {
  ...base,
  id: "sub-agent",
  state: "active",
  parentId: "active-agent",
  restoreTarget: exactTarget(),
};

describe("resumableTerminalIds (host-owned)", () => {
  it("includes parented ACTIVE agents — splits resume too", () => {
    const ids = resumableTerminalIds([
      activeWithAgent,
      sleepingWithAgent,
      activeNoAgent,
      activeQuitToShell,
      subWithAgent,
    ]);
    // Live exact targets only; sleeping / quit-to-shell / bare shell excluded.
    // The parented sub IS included — that is the bug class this fold closes.
    expect(ids).toEqual(["active-agent", "sub-agent"]);
  });

  it("returns [] when every agent-carrying terminal is asleep", () => {
    expect(resumableTerminalIds([sleepingWithAgent])).toEqual([]);
  });

  it("excludes an `exact` target whose id can't actually resume (matches wake)", () => {
    const brokenId: SavedTerminal = {
      ...base,
      id: "active-broken-id",
      state: "active",
      restoreTarget: {
        kind: "exact",
        agent: {
          kind: "claude-code",
          sessionId: "not-a-uuid",
          resumeRef: "not-a-uuid",
        },
        argv: [],
      },
    };
    expect(resumableTerminalIds([brokenId])).toEqual([]);
  });

  it("excludes an agent kind this build no longer knows", () => {
    const retired: SavedTerminal = {
      ...base,
      id: "active-retired",
      state: "active",
      restoreTarget: {
        kind: "exact",
        agent: {
          kind: "retired-agent",
          sessionId: CLAUDE_ID,
          resumeRef: CLAUDE_ID,
        },
        argv: [],
      },
    };
    expect(resumableTerminalIds([retired])).toEqual([]);
  });
});
