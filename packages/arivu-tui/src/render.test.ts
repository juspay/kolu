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
  live: string[] = [],
): FleetHostState {
  return {
    label,
    status,
    terminals: terminals as FleetHostState["terminals"],
    live,
  };
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
    const view = projectFleet(states, "host");
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

  it("marks a row live iff its terminal is in the host's activity set", () => {
    const states = [
      host(
        "zest",
        { kind: "connected" },
        {
          [id("z-loud")]: val({ agent: agentVal("thinking") }),
          [id("z-quiet")]: val({ agent: agentVal("thinking") }),
        },
        // Only z-loud is moving bytes right now (the `activity` stream frame).
        [id("z-loud")],
      ),
    ];
    const view = projectFleet(states, "host");
    if (view.mode === "needs") throw new Error("unreachable");
    const rows = view.groups[0]?.rows ?? [];
    const live = new Map(rows.map((r) => [r.id, r.live]));
    expect(live.get("z-loud")).toBe(true);
    expect(live.get("z-quiet")).toBe(false);
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
    const view = projectFleet(states, "host");
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
    const view = projectFleet(states, "needs");
    // The view is a sum on `mode`: a needs view carries `flat` and has no
    // `groups` field at all (the type forbids reading it), so there is no dead
    // `[]` to assert against.
    expect(view.mode).toBe("needs");
    if (view.mode !== "needs") throw new Error("unreachable");
    expect(view.flat.map((r) => r.urgency)).toEqual(["need", "work", "idle"]);
    expect(view.flat.map((r) => r.host)).toEqual(["a", "b", "a"]);
  });

  it("agent mode groups into non-empty urgency sections across hosts", () => {
    const view = projectFleet(states, "agent");
    expect(view.mode).toBe("agent");
    if (view.mode === "needs") throw new Error("unreachable");
    expect(view.groups.map((g) => g.label)).toEqual([
      "awaiting you",
      "working",
      "idle",
    ]);
    expect(view.groups.every((g) => g.status === undefined)).toBe(true);
  });

  it("needs mode tiebreaks the whole fleet by recency then id, not host order", () => {
    // Two hosts, two equally-urgent (working) terminals. The fleet-wide order
    // must put the more-recently-active one first regardless of host iteration
    // order — the tiebreak the per-host sort defines, kept once the scope is the
    // whole fleet.
    const fleet = [
      host(
        "alpha",
        { kind: "connected" },
        {
          [id("a-stale")]: val({
            agent: agentVal("thinking"),
            lastActivityAt: NOW - 60_000,
          }),
        },
      ),
      host(
        "beta",
        { kind: "connected" },
        {
          [id("b-fresh")]: val({
            agent: agentVal("thinking"),
            lastActivityAt: NOW - 1_000,
          }),
        },
      ),
    ];
    const view = projectFleet(fleet, "needs");
    if (view.mode !== "needs") throw new Error("unreachable");
    // beta's fresher row leads even though alpha is the first host.
    expect(view.flat.map((r) => r.id)).toEqual(["b-fresh", "a-stale"]);
  });

  it("agent mode tiebreaks within a section by recency, not host order", () => {
    const fleet = [
      host(
        "alpha",
        { kind: "connected" },
        {
          [id("a-stale")]: val({
            agent: agentVal("awaiting_user"),
            lastActivityAt: NOW - 60_000,
          }),
        },
      ),
      host(
        "beta",
        { kind: "connected" },
        {
          [id("b-fresh")]: val({
            agent: agentVal("awaiting_user"),
            lastActivityAt: NOW - 1_000,
          }),
        },
      ),
    ];
    const view = projectFleet(fleet, "agent");
    if (view.mode === "needs") throw new Error("unreachable");
    const awaiting = view.groups.find((g) => g.label === "awaiting you");
    expect(awaiting?.rows.map((r) => r.id)).toEqual(["b-fresh", "a-stale"]);
  });
});

describe("projectFleet — terminal-safety", () => {
  it("strips control bytes from host labels and unreachable reasons", () => {
    const states = [
      host("ze\x1bst\n", { kind: "connected" }, {}),
      host(
        "ba\x07d",
        { kind: "unreachable", reason: "ssh: bad\x1b]0;hijack\x07\nstderr" },
        {},
      ),
    ];
    const view = projectFleet(states, "host");
    if (view.mode === "needs") throw new Error("unreachable");
    // No raw control byte reaches the painted group label or the reason.
    for (const g of view.groups) {
      expect(g.label).not.toMatch(/[\x00-\x1f\x7f]/);
      if (g.status?.kind === "unreachable") {
        expect(g.status.reason).not.toMatch(/[\x00-\x1f\x7f]/);
      }
    }
    expect(view.alertHosts.join("")).not.toMatch(/[\x00-\x1f\x7f]/);
  });

  it("strips control bytes from the row host cell in needs mode", () => {
    const states = [
      host(
        "ho\x1bst",
        { kind: "connected" },
        { [id("t")]: val({ agent: agentVal("thinking") }) },
      ),
    ];
    const view = projectFleet(states, "needs");
    if (view.mode !== "needs") throw new Error("unreachable");
    expect(view.flat[0]?.host).not.toMatch(/[\x00-\x1f\x7f]/);
  });

  it("keeps distinct hosts that sanitize to the same display string in separate buckets", () => {
    // `a\nb` and `a b` both sanitize to `a b`, but they are DISTINCT hosts.
    // Sanitization is display-only; it must not merge identities, or one host's
    // terminals would leak into the other's group.
    const states = [
      host(
        "a\nb",
        { kind: "connected" },
        { [id("t-newline")]: val({ agent: agentVal("thinking") }) },
      ),
      host(
        "a b",
        { kind: "connected" },
        { [id("t-space")]: val({ agent: agentVal("awaiting_user") }) },
      ),
    ];
    const view = projectFleet(states, "host");
    if (view.mode === "needs") throw new Error("unreachable");
    // Two distinct groups, each with ONLY its own terminal — never merged. Use
    // `sortId` (the full id), since `id` is the shortened display form.
    expect(view.groups).toHaveLength(2);
    expect(view.groups[0]?.rows.map((r) => r.sortId)).toEqual(["t-newline"]);
    expect(view.groups[1]?.rows.map((r) => r.sortId)).toEqual(["t-space"]);
    // Both paint the same sanitized label, but their rows stayed distinct.
    expect(view.groups[0]?.label).toBe("a b");
    expect(view.groups[1]?.label).toBe("a b");
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

  it("tags a skewed host's rows with the version mismatch", () => {
    const out = formatFleetJson([
      {
        label: "old",
        kind: "skew",
        localVersion: "0.1",
        hostVersion: "9.9",
        entries: [[id("t1"), val({ cwd: "/x" })]],
      },
    ]);
    const parsed = JSON.parse(out);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      host: "old",
      terminalId: "t1",
      skew: { localVersion: "0.1", hostVersion: "9.9" },
    });
  });

  it("emits a skew sentinel for a skewed host with no terminals", () => {
    // A row-less skewed host must still surface its skew — otherwise an empty
    // skewed box is indistinguishable from an absent one in JSON, even though
    // the live board shows its skew header.
    const out = formatFleetJson([
      {
        label: "old",
        kind: "skew",
        localVersion: "0.1",
        hostVersion: "9.9",
        entries: [],
      },
    ]);
    const parsed = JSON.parse(out);
    expect(parsed).toEqual([
      {
        host: "old",
        terminalId: null,
        skew: { localVersion: "0.1", hostVersion: "9.9" },
      },
    ]);
  });
});
