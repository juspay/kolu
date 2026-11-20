import type { AttentionClass } from "@kolu/terminal-vocab/agentProjection";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import {
  ATTENTION_CLASSES,
  attentionCounted,
} from "@kolu/terminal-vocab/agentProjection";
import { describe, expect, it } from "vitest";
import {
  EMPTY_FRAME,
  type FrameClass,
  type HostAttentionFrame,
  hostActiveIds,
  isActive,
  scopeAttention,
  type TerminalAttention,
} from "./attention.ts";

const CLASSES: readonly AttentionClass[] = ATTENTION_CLASSES;

function oneTerminal(klass: AttentionClass, live: boolean): HostAttentionFrame {
  const id = "t1" as TerminalId;
  const liveIds = live ? [id] : [];
  if (klass === "idle") return { ...EMPTY_FRAME, liveIds };
  return {
    byClass: { ...EMPTY_FRAME.byClass, [klass satisfies FrameClass]: [id] },
    liveIds,
  };
}

describe("hostActiveIds ⇄ attentionCounted equivalence", () => {
  for (const klass of CLASSES) {
    for (const live of [false, true]) {
      it(`agrees for ${klass} ${live ? "with" : "without"} live output`, () => {
        const counted = hostActiveIds(oneTerminal(klass, live)).length === 1;
        expect(counted).toBe(attentionCounted(klass, live));
      });
    }
  }
});

describe("isActive", () => {
  it("a shell is active only while it prints", () => {
    expect(isActive({ klass: "idle", live: true })).toBe(true);
    expect(isActive({ klass: "idle", live: false })).toBe(false);
  });

  it("a working agent is active whether or not a byte moved", () => {
    expect(isActive({ klass: "working", live: false })).toBe(true);
  });

  it("a blocked agent is active — the glow channel", () => {
    expect(isActive({ klass: "asking", live: false })).toBe(true);
  });

  it("a finished turn stays active while it lingers, then stops", () => {
    expect(isActive({ klass: "linger", live: false })).toBe(true);
    expect(isActive({ klass: "finished", live: false })).toBe(false);
  });

  it("a finished agent that is still printing is active", () => {
    expect(isActive({ klass: "finished", live: true })).toBe(true);
  });
});

describe("hostActiveIds", () => {
  it("counts a still-lingering agent — the pip is still moving, so the tab says so", () => {
    const id = "settling" as TerminalId;
    const frame: HostAttentionFrame = {
      byClass: { ...EMPTY_FRAME.byClass, linger: [id] },
      liveIds: [],
    };
    expect(hostActiveIds(frame)).toEqual([id]);
  });

  it("counts a plain shell that is printing — no agent to ask, bytes are the evidence", () => {
    const frame: HostAttentionFrame = {
      byClass: {
        ...EMPTY_FRAME.byClass,
        working: ["a" as TerminalId, "b" as TerminalId],
      },
      liveIds: ["c" as TerminalId],
    };
    expect(hostActiveIds(frame)).toHaveLength(3);
  });

  it("counts a working agent once, not twice, when it is also printing", () => {
    const id = "busy" as TerminalId;
    const frame: HostAttentionFrame = {
      byClass: { ...EMPTY_FRAME.byClass, working: [id] },
      liveIds: [id],
    };
    expect(hostActiveIds(frame)).toEqual([id]);
  });

  it("leaves a blocked agent out — it is counted in violet, and never in both", () => {
    const id = "blocked" as TerminalId;
    const frame: HostAttentionFrame = {
      byClass: { ...EMPTY_FRAME.byClass, asking: [id] },
      liveIds: [id],
    };
    expect(hostActiveIds(frame)).toEqual([]);
  });

  it("drops a finished agent once its output stops", () => {
    const id = "done" as TerminalId;
    const finished = { ...EMPTY_FRAME.byClass, finished: [id] };
    expect(hostActiveIds({ byClass: finished, liveIds: [] })).toEqual([]);
    expect(hostActiveIds({ byClass: finished, liveIds: [id] })).toEqual([id]);
  });
});

describe("scopeAttention", () => {
  const attention =
    (map: Record<string, TerminalAttention>) => (id: TerminalId) =>
      map[id as string] ?? { klass: "idle" as const, live: false };

  it("counts activity on the same predicate the pips move on", () => {
    const attn = scopeAttention(
      ["a", "b", "c"] as TerminalId[],
      () => false,
      attention({
        a: { klass: "working", live: true },
        b: { klass: "linger", live: false },
        c: { klass: "idle", live: true },
      }),
    );
    expect(attn.activeIds).toEqual(["a", "b", "c"]);
    expect(attn.askingIds).toEqual([]);
    expect(attn.unseenIds).toEqual([]);
  });

  it("puts a blocked agent in the violet leg, never also in the rust one", () => {
    const attn = scopeAttention(
      ["a"] as TerminalId[],
      () => false,
      attention({ a: { klass: "asking", live: true } }),
    );
    expect(attn.activeIds).toEqual([]);
    expect(attn.askingIds).toEqual(["a"]);
  });

  it("counts unread independently — it is the badge axis, not the colour axis", () => {
    const attn = scopeAttention(
      ["a"] as TerminalId[],
      () => true,
      attention({ a: { klass: "working", live: true } }),
    );
    expect(attn.activeIds).toEqual(["a"]);
    expect(attn.unseenIds).toEqual(["a"]);
  });

  it("returns the ids it counted, so a capsule's click reaches what its number promised", () => {
    const attn = scopeAttention(
      ["parked-blocked", "split-agent"] as TerminalId[],
      () => false,
      attention({
        "parked-blocked": { klass: "asking", live: false },
        "split-agent": { klass: "working", live: true },
      }),
    );
    expect(attn.askingIds).toEqual(["parked-blocked"]);
    expect(attn.activeIds).toEqual(["split-agent"]);
  });
});
