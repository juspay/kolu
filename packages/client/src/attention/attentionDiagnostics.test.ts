import { type ActiveTerminal, LOCAL_LOCATION } from "@kolu/padi-client/surface";
import type { AgentInfo } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { attentionDiagnostic, titleShowsSpinner } from "./attentionDiagnostics";

function makeMeta(overrides: Partial<ActiveTerminal> = {}): ActiveTerminal {
  return {
    state: "active",
    cwd: "/home/srid/code/drishti",
    git: { kind: "none" },
    location: LOCAL_LOCATION,
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
    lastActivityAt: null,
    promptedAt: null,
    ...overrides,
  };
}

function agent(state: AgentInfo["state"]): AgentInfo {
  return {
    kind: "claude-code",
    state,
    sessionId: "s1",
    model: null,
    summary: null,
    taskProgress: null,
    workflow: null,
    contextTokens: null,
    startedAt: null,
  };
}

describe("titleShowsSpinner", () => {
  it("detects the braille frames CLIs animate into their title", () => {
    for (const t of ["⠧ drishti-osfacts", "⠼ drishti-osfacts", "⠋ build"]) {
      expect(titleShowsSpinner(t)).toBe(true);
    }
  });

  it("is false for a static title and for no title", () => {
    expect(titleShowsSpinner("drishti-osfacts")).toBe(false);
    expect(titleShowsSpinner(null)).toBe(false);
    expect(titleShowsSpinner(undefined)).toBe(false);
  });
});

describe("attentionDiagnostic — separates the three causes of a paint/count split", () => {
  it("flags a spinning terminal kolu holds no agent state for", () => {
    const d = attentionDiagnostic({
      id: "e100e85c",
      meta: makeMeta({
        agent: null,
        foreground: { name: "codex", title: "⠧ drishti-osfacts", shell: false },
      }),
      glyph: "codex",
      pipVariant: "idle",
      motion: "spin",
      shellLive: true,
      attention: { klass: "idle", live: true },
    });

    expect(d.paintsBusy).toBe(true);
    expect(d.countedActive).toBe(true);
    expect(d.spinnerInTitle).toBe(true);
    expect(d.agentState).toBeNull();
    expect(d.disagreement).toMatch(/no agent state/);
    expect(d.agentKind).toBeNull();
    expect(d.glyph).toBe("codex");
  });

  it("flags a busy paint over a genuinely finished agent differently", () => {
    const d = attentionDiagnostic({
      id: "t2",
      meta: makeMeta({ agent: agent("waiting") }),
      glyph: "claude-code",
      pipVariant: "working",
      motion: "none",
      shellLive: false,
      attention: { klass: "finished", live: false },
    });
    expect(d.paintsBusy).toBe(true);
    expect(d.countedActive).toBe(false);
    expect(d.disagreement).toMatch(/agent state is "waiting"/);
    expect(d.disagreement).not.toMatch(/NO agent state/);
  });

  it("reports no disagreement when paint and counts agree", () => {
    const d = attentionDiagnostic({
      id: "t3",
      meta: makeMeta({ agent: agent("thinking") }),
      glyph: "claude-code",
      pipVariant: "working",
      motion: "spin",
      shellLive: false,
      attention: { klass: "working", live: true },
    });
    expect(d.countedActive).toBe(true);
    expect(d.paintsBusy).toBe(true);
    expect(d.disagreement).toBeNull();
  });

  it("flags a spinning stateless terminal even when the pip is not busy", () => {
    const d = attentionDiagnostic({
      id: "t4",
      meta: makeMeta({
        agent: null,
        foreground: { name: "codex", title: "⠹ building", shell: false },
      }),
      glyph: "shell",
      pipVariant: "idle",
      motion: "none",
      shellLive: false,
      attention: { klass: "idle", live: false },
    });
    expect(d.paintsBusy).toBe(false);
    expect(d.countedActive).toBe(false);
    expect(d.disagreement).toMatch(/counted only because bytes are moving/);
  });

  it("stays silent on an ordinary idle shell", () => {
    const d = attentionDiagnostic({
      id: "t5",
      meta: makeMeta({
        foreground: { name: "bash", title: null, shell: true },
      }),
      glyph: "shell",
      pipVariant: "idle",
      motion: "none",
      shellLive: false,
      attention: { klass: "idle", live: false },
    });
    expect(d.disagreement).toBeNull();
  });

  it("counts a still-lingering agent as active, and sees its motion", () => {
    const d = attentionDiagnostic({
      id: "t6",
      meta: makeMeta({ agent: agent("waiting") }),
      glyph: "claude-code",
      pipVariant: "linger",
      motion: "spin",
      shellLive: false,
      attention: { klass: "linger", live: false },
    });
    expect(d.paintsBusy).toBe(true);
    expect(d.countedActive).toBe(true);
    expect(d.disagreement).toBeNull();
  });
});
