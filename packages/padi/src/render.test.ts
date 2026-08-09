import type { PadiTerminal } from "./surface.ts";
import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { WAIT_STATES } from "./dial.ts";
import { formatStatus, parseUntilStates, resolveTerminalId } from "./render.ts";

/** A minimal `active` composed record — the agent the wait predicate reads plus
 *  the git/pr/foreground the status table renders. Cast because the full
 *  `ActiveTerminalSchema` is large and these are the only fields under test. */
function activeWithAgent(agent: AgentInfo | null): PadiTerminal {
  return {
    state: "active",
    agent,
    git: null,
    pr: { kind: "pending" },
    foreground: null,
  } as unknown as PadiTerminal;
}

const claude = (state: AgentInfo["state"]): AgentInfo =>
  ({ kind: "claude-code", state }) as AgentInfo;

describe("parseUntilStates — the --until bucket parse", () => {
  it("accepts a comma list of valid buckets, trimmed + deduped", () => {
    const r = parseUntilStates(" awaiting , waiting , awaiting ");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok")
      expect([...r.targets].sort()).toEqual(["awaiting", "waiting"]);
  });

  it("accepts each single bucket", () => {
    for (const s of WAIT_STATES) {
      expect(parseUntilStates(s).kind).toBe("ok");
    }
  });

  it("rejects an unknown bucket, naming it (fail-fast, no silent drop)", () => {
    const r = parseUntilStates("awaiting,idle");
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("idle");
  });

  it("rejects an empty list", () => {
    expect(parseUntilStates("").kind).toBe("error");
    expect(parseUntilStates("  ,  ").kind).toBe("error");
  });
});

describe("resolveTerminalId — prefix resolution", () => {
  const ids = [
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
    "2233aaaa-0000-0000-0000-000000000000",
  ];

  it("resolves a unique prefix", () => {
    expect(resolveTerminalId("1111", ids)).toEqual({
      kind: "found",
      id: ids[0],
    });
  });

  it("prefers an exact full id over a longer id sharing its prefix", () => {
    const withLonger = [...ids, "1111"];
    // "1111" is an exact match AND a prefix of ids[0] — exact wins.
    expect(resolveTerminalId("1111", withLonger)).toEqual({
      kind: "found",
      id: "1111",
    });
  });

  it("is case-insensitive", () => {
    expect(resolveTerminalId("2233AAAA", ids)).toEqual({
      kind: "found",
      id: ids[2],
    });
  });

  it("reports ambiguity with the matches", () => {
    const r = resolveTerminalId("22", ids);
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.matches).toHaveLength(2);
  });

  it("rejects an empty query as no-match (never silently the sole terminal)", () => {
    expect(resolveTerminalId("", ids)).toEqual({ kind: "none" });
  });

  it("reports no match for an unknown prefix", () => {
    expect(resolveTerminalId("ffff", ids)).toEqual({ kind: "none" });
  });
});

describe("formatStatus — the human table", () => {
  it("renders an honest one-liner for an empty fleet", () => {
    expect(formatStatus([])).toBe("no terminals.");
  });

  it("shows the record state and agent for an active terminal", () => {
    const table = formatStatus([
      [
        "11111111-1111-1111-1111-111111111111",
        activeWithAgent(claude("thinking")),
      ],
    ]);
    expect(table).toContain("11111111");
    expect(table).toContain("active");
    expect(table).toContain("claude");
    expect(table).toContain("working"); // agentStatusLabel(thinking) → the bucket
  });
});
