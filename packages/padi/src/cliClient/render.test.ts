import type { PadiTerminal } from "@kolu/padi-client/surface";
import { isWaitState, WAIT_STATES } from "@kolu/padi-client/watch";
import type { AgentInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import {
  formatHeartbeat,
  formatHeartbeatJson,
  formatStateEvent,
  formatStateEventJson,
  formatStatus,
  formatWatchActivityJson,
  formatWatchJson,
  formatWatchRemovalJson,
  resolveTerminalId,
  WATCH_FEED_KINDS,
} from "./render.ts";

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

describe("the `kolu watch` line formats", () => {
  const stateEvent = (
    over: Partial<Parameters<typeof formatStateEvent>[0]> = {},
  ) =>
    formatStateEvent({
      seq: 1,
      id: "a1b2c3d4-1111-1111-1111-111111111111" as TerminalId,
      kind: "nag",
      state: "waiting",
      since: 1_000,
      at: 61_000,
      ...over,
    });

  it("lines the two CLOSED-vocabulary columns up, so a running feed reads as a table", () => {
    // Both unions are closed literals, so the widths are compile-time facts and
    // nothing has to be measured — and the docs' sample block is then true.
    const nag = stateEvent();
    const transition = stateEvent({ kind: "transition", state: "awaiting" });
    expect(nag).toContain("nag         waiting   1m");
    expect(transition).toContain("transition  awaiting  1m");
    // The hold lands in the same column whichever words came before it.
    expect(nag.indexOf("1m")).toBe(transition.indexOf("1m"));
  });

  it("appends the intent when the terminal has one, and nothing when it does not", () => {
    expect(stateEvent({ intent: "fix the parser" })).toMatch(
      /1m {2}fix the parser$/,
    );
    expect(stateEvent()).toMatch(/1m$/);
  });

  it("gives EVERY --json line a `kind`, whichever feed produced it", () => {
    // One `jq` switch reads both feeds: a consumer must not have to inspect its
    // own argv, or probe for which key happens to be present, to tell a removal
    // from an activity flip from a supervision event.
    const id = "a1b2c3d4-1111-1111-1111-111111111111" as TerminalId;
    expect(JSON.parse(formatWatchRemovalJson(id))).toEqual({
      kind: "removed",
      id,
    });
    expect(JSON.parse(formatWatchActivityJson(id, true))).toEqual({
      kind: "activity",
      id,
      activity: true,
    });
    const upsert = JSON.parse(
      formatWatchJson(id, activeWithAgent(claude("thinking")), { live: true }),
    ) as Record<string, unknown>;
    expect(upsert.kind).toBe("terminal");
    expect(upsert.live).toBe(true);
    expect(upsert.state).toBe("active");
  });
});

describe("formatStateEventJson — the other half of the --json contract", () => {
  const event = {
    seq: 7,
    id: "a1b2c3d4-0000-4000-8000-000000000000" as TerminalId,
    kind: "nag" as const,
    state: "waiting" as const,
    since: 1_700_000_000_000,
    at: 1_700_000_420_000,
  };

  it("emits the wire event VERBATIM — one line, parseable, nothing re-shaped", () => {
    expect(JSON.parse(formatStateEventJson(event))).toEqual(event);
    expect(formatStateEventJson(event)).not.toContain("\n");
  });

  it("carries `kind`, like every other line this verb prints", () => {
    // The whole --json contract in one assertion: a consumer branches on one
    // field whichever feed produced the line.
    for (const kind of ["snapshot", "transition", "nag"] as const) {
      expect(JSON.parse(formatStateEventJson({ ...event, kind })).kind).toBe(
        kind,
      );
    }
  });
});

describe("formatHeartbeat — a CLI-only alive line", () => {
  it("is a timestamped line, not a terminal event", () => {
    expect(formatHeartbeat(1_700_000_000_000)).toMatch(/heartbeat$/);
    expect(formatHeartbeat(1_700_000_000_000)).not.toMatch(/snapshot/);
    // The id column is BLANK, not skipped, so the word lands in the KIND
    // column — at the same offset a neighbouring line's kind does, which is
    // the alignment the derived widths exist for.
    const beat = formatHeartbeat(1_700_000_420_000);
    const event = formatStateEvent({
      seq: 7,
      id: "a1b2c3d4-0000-4000-8000-000000000000" as TerminalId,
      kind: "snapshot",
      state: "waiting",
      since: 1_700_000_000_000,
      at: 1_700_000_420_000,
    });
    expect(beat.indexOf("heartbeat")).toBe(event.indexOf("snapshot"));
  });

  it("declares its kind in the array the feed's column width is derived from", () => {
    // A consumer building a `jq` switch off the declared kinds is exhaustive.
    expect([...WATCH_FEED_KINDS]).toContain("heartbeat");
  });

  it("JSON carries kind so a jq consumer can skip it", () => {
    expect(JSON.parse(formatHeartbeatJson(1_700_000_000_000))).toEqual({
      kind: "heartbeat",
      at: 1_700_000_000_000,
    });
  });
});
