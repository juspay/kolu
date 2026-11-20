import type { PadiTerminal, PadiUrgency } from "@kolu/padi-client/surface";
import {
  composeTerminalMetadata,
  LOCAL_LOCATION,
} from "@kolu/padi-client/vocab";
import { type AgentPresence, agentPresence } from "kolu-agents/vocab";
import { describe, expect, it } from "vitest";
import {
  type HostView,
  prReading,
  readingsOf,
  recordName,
} from "./readings.ts";

const HOST = "local";
const PLANNER = "11111111-1111-4111-8111-111111111111";
const SPLIT = "22222222-2222-4222-8222-222222222222";

interface Over {
  parentId?: string;
  intent?: string;
  asleep?: boolean;
  agent?: boolean;
  shellInFront?: boolean;
  presence?: AgentPresence["state"];
}

const record = (over: Over): PadiTerminal =>
  composeTerminalMetadata(
    {
      location: LOCAL_LOCATION,
      lastActivityAt: 0,
      promptedAt: null,
      ...(over.parentId === undefined ? {} : { parentId: over.parentId }),
      ...(over.intent === undefined ? {} : { intent: over.intent }),
      ...(over.asleep === true
        ? ({ state: "sleeping", sleptAt: 1 } as const)
        : ({ state: "active" } as const)),
    },
    {
      cwd: "/tmp",
      git: { kind: "none" },
      pr: { kind: "pending" },
      agent:
        over.presence !== undefined
          ? agentPresence("claude-code", over.presence, null)
          : over.agent === true
            ? {
                kind: "claude-code",
                state: "thinking",
                sessionId: "ses-A",
                model: null,
                summary: null,
                taskProgress: null,
                workflow: null,
                contextTokens: null,
                startedAt: null,
              }
            : null,
      foreground:
        over.shellInFront === undefined
          ? null
          : { name: "bash", title: null, shell: over.shellInFront },
      ports: { status: "unknown" },
    },
  );

const records = (
  entries: Record<string, Over>,
): ReadonlyMap<string, PadiTerminal> =>
  new Map(Object.entries(entries).map(([id, over]) => [id, record(over)]));

const QUIET: PadiUrgency = {
  awaitingIds: [],
  finishedIds: [],
  workingIds: [],
  lingerIds: [],
  settled: true,
};

const reading = (over: {
  watched: readonly string[];
  urgency?: Partial<PadiUrgency>;
  roster?: readonly string[];
  records?: Record<string, Over>;
}): HostView => ({
  kind: "ready",
  host: HOST,
  hostName: "this machine",
  watched: over.watched,
  urgency: { ...QUIET, ...over.urgency },
  roster: new Set(over.roster ?? over.watched),
  records: records(over.records ?? {}),
});

describe("what a terminal is called", () => {
  it("is the name a person gave it", () => {
    expect(recordName(record({ intent: "plan the cutover" }))).toBe(
      "plan the cutover",
    );
  });

  it("is EMPTY when nothing is known, rather than invented", () => {
    expect(recordName(record({}))).toBe("");
    expect(recordName(undefined)).toBe("");
  });
});

describe("what a host's frames say about each watched terminal", () => {
  it("is GONE when the host's roster no longer has it", () => {
    const seen = readingsOf(reading({ watched: [SPLIT], roster: [] }));
    expect(seen.map((one) => one.level)).toEqual(["gone"]);
    expect(seen[0]?.ref).toBe(`${HOST}/${SPLIT}`);
    expect(seen[0]?.hostName).toBe("this machine");
  });

  it("says NOTHING about a host whose roster has not been established", () => {
    expect(
      readingsOf({
        kind: "settling",
        host: HOST,
        hostName: "this machine",
        watched: [SPLIT, PLANNER],
      }),
    ).toEqual([]);
  });

  it("says NOTHING about a host that is not answering", () => {
    expect(
      readingsOf({
        kind: "unreachable",
        host: HOST,
        hostName: "this machine",
        watched: [SPLIT, PLANNER],
      }),
    ).toEqual([]);
  });

  it("is ASLEEP for a terminal padi still lists with its PTY released", () => {
    expect(
      readingsOf(
        reading({
          watched: [SPLIT],
          records: { [SPLIT]: { asleep: true } },
        }),
      ).map((one) => one.level),
    ).toEqual(["asleep"]);
  });

  it("takes ASKING and STOPPED straight off padi's own two lists", () => {
    expect(
      readingsOf(
        reading({
          watched: [SPLIT, PLANNER],
          urgency: { awaitingIds: [SPLIT], finishedIds: [PLANNER] },
          records: { [SPLIT]: {}, [PLANNER]: {} },
        }),
      ).map((one) => one.level),
    ).toEqual(["asking", "stopped"]);
  });

  it("counts a LINGERING agent as still working", () => {
    expect(
      readingsOf(
        reading({
          watched: [SPLIT, PLANNER],
          urgency: { workingIds: [SPLIT], lingerIds: [PLANNER] },
          records: { [SPLIT]: {}, [PLANNER]: {} },
        }),
      ).map((one) => one.level),
    ).toEqual(["working", "working"]);
  });

  it("is a SHELL when no agent is in it, and REPORTS what is in front of it", () => {
    const seen = readingsOf(
      reading({
        watched: [SPLIT],
        records: { [SPLIT]: { shellInFront: true } },
      }),
    );
    expect(seen.map((one) => one.level)).toEqual(["shell"]);
    expect(seen[0]?.foregroundShell).toBe(true);
  });

  it("reads an agent that is COMING UP and one that is FRESH off the record", () => {
    const seen = readingsOf(
      reading({
        watched: [SPLIT, PLANNER],
        records: {
          [SPLIT]: { presence: "starting" },
          [PLANNER]: { presence: "fresh" },
        },
      }),
    );
    expect(seen.map((one) => one.level)).toEqual(["starting", "fresh"]);
    expect(seen.map((one) => one.agent)).toEqual([
      "claude-code",
      "claude-code",
    ]);
  });

  it("says NOTHING about a terminal in no list whose record has not arrived", () => {
    expect(readingsOf(reading({ watched: [SPLIT] }))).toEqual([]);
  });

  it("says NOTHING about an agent in no list whose state is not a presence", () => {
    expect(
      readingsOf(
        reading({ watched: [SPLIT], records: { [SPLIT]: { agent: true } } }),
      ),
    ).toEqual([]);
  });

  it("carries the name, the agent and where it is working onto every reading", () => {
    const seen = readingsOf(
      reading({
        watched: [SPLIT],
        urgency: { awaitingIds: [SPLIT] },
        records: {
          [PLANNER]: { intent: "plan the cutover" },
          [SPLIT]: {
            parentId: PLANNER,
            intent: "write the migration",
            agent: true,
          },
        },
      }),
    );
    expect(seen).toEqual([
      {
        ref: `${HOST}/${SPLIT}`,
        host: HOST,
        terminalId: SPLIT,
        hostName: "this machine",
        name: "write the migration",
        agent: "claude-code",
        git: null,
        foregroundShell: null,
        level: "asking",
      },
    ]);
  });
});

