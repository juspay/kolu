import type { AwarenessValue, TerminalId } from "@kolu/arivu-contract";
import { describe, expect, it } from "vitest";
import {
  agentShortName,
  agentStatusLabel,
  agentTone,
  fieldRows,
  formatAwarenessJson,
  formatAwarenessList,
  prTone,
  recordHeader,
  relativeTime,
  resolveTerminalId,
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
  };
}

const id = (s: string): TerminalId => s as TerminalId;
const NOW = 1_700_000_000_000;

const ALL_LABELS = [
  "agent",
  "pr",
  "branch",
  "repo",
  "remote",
  "foreground",
  "title",
  "agent cmd",
  "active",
];

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

describe("relativeTime", () => {
  it("renders compact ages and dashes a 0 (never active)", () => {
    expect(relativeTime(0, NOW)).toBe("—");
    expect(relativeTime(NOW - 5_000, NOW)).toBe("5s");
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe("5m");
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3h");
    expect(relativeTime(NOW - 2 * 86_400_000, NOW)).toBe("2d");
  });
});

describe("formatAwarenessList", () => {
  it("honest one-liner when empty", () => {
    expect(formatAwarenessList([])).toContain("no terminals");
  });

  it("renders a vertical record surfacing EVERY awareness field", () => {
    const out = formatAwarenessList(
      [
        [
          id("a3f10000-0000-4000-8000-000000000000"),
          val({
            cwd: "/home/u/code/kolu",
            git: {
              branch: "feat/dial-ssh",
              repoName: "kolu",
              remoteUrl: "https://github.com/juspay/kolu",
            } as AwarenessValue["git"],
            lastActivityAt: NOW - 3 * 60_000,
            lastAgentCommand: "claude --model sonnet",
            pr: {
              kind: "ok",
              value: { number: 1412, state: "open", checks: "pass" },
            } as AwarenessValue["pr"],
            agent: {
              kind: "claude-code",
              state: "thinking",
            } as AwarenessValue["agent"],
            foreground: { name: "node", title: "claude: implement X" },
          }),
        ],
      ],
      { home: "/home/u", now: NOW },
    );
    // header line: short id + tildeified cwd
    expect(out).toContain("a3f10000  ~/code/kolu");
    // a labeled line per field
    for (const label of ALL_LABELS) expect(out).toContain(label);
    expect(out).toContain("claude · working"); // agent
    expect(out).toContain("#1412 open ✓"); // pr (number · state · checks)
    expect(out).toContain("kolu"); // repo
    expect(out).toContain("feat/dial-ssh"); // branch
    expect(out).toContain("github.com/juspay/kolu"); // remote
    expect(out).toContain("3m"); // active
    expect(out).toContain("node"); // foreground
    expect(out).toContain("claude: implement X"); // title
    expect(out).toContain("claude --model sonnet"); // agent cmd
  });

  it("dashes unresolved fields but keeps every label", () => {
    const out = formatAwarenessList([[id("b7c2"), val({})]], { now: NOW });
    expect(out).toContain("b7c2  /repo"); // header still shows the cwd
    for (const label of ALL_LABELS) expect(out).toContain(label);
    expect(out).toContain("pending"); // pr pending
    // agent · branch · repo · remote · foreground · title · agent-cmd · active
    expect(out.match(/—/g)?.length).toBeGreaterThanOrEqual(8);
  });

  it("separates multiple terminals with a blank line", () => {
    const out = formatAwarenessList(
      [
        [id("aaaa1111-0000-4000-8000-000000000000"), val({})],
        [id("bbbb2222-0000-4000-8000-000000000000"), val({})],
      ],
      { now: NOW },
    );
    expect(out).toContain("\n\n");
    expect(out).toContain("aaaa1111");
    expect(out).toContain("bbbb2222");
  });

  it("renders each PR arm", () => {
    const pr = (p: AwarenessValue["pr"]) =>
      formatAwarenessList([[id("a"), val({ pr: p })]], { now: NOW });
    expect(
      pr({
        kind: "ok",
        value: { number: 7, state: "merged", checks: "fail" },
      } as AwarenessValue["pr"]),
    ).toContain("#7 merged ✗");
    expect(pr({ kind: "pending" })).toContain("pending");
    expect(
      pr({
        kind: "unavailable",
        source: { provider: "gh", code: "not-logged-in" },
      } as unknown as AwarenessValue["pr"]),
    ).toContain("unavailable: not-logged-in");
  });
});

describe("formatAwarenessJson", () => {
  it("is a top-level array of { id, ...value } with the full id + raw value", () => {
    const full = id("a3f10000-0000-4000-8000-000000000000");
    const parsed = JSON.parse(
      formatAwarenessJson([
        [full, val({ cwd: "/x", lastAgentCommand: "codex" })],
      ]),
    ) as Array<{ id: string; cwd: string; lastAgentCommand: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe(full);
    expect(parsed[0]?.cwd).toBe("/x");
    expect(parsed[0]?.lastAgentCommand).toBe("codex");
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
    const amb = resolveTerminalId("a", ["aa11", "ab22"]);
    expect(amb.kind).toBe("ambiguous");
  });
  it("shortId takes the first 8 chars", () => {
    expect(shortId("a3f10000-1111")).toBe("a3f10000");
  });
});

describe("agentTone", () => {
  it("maps the bucketed agent state to a semantic tone", () => {
    expect(agentTone({ state: "thinking" } as AwarenessValue["agent"])).toBe(
      "working",
    );
    expect(
      agentTone({ state: "awaiting_user" } as AwarenessValue["agent"]),
    ).toBe("awaiting");
    expect(agentTone({ state: "waiting" } as AwarenessValue["agent"])).toBe(
      "idle",
    );
  });
  it("is muted when there is no agent", () => {
    expect(agentTone(null)).toBe("muted");
  });
});

describe("prTone", () => {
  it("colours by checks when the PR resolved", () => {
    const ok = (checks: string): AwarenessValue["pr"] =>
      ({ kind: "ok", value: { number: 1, state: "open", checks } }) as never;
    expect(prTone(ok("pass"))).toBe("pass");
    expect(prTone(ok("fail"))).toBe("fail");
    expect(prTone(ok("pending"))).toBe("pending");
  });
  it("is muted for any unresolved PR arm", () => {
    expect(prTone({ kind: "pending" })).toBe("muted");
    expect(prTone({ kind: "absent" } as AwarenessValue["pr"])).toBe("muted");
  });
});

describe("fieldRows", () => {
  it("projects every field, in the same order as the text record", () => {
    const rows = fieldRows(val({}), NOW);
    expect(rows.map((r) => r.label)).toEqual(ALL_LABELS);
  });
  it("carries a live tone on agent + pr, and the value text matches the record", () => {
    const rows = fieldRows(
      val({
        agent: { kind: "claude-code", state: "awaiting_user" } as never,
        pr: {
          kind: "ok",
          value: { number: 12, state: "open", checks: "fail" },
        } as never,
      }),
      NOW,
    );
    const agent = rows.find((r) => r.label === "agent");
    const pr = rows.find((r) => r.label === "pr");
    expect(agent?.tone).toBe("awaiting");
    expect(agent?.value).toBe("claude · awaiting");
    expect(pr?.tone).toBe("fail");
    expect(pr?.value).toContain("#12");
  });
});

describe("recordHeader", () => {
  it("is the short id and the tildeified cwd", () => {
    const head = recordHeader(
      id("a3f10000-xyz"),
      val({ cwd: "/home/u/p" }),
      "/home/u",
    );
    expect(head.id).toBe("a3f10000");
    expect(head.cwd).toBe("~/p");
  });
});
