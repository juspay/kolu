/** One value, four channels.
 *
 *  A mark carries four things at once — its colour, whether it moves, whether
 *  it wears the needs-you wash, and whether a count includes it. The whole
 *  point of shipping the attention class on the wire is that all four read the
 *  SAME value, so they cannot say different things about one terminal.
 *
 *  Colour was the last channel still reading somewhere else: it folded the
 *  terminal's own metadata, which arrives on a different subscription from the
 *  host's attention frame. These tests pin what that cost and what fixed it. */

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
    git: null,
    location: LOCAL_LOCATION,
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
    lastActivityAt: 1,
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

  // THE REGRESSION THIS FILE EXISTS FOR. Metadata and the attention frame land
  // independently (the argument is in `@kolu/padi-client/attention`'s header),
  // so there is a real window where metadata says "thinking" and the frame has
  // said nothing yet. Colour was the last channel still believing the metadata:
  // the mark went rust while standing still, and no count included it.
  it("stays quiet, not confidently wrong, when the frame has not arrived", () => {
    const pip = bindStatePip({
      // Metadata is emphatic that an agent is working here.
      meta: meta({ agent: agent("thinking") }),
      // The frame has not spoken about this terminal yet.
      attention: { klass: "idle", live: false },
      unread: false,
    });
    // All four channels agree on "nothing to report" — a quiet mark, rather
    // than a rust one that does not move and no count owns.
    expect(pip.variant).toBe("idle");
    expect(pip.motion).toBe("none");
    expect(pip.active).toBe(false);
    expect(pip.asking).toBe(false);
  });

  it("dormancy still comes from the tile, not from any agent inside it", () => {
    // Sleeping is a property of the tile itself, so it is the one paint input
    // that stays a metadata read — and it wins over whatever the frame says.
    const pip = bindStatePip({
      meta: {
        state: "sleeping",
        sleptAt: 1,
        cwd: "/work/repo",
        git: null,
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
    // Idle VARIANT (title and a11y keep saying "Idle" — there is no agent to
    // report) with the byte-level busy paint, and it moves because it is
    // genuinely active.
    expect(pip.variant).toBe("idle");
    expect(pip.shellLive).toBe(true);
    expect(pip.active).toBe(true);
    expect(pip.motion).toBe("spin");
  });
});
