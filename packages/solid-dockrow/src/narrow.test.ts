import {
  isPipGlyphId,
  isPipMotionKind,
  isPipVariant,
  PIP_GLYPH_IDS,
  PIP_MOTION_KINDS,
  PIP_VARIANTS,
} from "@kolu/solid-statepip/pipVariant";
import type { TerminalMetadata } from "@kolu/padi-client/vocab";
import { describe, expect, it } from "vitest";
import {
  DOCK_ROW_BUCKETS,
  isDockRowBucket,
  isRecencyMode,
  isRowAgentState,
  narrowAgentState,
  narrowRowVocab,
  RECENCY_MODES,
  ROW_AGENT_STATES,
  toWireRowVocab,
} from "./narrow.ts";

describe("every closed set the prop bag names is enumerable and guarded", () => {
  const sets = [
    { name: "agent state", all: ROW_AGENT_STATES, is: isRowAgentState },
    { name: "row bucket", all: DOCK_ROW_BUCKETS, is: isDockRowBucket },
    { name: "recency mode", all: RECENCY_MODES, is: isRecencyMode },
    { name: "pip variant", all: PIP_VARIANTS, is: isPipVariant },
    { name: "pip motion", all: PIP_MOTION_KINDS, is: isPipMotionKind },
    { name: "pip glyph", all: PIP_GLYPH_IDS, is: isPipGlyphId },
  ] as const;

  for (const set of sets) {
    it(`${set.name}: the guard admits every member and nothing else`, () => {
      expect(set.all.length).toBeGreaterThan(0);
      for (const member of set.all) expect(set.is(member)).toBe(true);
      expect(set.is("definitely-not-a-member")).toBe(false);
      expect(set.is("toString")).toBe(false);
      expect(set.is("constructor")).toBe(false);
    });
  }
});

describe("narrowAgentState", () => {
  it("hands back the typed literal and its label for a state we know", () => {
    expect(narrowAgentState("awaiting_user")).toEqual({
      state: "awaiting_user",
      attr: "awaiting_user",
      label: "Awaiting input",
      known: true,
    });
  });

  it("reads a null/absent wire value as 'no agent', not as an unknown state", () => {
    for (const absent of [null, undefined, ""]) {
      expect(narrowAgentState(absent)).toEqual({
        state: undefined,
        attr: undefined,
        label: "",
        known: true,
      });
    }
  });

  it("keeps an unrecognised state VISIBLE and withholds only the typed literal", () => {
    const out = narrowAgentState("compacting_context");
    expect(out.state).toBeUndefined();
    expect(out.attr).toBe("compacting_context");
    expect(out.label).toBe("compacting_context");
    expect(out.known).toBe(false);
  });

  it("never reports an unrecognised state as known", () => {
    for (const raw of ["", "thinking", "toString", "banana"]) {
      expect(narrowAgentState(raw).known).toBe(
        isRowAgentState(raw) || raw === "",
      );
    }
  });
});

function shellMeta(): TerminalMetadata {
  return {
    state: "active",
    cwd: "/work/repo",
    git: { kind: "none" },
    location: { kind: "local" },
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
    lastActivityAt: 1,
  } as TerminalMetadata;
}

