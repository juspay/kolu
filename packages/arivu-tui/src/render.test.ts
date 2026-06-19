import type { AwarenessValue, TerminalId } from "@kolu/arivu-contract";
import { describe, expect, it } from "vitest";
import {
  agentShortName,
  agentStatusLabel,
  formatAwarenessJson,
  formatAwarenessList,
  resolveTerminalId,
  shortId,
} from "./render.ts";

/** A seed awareness value; `over` patches the fields a case cares about. The
 *  agent/pr/git sub-shapes are cast — render only reads a few fields of each,
 *  and these tests exercise rendering, not schema validity. */
function val(over: Partial<AwarenessValue>): AwarenessValue {
  return {
    cwd: "/repo",
    git: null,
    lastActivityAt: 0,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
    ...over,
  };
}

const id = (s: string): TerminalId => s as TerminalId;

describe("agentStatusLabel", () => {
  it("buckets working / awaiting / waiting", () => {
    expect(agentStatusLabel("thinking")).toBe("working");
    expect(agentStatusLabel("tool_use")).toBe("working");
    expect(agentStatusLabel("running_background")).toBe("working");
    expect(agentStatusLabel("awaiting_user")).toBe("awaiting");
    expect(agentStatusLabel("waiting")).toBe("waiting");
  });
  it("falls through unknown states verbatim", () => {
    expect(agentStatusLabel("brand_new_state")).toBe("brand_new_state");
  });
});

describe("agentShortName", () => {
  it("shortens claude-code to claude, leaves others", () => {
    expect(agentShortName("claude-code")).toBe("claude");
    expect(agentShortName("codex")).toBe("codex");
    expect(agentShortName("opencode")).toBe("opencode");
  });
});

describe("formatAwarenessList", () => {
  it("honest one-liner when empty", () => {
    expect(formatAwarenessList([])).toContain("no terminals");
  });

  it("renders branch · PR(+checks) · agent · foreground, one row per terminal", () => {
    const out = formatAwarenessList([
      [
        id("a3f10000-0000-4000-8000-000000000000"),
        val({
          git: { branch: "feat/dial-ssh" } as AwarenessValue["git"],
          pr: {
            kind: "ok",
            value: { number: 1412, checks: "pass" },
          } as AwarenessValue["pr"],
          agent: {
            kind: "claude-code",
            state: "thinking",
          } as AwarenessValue["agent"],
          foreground: { name: "node", title: null },
        }),
      ],
      [
        id("c9d40000-0000-4000-8000-000000000000"),
        val({
          git: { branch: "fix/fold" } as AwarenessValue["git"],
          pr: {
            kind: "ok",
            value: { number: 1408, checks: "fail" },
          } as AwarenessValue["pr"],
          agent: null,
          foreground: { name: "nvim", title: null },
        }),
      ],
    ]);
    expect(out).toContain("ID");
    expect(out).toContain("BRANCH");
    expect(out).toContain("feat/dial-ssh");
    expect(out).toContain("#1412 ✓");
    expect(out).toContain("claude · working");
    expect(out).toContain("node");
    expect(out).toContain("fix/fold");
    expect(out).toContain("#1408 ✗");
    expect(out).toContain("nvim");
    // The second row has no agent → a dash.
    expect(out).toContain("—");
    // shortId is the first 8 chars.
    expect(out).toContain("a3f10000");
    expect(out).toContain("c9d40000");
  });

  it("dashes a terminal with no git / no PR", () => {
    const out = formatAwarenessList([[id("b7c2"), val({})]]);
    // branch, pr, agent, foreground all dash.
    expect(out.match(/—/g)?.length).toBeGreaterThanOrEqual(4);
  });
});

describe("formatAwarenessJson", () => {
  it("is a top-level array of { id, ...value } with the full id", () => {
    const full = id("a3f10000-0000-4000-8000-000000000000");
    const parsed = JSON.parse(
      formatAwarenessJson([[full, val({ cwd: "/x" })]]),
    ) as Array<{ id: string; cwd: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe(full);
    expect(parsed[0]?.cwd).toBe("/x");
  });
});

describe("resolveTerminalId", () => {
  const ids = [
    "a3f10000-1111-4000-8000-000000000000",
    "b7c20000-2222-4000-8000-000000000000",
  ];
  it("resolves a unique prefix", () => {
    expect(resolveTerminalId("a3f1", ids)).toEqual({
      kind: "found",
      id: ids[0],
    });
  });
  it("resolves a full id to itself", () => {
    expect(resolveTerminalId(ids[1]!, ids)).toEqual({
      kind: "found",
      id: ids[1],
    });
  });
  it("reports no match", () => {
    expect(resolveTerminalId("zzzz", ids)).toEqual({ kind: "none" });
  });
  it("rejects the empty query (a prefix of everything)", () => {
    expect(resolveTerminalId("", ids)).toEqual({ kind: "none" });
  });
  it("reports ambiguity with the matches", () => {
    const r = resolveTerminalId("", ["aa", "ab"]); // empty → none, not ambiguous
    expect(r.kind).toBe("none");
    const amb = resolveTerminalId("a", ["aa11", "ab22"]);
    expect(amb.kind).toBe("ambiguous");
  });
  it("shortId takes the first 8 chars", () => {
    expect(shortId("a3f10000-1111")).toBe("a3f10000");
  });
});
