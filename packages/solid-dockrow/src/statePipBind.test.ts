import {
  type ActiveTerminal,
  LOCAL_LOCATION,
  type TerminalMetadata,
} from "@kolu/padi-client/surface";
import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { bindStatePip } from "./pipBind.ts";

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

function meta(overrides: Partial<ActiveTerminal> = {}): TerminalMetadata {
  return {
    state: "active",
    cwd: "/work/repo",
    git: { kind: "none" },
    location: LOCAL_LOCATION,
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
    lastActivityAt: 1,
    promptedAt: null,
    ...overrides,
  };
}

describe("bindStatePip — colour comes from the same value as motion", () => {
  it("paints a working agent rust AND moves it", () => {
    const pip = bindStatePip({
      meta: meta({ agent: agent("thinking") }),
      attention: { klass: "working", live: true },
      unread: false,
    });
    expect(pip.variant).toBe("working");
    expect(pip.motion).toBe("spin");
    expect(pip.active).toBe(true);
  });

  it("paints a blocked agent violet, glowing, and flags it asking", () => {
    const pip = bindStatePip({
      meta: meta({ agent: agent("awaiting_user") }),
      attention: { klass: "asking", live: false },
      unread: false,
    });
    expect(pip.variant).toBe("awaiting");
    expect(pip.motion).toBe("glow");
    expect(pip.asking).toBe(true);
  });

  it("stays quiet, not confidently wrong, when the frame has not arrived", () => {
    const pip = bindStatePip({
      meta: meta({ agent: agent("thinking") }),
      attention: { klass: "idle", live: false },
      unread: false,
    });
    expect(pip.variant).toBe("idle");
    expect(pip.motion).toBe("none");
    expect(pip.active).toBe(false);
    expect(pip.asking).toBe(false);
  });

  it("dormancy still comes from the tile, not from any agent inside it", () => {
    const pip = bindStatePip({
      meta: {
        state: "sleeping",
        sleptAt: 1,
        cwd: "/work/repo",
        git: { kind: "none" },
        pr: { kind: "absent" },
        location: LOCAL_LOCATION,
        lastActivityAt: 1,
      } as TerminalMetadata,
      attention: { klass: "working", live: true },
      unread: false,
    });
    expect(pip.variant).toBe("sleeping");
    expect(pip.motion).toBe("none");
    expect(pip.sleeping).toBe(true);
  });

  it("a printing shell with no agent paints busy without claiming an agent", () => {
    const pip = bindStatePip({
      meta: meta(),
      attention: { klass: "idle", live: true },
      unread: false,
    });
    expect(pip.variant).toBe("idle");
    expect(pip.shellLive).toBe(true);
    expect(pip.active).toBe(true);
    expect(pip.motion).toBe("spin");
  });
  it("a terminal an agent IS driving does NOT paint busy-shell, however quiet", () => {
    const pip = bindStatePip({
      meta: meta({ agent: agent("thinking") }),
      attention: { klass: "idle", live: true },
      unread: false,
    });
    expect(pip.shellLive).toBe(false);
  });
});