describe("narrowRowVocab — the guards WITH their defaults", () => {
  const wire = () => ({
    pip: {
      variant: "working",
      glyph: "claude-code",
      hasAgent: true,
      active: true,
      asking: false,
      bytesLive: true,
      sleeping: false,
      alert: false,
      alertLabel: "unread alert",
    },
    bucket: "working",
  });

  const carried = () => {
    const { hasAgent: _hasAgent, ...rest } = wire().pip;
    return rest;
  };

  it("passes a known row through unchanged, and folds the two derived members", () => {
    const n = narrowRowVocab(wire());
    expect(n.pip).toEqual({ ...carried(), motion: "spin", shellLive: false });
    expect(n.bucket).toBe("working");
    expect(n.known).toBe(true);
  });

  it.each([
    { field: "variant", fallback: "idle" },
    { field: "glyph", fallback: "shell" },
    { field: "bucket", fallback: "idle" },
  ] as const)("an unknown $field falls back to $fallback AND keeps the word", ({
    field,
    fallback,
  }) => {
    const w = wire();
    if (field === "bucket") w.bucket = "sideways";
    else w.pip[field] = "sideways";
    const n = narrowRowVocab(w);
    const got = field === "bucket" ? n.bucket : n.pip[field];
    expect(got).toBe(fallback);
    expect(n.known).toBe(false);
    if (!n.known) expect(n.unrecognised[field]).toBe("sideways");
  });

  it("FOLDS the motion rather than transporting it — always, not only on a miss", () => {
    expect(narrowRowVocab(wire()).pip.motion).toBe("spin");

    const asking = narrowRowVocab({
      ...wire(),
      pip: { ...wire().pip, variant: "awaiting" },
    });
    expect(asking.pip.motion).toBe("glow");

    const still = narrowRowVocab({
      ...wire(),
      pip: { ...wire().pip, active: false },
    });
    expect(still.pip.motion).toBe("none");

    const strange = narrowRowVocab({
      ...wire(),
      pip: { ...wire().pip, variant: "sideways" },
    });
    expect(strange.pip.variant).toBe("idle");
    expect(strange.pip.motion).toBe("spin");
  });

  it("FOLDS shellLive too — the bag's OTHER variant-derived member", () => {
    const quietShell = narrowRowVocab({
      ...wire(),
      pip: { ...wire().pip, variant: "idle", hasAgent: false, bytesLive: true },
    });
    expect(quietShell.pip.shellLive).toBe(true);

    const driven = narrowRowVocab({
      ...wire(),
      pip: { ...wire().pip, variant: "idle", hasAgent: true, bytesLive: true },
    });
    expect(driven.pip.shellLive).toBe(false);

    const strange = narrowRowVocab({
      ...wire(),
      pip: {
        ...wire().pip,
        variant: "sideways",
        hasAgent: false,
        bytesLive: true,
      },
    });
    expect(strange.pip.shellLive).toBe(true);
  });

  it("round-trips a bound bag through toWireRowVocab, deriving both members back", () => {
    const bag = {
      variant: "idle" as const,
      glyph: "shell" as const,
      motion: "spin" as const,
      active: true,
      asking: false,
      bytesLive: true,
      shellLive: true,
      sleeping: false,
      alert: false,
      alertLabel: "unread alert",
    };
    const sent = toWireRowVocab({
      pip: bag,
      bucket: "idle",
      meta: shellMeta(),
    });
    expect(sent.pip).not.toHaveProperty("motion");
    expect(sent.pip).not.toHaveProperty("shellLive");
    expect(sent.pip.hasAgent).toBe(false);
    const back = narrowRowVocab(sent);
    expect(back.pip.motion).toBe("spin");
    expect(back.pip.shellLive).toBe(true);
    expect(back.known).toBe(true);
  });

  it("never derives the ORDER bucket from the PAINT variant — they disagree", () => {
    const n = narrowRowVocab({
      pip: { ...wire().pip, variant: "linger" },
      bucket: "idle",
    });
    expect(n.pip.variant).toBe("linger");
    expect(n.bucket).toBe("idle");
    expect(n.known).toBe(true);
  });

  it("treats an inherited property name as the stranger it is", () => {
    const n = narrowRowVocab({
      pip: { ...wire().pip, glyph: "toString" },
      bucket: "constructor",
    });
    expect(n.pip.glyph).toBe("shell");
    expect(n.bucket).toBe("idle");
    expect(n.known).toBe(false);
    if (!n.known)
      expect(n.unrecognised).toEqual({
        glyph: "toString",
        bucket: "constructor",
      });
  });
});
