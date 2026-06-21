import type { AwarenessValue, TerminalId } from "@kolu/arivu-contract";
import { describe, expect, it } from "vitest";
import {
  agentShortName,
  agentStatusLabel,
  agentTone,
  dashRow,
  dashRows,
  formatAwarenessJson,
  prTone,
  relativeTime,
  shortId,
} from "./render.ts";

/** A seed awareness value; `over` patches the fields a case cares about. The
 *  git/pr/agent sub-shapes are cast — render only reads a few fields of each,
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
  } as AwarenessValue;
}

const id = (s: string): TerminalId => s as TerminalId;
const NOW = 1_700_000_000_000;

describe("shortId", () => {
  it("keeps the leading 8 chars", () => {
    expect(shortId("a3f1c0de-1234-5678")).toBe("a3f1c0de");
    expect(shortId("abc")).toBe("abc");
  });
});

describe("relativeTime", () => {
  it("renders compact ages and dashes a 0 (never active)", () => {
    expect(relativeTime(0, NOW)).toBe("—");
    expect(relativeTime(NOW - 5_000, NOW)).toBe("5s");
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe("5m");
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3h");
    expect(relativeTime(NOW - 2 * 86_400_000, NOW)).toBe("2d");
  });
});

describe("agentShortName", () => {
  it("shortens claude-code to claude, leaves others", () => {
    expect(agentShortName("claude-code")).toBe("claude");
    expect(agentShortName("codex")).toBe("codex");
    expect(agentShortName("opencode")).toBe("opencode");
  });
});

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

describe("agentTone", () => {
  const agent = (state: string): AwarenessValue["agent"] =>
    ({ kind: "claude-code", state }) as AwarenessValue["agent"];
  it("tones by bucket; no agent is muted, unknown is plain", () => {
    expect(agentTone(null)).toBe("muted");
    expect(agentTone(agent("thinking"))).toBe("working");
    expect(agentTone(agent("awaiting_user"))).toBe("awaiting");
    expect(agentTone(agent("waiting"))).toBe("idle");
    expect(agentTone(agent("??"))).toBe("plain");
  });
});

describe("prTone", () => {
  const ok = (checks: string): AwarenessValue["pr"] =>
    ({
      kind: "ok",
      value: { number: 1, state: "open", checks },
    }) as AwarenessValue["pr"];
  it("tones a resolved PR by its checks", () => {
    expect(prTone(ok("pass"))).toBe("pass");
    expect(prTone(ok("fail"))).toBe("fail");
    expect(prTone(ok("pending"))).toBe("pending");
  });
  it("folds null checks (no checks configured) to pending", () => {
    expect(
      prTone({
        kind: "ok",
        value: { number: 1, state: "open", checks: null },
      } as AwarenessValue["pr"]),
    ).toBe("pending");
  });
  it("mutes anything unresolved", () => {
    expect(prTone({ kind: "pending" } as AwarenessValue["pr"])).toBe("muted");
    expect(prTone({ kind: "absent" } as AwarenessValue["pr"])).toBe("muted");
    expect(
      prTone({
        kind: "unavailable",
        source: { provider: "gh", code: "not-authenticated" },
      } as AwarenessValue["pr"]),
    ).toBe("muted");
  });
});

describe("dashRow", () => {
  it("projects the dashboard columns with tones", () => {
    const row = dashRow(
      id("a3f1c0de-xyz"),
      val({
        git: { repoName: "kolu", branch: "feat/x" } as AwarenessValue["git"],
        pr: {
          kind: "ok",
          value: { number: 12, state: "open", checks: "pass" },
        } as AwarenessValue["pr"],
        agent: {
          kind: "claude-code",
          state: "awaiting_user",
        } as AwarenessValue["agent"],
        foreground: {
          name: "nvim",
          title: "x",
        } as AwarenessValue["foreground"],
        lastActivityAt: NOW - 3_000,
      }),
      NOW,
    );
    expect(row).toEqual({
      id: "a3f1c0de",
      repoBranch: "kolu·feat/x",
      pr: { text: "#12 open ✓", tone: "pass" },
      agent: { text: "claude · awaiting", tone: "awaiting" },
      foreground: "nvim",
      active: "3s",
    });
  });
  it("dashes a terminal with no git", () => {
    const row = dashRow(id("b7"), val({ git: null }), NOW);
    expect(row.repoBranch).toBe("—");
  });
});

describe("dashRows", () => {
  it("sorts by id and projects each", () => {
    const rows = dashRows(
      [
        [id("c-9"), val({})],
        [id("a-1"), val({})],
        [id("b-5"), val({})],
      ],
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(["a-1", "b-5", "c-9"]);
  });
});

describe("formatAwarenessJson", () => {
  it("emits a top-level array of { id, ...value }, full ids, valid JSON", () => {
    const out = formatAwarenessJson([[id("full-id-1234"), val({ cwd: "/x" })]]);
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe("full-id-1234");
    expect(parsed[0].cwd).toBe("/x");
  });
  it("honest empty array when there are no terminals", () => {
    expect(JSON.parse(formatAwarenessJson([]))).toEqual([]);
  });
});
