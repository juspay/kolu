import type { AwarenessValue, TerminalId } from "@kolu/arivu-contract";
import { describe, expect, it } from "vitest";
import type { FleetHostState } from "./fleetTypes.ts";
import {
  agentShortName,
  agentStatusLabel,
  agentTone,
  agentUrgency,
  dashRow,
  dashRows,
  formatAwarenessJson,
  formatFleetJson,
  prTone,
  projectFleet,
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
      id: { text: "a3f1c0de", tone: "plain" },
      repoBranch: { text: "kolu·feat/x", tone: "plain" },
      pr: { text: "#12 open ✓", tone: "pass" },
      agent: { text: "claude · awaiting", tone: "awaiting" },
      foreground: { text: "nvim", tone: "plain" },
      active: { text: "3s", tone: "muted" },
    });
  });
  it("dashes a terminal with no git", () => {
    const row = dashRow(id("b7"), val({ git: null }), NOW);
    expect(row.repoBranch.text).toBe("—");
  });
  it("sanitizes control bytes in repoName/branch (path-derived, can be hostile)", () => {
    const row = dashRow(
      id("c8"),
      val({
        git: {
          repoName: "ko\x1blu\n",
          branch: "fe\x00at\x07/x",
        } as AwarenessValue["git"],
      }),
      NOW,
    );
    // ESC/NUL/BEL/newline collapse to a space and the value is trimmed, so no
    // raw control byte reaches the painted cell.
    expect(row.repoBranch.text).toBe("ko lu·fe at /x");
    expect(row.repoBranch.text).not.toMatch(/[\x00-\x1f\x7f]/);
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
    expect(rows.map((r) => r.id.text)).toEqual(["a-1", "b-5", "c-9"]);
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

// ─── Fleet (PR2b) ────────────────────────────────────────────────────────────

const agentVal = (state: string): AwarenessValue["agent"] =>
  ({ kind: "claude-code", state }) as AwarenessValue["agent"];

function host(
  label: string,
  status: FleetHostState["status"],
  terminals: Record<string, AwarenessValue>,
): FleetHostState {
  return { label, status, terminals: terminals as FleetHostState["terminals"] };
}

describe("agentUrgency", () => {
  it("buckets awaiting → need, working → work, the rest → idle", () => {
    expect(agentUrgency(agentVal("awaiting_user"))).toBe("need");
    expect(agentUrgency(agentVal("thinking"))).toBe("work");
    expect(agentUrgency(agentVal("tool_use"))).toBe("work");
    expect(agentUrgency(agentVal("waiting"))).toBe("idle");
    expect(agentUrgency(agentVal("brand_new"))).toBe("idle");
    expect(agentUrgency(null)).toBe("idle");
  });
});

describe("projectFleet — host mode", () => {
  it("groups per host, floats needs-you first, and counts the summary", () => {
    const states = [
      host(
        "zest",
        { kind: "connected" },
        {
          [id("z-work")]: val({
            agent: agentVal("thinking"),
            lastActivityAt: NOW - 1_000,
          }),
          [id("z-need")]: val({
            agent: agentVal("awaiting_user"),
            lastActivityAt: NOW - 9_000,
          }),
          [id("z-idle")]: val({ agent: null, lastActivityAt: NOW - 60_000 }),
        },
      ),
      host("staging", { kind: "unreachable", reason: "ECONNREFUSED" }, {}),
    ];
    const view = projectFleet(states, NOW, "host");
    if (view.mode === "needs") throw new Error("unreachable");

    expect(view.groups.map((g) => g.label)).toEqual(["zest", "staging"]);
    // needs-you bubbles above the (more recent) working row.
    expect(view.groups[0]?.rows.map((r) => r.id)).toEqual([
      "z-need",
      "z-work",
      "z-idle",
    ]);
    expect(view.groups[0]?.rows[0]?.state.text).toBe("awaiting you");
    // the unreachable host is a distinct, empty group — never vanished.
    expect(view.groups[1]?.status).toEqual({
      kind: "unreachable",
      reason: "ECONNREFUSED",
    });
    expect(view.groups[1]?.rows).toEqual([]);

    expect(view.summary).toEqual({
      needYou: 1,
      working: 1,
      idle: 1,
      hostsDown: 1,
      hostsTotal: 2,
    });
    expect(view.alertHosts).toEqual(["zest"]);
  });

  it("keeps two hosts' identical terminal ids distinct (host, terminalId key)", () => {
    const states = [
      host(
        "a",
        { kind: "connected" },
        {
          [id("same")]: val({ agent: agentVal("thinking") }),
        },
      ),
      host(
        "b",
        { kind: "connected" },
        {
          [id("same")]: val({ agent: agentVal("awaiting_user") }),
        },
      ),
    ];
    const view = projectFleet(states, NOW, "host");
    if (view.mode === "needs") throw new Error("unreachable");
    expect(view.groups[0]?.rows).toHaveLength(1);
    expect(view.groups[1]?.rows).toHaveLength(1);
    expect(view.groups[0]?.rows[0]?.host).toBe("a");
    expect(view.groups[1]?.rows[0]?.host).toBe("b");
    expect(view.summary.needYou).toBe(1);
    expect(view.summary.working).toBe(1);
  });
});

describe("projectFleet — needs & agent modes", () => {
  const states = [
    host(
      "a",
      { kind: "connected" },
      {
        [id("a-idle")]: val({ agent: null }),
        [id("a-need")]: val({ agent: agentVal("awaiting_user") }),
      },
    ),
    host(
      "b",
      { kind: "connected" },
      {
        [id("b-work")]: val({ agent: agentVal("thinking") }),
      },
    ),
  ];

  it("needs mode flattens across hosts, urgency-sorted, no groups", () => {
    const view = projectFleet(states, NOW, "needs");
    // The view is a sum on `mode`: a needs view carries `flat` and has no
    // `groups` field at all (the type forbids reading it), so there is no dead
    // `[]` to assert against.
    expect(view.mode).toBe("needs");
    if (view.mode !== "needs") throw new Error("unreachable");
    expect(view.flat.map((r) => r.urgency)).toEqual(["need", "work", "idle"]);
    expect(view.flat.map((r) => r.host)).toEqual(["a", "b", "a"]);
  });

  it("agent mode groups into non-empty urgency sections across hosts", () => {
    const view = projectFleet(states, NOW, "agent");
    expect(view.mode).toBe("agent");
    if (view.mode === "needs") throw new Error("unreachable");
    expect(view.groups.map((g) => g.label)).toEqual([
      "awaiting you",
      "working",
      "idle",
    ]);
    expect(view.groups.every((g) => g.status === undefined)).toBe(true);
  });
});

describe("formatFleetJson", () => {
  it("flattens to { host, terminalId, ...value } and surfaces down hosts", () => {
    const out = formatFleetJson([
      {
        label: "a",
        kind: "ok",
        entries: [[id("t1"), val({ cwd: "/x" })]],
      },
      { label: "b", kind: "unreachable", reason: "timeout" },
    ]);
    const parsed = JSON.parse(out);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ host: "a", terminalId: "t1", cwd: "/x" });
    expect(parsed[1]).toEqual({
      host: "b",
      terminalId: null,
      unreachable: "timeout",
    });
  });
});