describe("what a pull request reading says about checks and merging", () => {
  const resolved = (
    checks: "pending" | "pass" | "fail" | null,
    mergeStateStatus:
      | "BEHIND"
      | "BLOCKED"
      | "CLEAN"
      | "DIRTY"
      | "DRAFT"
      | "HAS_HOOKS"
      | "UNKNOWN"
      | "UNSTABLE"
      | null,
    reviewDecision:
      | "APPROVED"
      | "CHANGES_REQUESTED"
      | "REVIEW_REQUIRED"
      | null = null,
    isDraft = false,
  ) => {
    const read = prReading({
      kind: "ok",
      value: {
        number: 2388,
        title: "Mermaid diagrams",
        url: "https://github.com/juspay/kolu/pull/2388",
        state: "open",
        checks,
        checkRuns: [],
        reviewDecision,
        mergeStateStatus,
        headSha: "4c3f17ea2",
        isDraft,
      },
    });
    if (read.kind !== "pr") throw new Error(`no PR: ${read.kind}`);
    return read.pr;
  };
  const mergeOfReady = (...args: Parameters<typeof resolved>) => {
    const readiness = resolved(...args).readiness;
    if (readiness.kind !== "ready") throw new Error("a draft");
    return readiness.merge;
  };

  it("keeps the checks as the rollup says them, whatever the merge state", () => {
    expect(resolved("pass", "BLOCKED").checks).toEqual({
      kind: "rollup",
      rollup: "pass",
    });
    expect(resolved(null, "CLEAN").checks).toEqual({ kind: "unreported" });
    expect(resolved("fail", "CLEAN").checks).toEqual({
      kind: "rollup",
      rollup: "fail",
    });
  });

  it("says the PR can merge only when GitHub says so", () => {
    for (const state of ["CLEAN", "HAS_HOOKS", "UNSTABLE"] as const)
      expect(mergeOfReady("pass", state)).toEqual({ kind: "can" });
    expect(mergeOfReady("pass", "BLOCKED")).toEqual({
      kind: "cannot",
      why: "blocked",
    });
    expect(mergeOfReady("pass", "BLOCKED", "APPROVED")).toEqual({
      kind: "cannot",
      why: "blocked",
    });
    expect(mergeOfReady("pass", "BEHIND")).toEqual({
      kind: "cannot",
      why: "behind",
    });
    expect(mergeOfReady("pass", "DIRTY")).toEqual({
      kind: "cannot",
      why: "conflicts",
    });
    expect(mergeOfReady("pass", "DRAFT")).toEqual({
      kind: "cannot",
      why: "draft",
    });
  });

  it("reads a draft as a draft, whatever GitHub's merge state says", () => {
    for (const state of [
      "CLEAN",
      "HAS_HOOKS",
      "UNSTABLE",
      "BLOCKED",
      "DIRTY",
      "UNKNOWN",
    ] as const)
      expect(resolved("pass", state, null, true).readiness).toEqual({
        kind: "draft",
      });
    expect(resolved("pass", "CLEAN", null, false).readiness).toEqual({
      kind: "ready",
      merge: { kind: "can" },
    });
  });

  it("names a required review as the block, never as CI", () => {
    for (const review of ["REVIEW_REQUIRED", "CHANGES_REQUESTED"] as const)
      expect(mergeOfReady("pass", "BLOCKED", review)).toEqual({
        kind: "cannot",
        why: "review",
      });
  });

  it("tells GitHub not having worked it out apart from a host that did not say", () => {
    expect(mergeOfReady("pass", "UNKNOWN")).toEqual({ kind: "unsettled" });
    expect(mergeOfReady("pass", null)).toEqual({ kind: "unreported" });
  });

  it("carries the address the forge gave", () => {
    expect(resolved("pass", "CLEAN").url).toBe(
      "https://github.com/juspay/kolu/pull/2388",
    );
  });
});
