import {
  composeTerminalMetadata,
  LOCAL_LOCATION,
  type PadiTerminal,
  urgencyEqual,
} from "@kolu/padi-client/surface";
import type {
  AgentInfo,
  TerminalId,
  TerminalSnapshot,
} from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { recomputeUrgency } from "./urgency.ts";

function makeAgent(state: AgentInfo["state"]): AgentInfo {
  return {
    kind: "claude-code",
    state,
    sessionId: "s1",
    model: null,
    summary: null,
    taskProgress: null,
    workflow: null,
    contextTokens: null,
    startedAt: null,
  };
}

function activeTerminal(agent: AgentInfo | null): PadiTerminal {
  const snapshot: TerminalSnapshot = {
    cwd: "/tmp",
    git: { kind: "none" },
    pr: { kind: "pending" },
    agent,
    foreground: null,
    ports: { status: "unknown" },
  };
  return composeTerminalMetadata(
    {
      state: "active",
      location: LOCAL_LOCATION,
      lastActivityAt: 0,
      promptedAt: null,
    },
    snapshot,
  );
}

function terminalsMap(
  entries: Array<[string, AgentInfo | null]>,
): ReadonlyMap<TerminalId, PadiTerminal> {
  return new Map(
    entries.map(([id, agent]) => [id as TerminalId, activeTerminal(agent)]),
  );
}

function sleepingTerminal(agent: AgentInfo | null): PadiTerminal {
  const snapshot: TerminalSnapshot = {
    cwd: "/tmp",
    git: { kind: "none" },
    pr: { kind: "pending" },
    agent,
    foreground: null,
    ports: { status: "unknown" },
  };
  return composeTerminalMetadata(
    {
      state: "sleeping",
      location: LOCAL_LOCATION,
      lastActivityAt: 0,
      promptedAt: null,
      sleptAt: 0,
    },
    snapshot,
  );
}

const ID_A = "urg-a";
const ID_B = "urg-b";

const finished = (): boolean => true;
const stillDebouncing = (): boolean => false;

describe("recomputeUrgency", () => {
  it("carries id lists only (no separate count field) for both attention buckets", () => {
    const urgency = recomputeUrgency(
      terminalsMap([
        [ID_A, makeAgent("awaiting_user")],
        [ID_B, makeAgent("thinking")],
      ]),
      finished,
    );

    expect(urgency).toEqual({
      awaitingIds: [ID_A],
      finishedIds: [],
      workingIds: [ID_B],
      lingerIds: [],
      settled: true,
    });
    expect(Object.keys(urgency).sort()).toEqual([
      "awaitingIds",
      "finishedIds",
      "lingerIds",
      "settled",
      "workingIds",
    ]);
  });

  it("folds episode-finished (`waiting`) agents into finishedIds, separate from awaiting", () => {
    const urgency = recomputeUrgency(
      terminalsMap([
        [ID_A, makeAgent("awaiting_user")],
        [ID_B, makeAgent("waiting")],
        ["urg-c", makeAgent("thinking")],
      ]),
      finished,
    );
    expect(urgency).toEqual({
      awaitingIds: [ID_A],
      finishedIds: [ID_B],
      workingIds: ["urg-c"],
      lingerIds: [],
      settled: true,
    });
  });

  it("holds a still-debouncing waiting agent OUT of finishedIds (first-finish quiet)", () => {
    const urgency = recomputeUrgency(
      terminalsMap([
        [ID_A, makeAgent("awaiting_user")],
        [ID_B, makeAgent("waiting")],
      ]),
      stillDebouncing,
    );
    expect(urgency).toEqual({
      awaitingIds: [ID_A],
      finishedIds: [],
      workingIds: [],
      lingerIds: [ID_B],
      settled: true,
    });
  });

  it("gates finish per-id: only episode-finished waiting ids land in finishedIds", () => {
    const done = new Set<string>([ID_A]);
    const urgency = recomputeUrgency(
      terminalsMap([
        [ID_A, makeAgent("waiting")],
        [ID_B, makeAgent("waiting")],
      ]),
      (id) => done.has(id),
    );
    expect(urgency).toEqual({
      awaitingIds: [],
      finishedIds: [ID_A],
      workingIds: [],
      lingerIds: [ID_B],
      settled: true,
    });
  });

  it("folds ids in the map's insertion order, and an agentless entry contributes 0", () => {
    const urgency = recomputeUrgency(
      terminalsMap([
        [ID_B, makeAgent("awaiting_user")],
        ["urg-c", null],
        [ID_A, makeAgent("awaiting_user")],
      ]),
      finished,
    );
    expect(urgency).toEqual({
      awaitingIds: [ID_B, ID_A],
      finishedIds: [],
      workingIds: [],
      lingerIds: [],
      settled: true,
    });
  });

  it("is empty for a map with no agent-bearing terminals", () => {
    expect(
      recomputeUrgency(terminalsMap([[ID_A, null]]), stillDebouncing),
    ).toEqual({
      awaitingIds: [],
      finishedIds: [],
      workingIds: [],
      lingerIds: [],
      settled: true,
    });
  });

  it("EXCLUDES a SLEEPING terminal even when its agent reads as awaiting_user", () => {
    const map = new Map<TerminalId, PadiTerminal>([
      [ID_A as TerminalId, sleepingTerminal(makeAgent("awaiting_user"))],
      [ID_B as TerminalId, activeTerminal(makeAgent("awaiting_user"))],
    ]);
    expect(recomputeUrgency(map, finished)).toEqual({
      awaitingIds: [ID_B],
      finishedIds: [],
      workingIds: [],
      lingerIds: [],
      settled: true,
    });
  });
});

describe("urgencyEqual", () => {
  it("is true for two readings with the same ids in the same order", () => {
    expect(
      urgencyEqual(
        {
          awaitingIds: ["a", "b"],
          finishedIds: ["c"],
          workingIds: ["d"],
          lingerIds: ["e"],
          settled: true,
        },
        {
          awaitingIds: ["a", "b"],
          finishedIds: ["c"],
          workingIds: ["d"],
          lingerIds: ["e"],
          settled: true,
        },
      ),
    ).toBe(true);
  });

  it("is false when the awaiting set differs", () => {
    expect(
      urgencyEqual(
        {
          awaitingIds: ["a"],
          finishedIds: [],
          workingIds: [],
          lingerIds: [],
          settled: true,
        },
        {
          awaitingIds: ["a", "b"],
          finishedIds: [],
          workingIds: [],
          lingerIds: [],
          settled: true,
        },
      ),
    ).toBe(false);
  });

  it("is false when ONLY the finished set differs — a finish must still publish", () => {
    expect(
      urgencyEqual(
        {
          awaitingIds: ["a"],
          finishedIds: [],
          workingIds: [],
          lingerIds: [],
          settled: true,
        },
        {
          awaitingIds: ["a"],
          finishedIds: ["b"],
          workingIds: [],
          lingerIds: [],
          settled: true,
        },
      ),
    ).toBe(false);
  });

  it("is false when ONLY the linger set differs — the activity count must move", () => {
    expect(
      urgencyEqual(
        {
          awaitingIds: [],
          finishedIds: [],
          workingIds: ["a"],
          lingerIds: [],
          settled: true,
        },
        {
          awaitingIds: [],
          finishedIds: [],
          workingIds: [],
          lingerIds: ["a"],
          settled: true,
        },
      ),
    ).toBe(false);
  });
});
