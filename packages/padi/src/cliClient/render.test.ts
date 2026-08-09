import type { PadiTerminal } from "../surface.ts";
import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { isWaitState, WAIT_STATES } from "../dial.ts";
import { formatStatus, resolveTerminalId } from "./render.ts";

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

describe("isWaitState — the whole padi-side `--until` contract", () => {
  // The COMMA SPLIT and its message are argv grammar and live in each face now
  // (kolu-cli's \`planUntil\`, padi-tui's local copy). What padi owns is whether a
  // single token names a bucket.
  it("accepts each bucket and refuses anything else", () => {
    for (const s of WAIT_STATES) expect(isWaitState(s)).toBe(true);
    expect(isWaitState("idle")).toBe(false);
    expect(isWaitState("")).toBe(false);
    expect(isWaitState("Awaiting")).toBe(false);
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
