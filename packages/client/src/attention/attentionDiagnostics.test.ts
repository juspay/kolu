/** Pins the attention diagnostic on the three causes it exists to tell apart —
 *  they demand opposite fixes, so a dump that can't distinguish them is worth
 *  nothing. The field case (juspay/kolu#2019 review) is the first test. */

import { type ActiveTerminal, LOCAL_LOCATION } from "@kolu/padi/surface";
import type { AgentInfo } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { attentionDiagnostic, titleShowsSpinner } from "./attentionDiagnostics";

function makeMeta(overrides: Partial<ActiveTerminal> = {}): ActiveTerminal {
  return {
    state: "active",
    cwd: "/home/srid/code/drishti",
    git: null,
    location: LOCAL_LOCATION,
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
    lastActivityAt: null,
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
    // The exact titles sampled from the live report, one per spinner frame.
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
  // CAUSE 1 — kolu is blind: the terminal's own title is spinning (it is
  // working) but kolu holds no agent state. The COUNT is no longer wrong here —
  // byte motion carries it, which is what closed the naiveintent 3-vs-2 bug —
  // but kolu still cannot name the agent or hear it finish, so the gap is
  // reported. The fix belongs in detection/sync, NOT in dimming the pip.
  it("flags a spinning terminal kolu holds no agent state for", () => {
    const d = attentionDiagnostic({
      id: "e100e85c",
      meta: makeMeta({
        agent: null,
        foreground: { name: "codex", title: "⠧ drishti-osfacts" },
      }),
      glyph: "codex",
      pipVariant: "idle",
      motion: "spin",
      shellLive: true,
      isLive: true,
      isFinished: false,
      attention: { klass: "idle", live: true },
    });

    expect(d.paintsBusy).toBe(true);
    // Counted now — the bytes are the evidence, which is exactly the fix.
    expect(d.countedWorking).toBe(true);
    expect(d.spinnerInTitle).toBe(true);
    expect(d.agentState).toBeNull();
    expect(d.disagreement).toMatch(/no agent state/);
    // The glyph naming an agent while `agentKind` is null is itself the tell
    // that the identity came from the restore target.
    expect(d.agentKind).toBeNull();
    expect(d.glyph).toBe("codex");
  });

  // CAUSE 3 — the agent really had finished and the busy paint would be the
  // lie. Distinguished from cause 1 by a PRESENT agent state.
  it("flags a busy paint over a genuinely finished agent differently", () => {
    const d = attentionDiagnostic({
      id: "t2",
      meta: makeMeta({ agent: agent("waiting") }),
      glyph: "claude-code",
      pipVariant: "working",
      motion: "none",
      shellLive: false,
      isLive: false,
      isFinished: true,
      attention: { klass: "finished", live: false },
    });
    expect(d.paintsBusy).toBe(true);
    expect(d.countedWorking).toBe(false);
    expect(d.disagreement).toMatch(/agent state is "waiting"/);
    expect(d.disagreement).not.toMatch(/NO agent state/);
  });

  // A working agent kolu can see: both axes agree, nothing to report.
  it("reports no disagreement when paint and counts agree", () => {
    const d = attentionDiagnostic({
      id: "t3",
      meta: makeMeta({ agent: agent("thinking") }),
      glyph: "claude-code",
      pipVariant: "working",
      motion: "spin",
      shellLive: false,
      isLive: true,
      isFinished: false,
      attention: { klass: "working", live: true },
    });
    expect(d.countedWorking).toBe(true);
    expect(d.paintsBusy).toBe(true);
    expect(d.disagreement).toBeNull();
  });

  // The quiet form of cause 1: kolu is blind and the pip ISN'T busy either, so
  // nothing on screen looks wrong — but the terminal is working and no count
  // can see it. Worth flagging before it becomes a visible mismatch.
  it("flags a spinning stateless terminal even when the pip is not busy", () => {
    const d = attentionDiagnostic({
      id: "t4",
      meta: makeMeta({
        agent: null,
        foreground: { name: "codex", title: "⠹ building" },
      }),
      glyph: "shell",
      pipVariant: "idle",
      motion: "none",
      shellLive: false,
      isLive: false,
      isFinished: false,
      attention: { klass: "idle", live: false },
    });
    expect(d.paintsBusy).toBe(false);
    expect(d.countedWorking).toBe(false);
    expect(d.disagreement).toMatch(/counted only because bytes are moving/);
  });

  // A plain idle shell: no agent, no spinner, nothing flowing. Must stay quiet
  // or the dump drowns in noise from every ordinary terminal.
  it("stays silent on an ordinary idle shell", () => {
    const d = attentionDiagnostic({
      id: "t5",
      meta: makeMeta({ foreground: { name: "bash", title: null } }),
      glyph: "shell",
      pipVariant: "idle",
      motion: "none",
      shellLive: false,
      isLive: false,
      isFinished: false,
      attention: { klass: "idle", live: false },
    });
    expect(d.disagreement).toBeNull();
  });

  // The pureintent case: a violet mark still SPINNING after its turn ended.
  // The old diagnostic read only colour, called it not-busy, and cheerfully
  // reported agreement while the host tab counted nothing — a false green over
  // the exact bug being reported. Motion is now part of "paints busy", and
  // lingering is part of "counted", so this reads as agreement for the right
  // reason: both say active.
  it("counts a still-lingering agent as active, and sees its motion", () => {
    const d = attentionDiagnostic({
      id: "t6",
      meta: makeMeta({ agent: agent("waiting") }),
      glyph: "claude-code",
      pipVariant: "linger",
      motion: "spin",
      shellLive: false,
      isLive: false,
      isFinished: false,
      attention: { klass: "linger", live: false },
    });
    expect(d.paintsBusy).toBe(true);
    expect(d.countedWorking).toBe(true);
    expect(d.disagreement).toBeNull();
  });
});
