import {
  type ActiveTerminal,
  activeArm,
  LOCAL_LOCATION,
  type TerminalMetadata,
} from "@kolu/padi-client/surface";
import {
  type AgentInfo,
  type AttentionClass,
  agentUrgency,
  attentionClass,
  type TerminalId,
} from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { isStale } from "../../terminal/staleness";
import type { PaneNode } from "../../terminal/terminalTree";
import { paintBucket } from "../dockModel";
import {
  type DockRowBucket,
  rankDockRows,
  rowRecencyAt,
} from "./dockRowRanking";

const BUCKET_URGENCY = {
  awaiting: "need",
  working: "work",
  idle: "idle",
} as const;

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

function makeMeta(overrides: Partial<ActiveTerminal> = {}): ActiveTerminal {
  return {
    state: "active",
    cwd: "/tmp",
    git: { kind: "none" },
    location: LOCAL_LOCATION,
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
    lastActivityAt: null,
    promptedAt: null,
    ...overrides,
  };
}

function makeSleepingMeta(
  lastActivityAt: number | null = null,
): TerminalMetadata {
  return {
    state: "sleeping",
    sleptAt: 1_700_000_000_000,
    cwd: "/tmp",
    git: { kind: "none" },
    pr: { kind: "absent" },
    location: LOCAL_LOCATION,
    lastActivityAt,
    promptedAt: null,
  };
}

function bucket(meta: TerminalMetadata, stale: boolean): DockRowBucket {
  return rankOne(meta, stale).bucket;
}

function pip(meta: TerminalMetadata, stale: boolean): DockRowBucket {
  return rankOne(meta, stale).pip;
}

function classOfMeta(
  getMeta: (id: TerminalId) => TerminalMetadata | undefined,
): (id: TerminalId) => AttentionClass {
  return (id) => attentionClass(activeArm(getMeta(id))?.agent, false);
}

function rankOne(meta: TerminalMetadata, stale: boolean) {
  const rows = rankDockRows(
    ["t1"] as TerminalId[],
    () => meta,
    () => stale,
    classOfMeta(() => meta),
    () => [],
  );
  const row = rows[0];
  if (!row) throw new Error("no row returned");
  return row;
}

describe("rankDockRows — parked bucket precedence", () => {
  it("parks a stale waiting agent regardless of attention state", () => {
    const meta = makeMeta({ agent: makeAgent("waiting"), lastActivityAt: 1 });
    expect(bucket(meta, true)).toBe("parked");
  });

  it("parks a stale awaiting_user agent the same way", () => {
    const meta = makeMeta({
      agent: makeAgent("awaiting_user"),
      lastActivityAt: 1,
    });
    expect(bucket(meta, true)).toBe("parked");
  });

  it("ranks a fresh waiting agent as idle — the post-turn lull is not needs-you", () => {
    const meta = makeMeta({
      agent: makeAgent("waiting"),
      lastActivityAt: Date.now(),
    });
    expect(bucket(meta, false)).toBe("idle");
  });

  it("keeps a fresh awaiting_user agent in awaiting — it IS blocked on you", () => {
    const meta = makeMeta({
      agent: makeAgent("awaiting_user"),
      lastActivityAt: Date.now(),
    });
    expect(bucket(meta, false)).toBe("awaiting");
  });

  it("keeps a fresh working agent in working, parks it when stale", () => {
    const meta = makeMeta({ agent: makeAgent("tool_use"), lastActivityAt: 1 });
    expect(bucket(meta, false)).toBe("working");
    expect(bucket(meta, true)).toBe("parked");
  });

  it("never-touched plain shells route to none, not idle", () => {
    expect(bucket(makeMeta(), false)).toBe("none");
  });

  it("an agent with no recency yet ranks idle, not none — `none` means PLAIN shell", () => {
    const meta = makeMeta({
      agent: makeAgent("waiting"),
      lastActivityAt: null,
    });
    expect(bucket(meta, false)).toBe("idle");
    expect(() =>
      rankDockRows(
        ["parent"] as TerminalId[],
        (id) => (id === "parent" ? makeMeta({ lastActivityAt: 1 }) : meta),
        () => false,
        classOfMeta(() => meta),
        () => [{ id: "fresh-agent-split" as TerminalId, children: [] }],
      ),
    ).not.toThrow();
  });

  it("classifies a sleeping terminal as its own bucket, not none", () => {
    expect(bucket(makeSleepingMeta(), false)).toBe("sleeping");
  });

  it("parks a sleeping terminal once it is STALE — the activity window hides old dormant tiles", () => {
    expect(bucket(makeSleepingMeta(1), false)).toBe("sleeping");
    expect(bucket(makeSleepingMeta(1), true)).toBe("parked");
  });

  it("routes a stale sleeping row to parked so the dock drops it", () => {
    const rows = rankDockRows(
      ["t1"] as TerminalId[],
      () => makeSleepingMeta(1),
      () => true,
      classOfMeta(() => makeSleepingMeta(1)),
      () => [],
    );
    expect(rows[0]?.bucket).toBe("parked");
  });

  const realStale = (now: number, thresholdMs: number) => (ts: number | null) =>
    isStale(ts, now, thresholdMs);
  const NOW = 1_700_000_000_000;
  const WINDOW = 24 * 60 * 60 * 1000;

  it("parks a plain shell slept long ago — keyed on sleptAt, not lastActivityAt:null", () => {
    const meta = {
      ...makeSleepingMeta(null),
      sleptAt: NOW - 2 * WINDOW,
    } as TerminalMetadata;
    const rows = rankDockRows(
      ["t1"] as TerminalId[],
      () => meta,
      realStale(NOW, WINDOW),
      classOfMeta(() => meta),
      () => [],
    );
    expect(rows[0]?.bucket).toBe("parked");
  });

  it("keeps a JUST-slept tile asleep even if its agent last moved days ago", () => {
    const meta = {
      ...makeSleepingMeta(NOW - 3 * WINDOW),
      sleptAt: NOW,
    } as TerminalMetadata;
    const rows = rankDockRows(
      ["t1"] as TerminalId[],
      () => meta,
      realStale(NOW, WINDOW),
      classOfMeta(() => meta),
      () => [],
    );
    expect(rows[0]?.bucket).toBe("sleeping");
  });

  it("meta.agent is not mutated by ranking — render layer retains identity after park", () => {
    const meta = makeMeta({ agent: makeAgent("waiting"), lastActivityAt: 1 });
    const agentBefore = meta.agent;
    rankDockRows(
      ["t1"] as TerminalId[],
      () => meta,
      () => true,
      classOfMeta(() => meta),
      () => [],
    );
    expect(meta.agent).toBe(agentBefore);
    expect(meta.agent?.state).toBe("waiting");
  });
});

describe("row ORDER vs row COLOUR are decoupled — the pip matches the tile title", () => {
  it("a fresh waiting agent ranks idle but its pip lingers (dim violet stays)", () => {
    const meta = makeMeta({
      agent: makeAgent("waiting"),
      lastActivityAt: Date.now(),
    });
    expect(bucket(meta, false)).toBe("idle");
    expect(pip(meta, false)).toBe("linger");
  });

  it("the row pip equals the tile-title paint fold for every fresh agent state", () => {
    const STATES: AgentInfo["state"][] = [
      "thinking",
      "tool_use",
      "running_background",
      "awaiting_user",
      "waiting",
    ];
    for (const state of STATES) {
      const meta = makeMeta({
        agent: makeAgent(state),
        lastActivityAt: Date.now(),
      });
      expect(pip(meta, false)).toBe(paintBucket(makeAgent(state)));
    }
  });

  it("a sleeping row keeps sleeping paint; a never-touched shell paints idle (shell glyph)", () => {
    expect(pip(makeSleepingMeta(), false)).toBe("sleeping");
    expect(bucket(makeMeta(), false)).toBe("none");
    expect(pip(makeMeta(), false)).toBe("idle");
  });
});

describe("dock ⇄ agentProjection urgency parity (the cross-consumer differential)", () => {
  const STATES: AgentInfo["state"][] = [
    "thinking",
    "tool_use",
    "running_background",
    "awaiting_user",
    "waiting",
  ];

  for (const state of STATES) {
    it(`buckets a fresh ${state} agent at agentProjection's urgency`, () => {
      const meta = makeMeta({ agent: makeAgent(state), lastActivityAt: 1 });
      const emitted = bucket(meta, false);
      expect(
        Object.hasOwn(BUCKET_URGENCY, emitted),
        `an agent state must not route to the dock's own tail — got "${emitted}"`,
      ).toBe(true);
      expect(BUCKET_URGENCY[emitted as keyof typeof BUCKET_URGENCY]).toBe(
        agentUrgency(makeAgent(state)),
      );
    });
  }
});

describe("rowRecencyAt — the one recency the window and the row display share", () => {
  it("uses lastActivityAt for a live tile", () => {
    expect(rowRecencyAt(makeMeta({ lastActivityAt: 4242 }))).toBe(4242);
  });

  it("uses sleptAt for a sleeping tile — NOT its stale agent lastActivityAt", () => {
    const meta = {
      ...makeSleepingMeta(123),
      sleptAt: 999_000,
    } as TerminalMetadata;
    expect(rowRecencyAt(meta)).toBe(999_000);
  });
});

describe("rankDockRows — split sub-entries", () => {
  const PARENT = "parent" as TerminalId;
  const AGENT_SPLIT = "split-agent" as TerminalId;
  const PLAIN_SPLIT = "split-bash" as TerminalId;

  const metas: Record<string, TerminalMetadata> = {
    [PARENT]: makeMeta({ lastActivityAt: 100 }),
    [AGENT_SPLIT]: makeMeta({
      agent: makeAgent("thinking"),
      lastActivityAt: 50,
    }),
    [PLAIN_SPLIT]: makeMeta({ lastActivityAt: 40 }),
  };
  const getMeta = (id: TerminalId) => metas[id as string];

  const leaves = (ids: TerminalId[]) => ids.map((id) => ({ id, children: [] }));

  function rank(subIds: TerminalId[]) {
    return rankTree(leaves(subIds));
  }

  function rankTree(panes: readonly PaneNode[]) {
    return rankDockRows(
      [PARENT],
      getMeta,
      () => false,
      classOfMeta(getMeta),
      () => panes,
    );
  }

  it("gives every split an entry under its parent", () => {
    expect(
      rank([AGENT_SPLIT, PLAIN_SPLIT])[0]?.subRows.map((row) => row.id),
    ).toEqual([AGENT_SPLIT, PLAIN_SPLIT]);
  });

  it("keeps sibling splits in the store's order — urgency does not reorder tabs", () => {
    const blocked = "split-blocked" as TerminalId;
    const newerBusy = "split-newer-busy" as TerminalId;
    metas[blocked] = makeMeta({
      agent: makeAgent("awaiting_user"),
      lastActivityAt: 10,
    });
    metas[newerBusy] = makeMeta({
      agent: makeAgent("thinking"),
      lastActivityAt: 1_000,
    });

    expect(rank([newerBusy, blocked])[0]?.subRows.map((row) => row.id)).toEqual(
      [newerBusy, blocked],
    );
  });

  it("uses split activity for the parent's window fate and displayed recency", () => {
    const parent = makeMeta({ lastActivityAt: 10 });
    const split = makeMeta({
      agent: makeAgent("thinking"),
      lastActivityAt: 1_000,
    });
    const getMeta = (id: TerminalId) =>
      id === PARENT ? parent : id === AGENT_SPLIT ? split : undefined;
    const staleInputs: Array<number | null> = [];

    const result = rankDockRows(
      [PARENT],
      getMeta,
      (recencyAt) => {
        staleInputs.push(recencyAt);
        return recencyAt !== null && recencyAt < 100;
      },
      classOfMeta(getMeta),
      () => leaves([AGENT_SPLIT]),
    );

    expect(staleInputs).toEqual([1_000]);
    expect(result[0]).toMatchObject({ ts: 1_000, bucket: "idle" });
  });

  it("omits a split while its projected metadata is still pending", () => {
    const missing = "split-missing" as TerminalId;
    expect(rank([missing])[0]?.subRows).toEqual([]);
  });

  it("classifies agentless splits as quiet rows with a paint pip fact", () => {
    expect(rank([PLAIN_SPLIT])[0]?.subRows[0]).toMatchObject({
      kind: "shell",
      bucket: "idle",
      pip: "idle",
    });
  });

  it("classifies agent-bearing splits once for paint and attention consumers", () => {
    const sub = rank([AGENT_SPLIT])[0]?.subRows[0];
    expect(sub?.kind).toBe("agent");
    expect(sub).toMatchObject({ pip: "working" });
  });

  describe("nested splits", () => {
    const GRANDCHILD = "split-grandchild" as TerminalId;

    it("gives a split of a split its own entry, one level deeper", () => {
      metas[GRANDCHILD] = makeMeta({ lastActivityAt: 30 });
      const rows = rankTree([
        { id: PLAIN_SPLIT, children: [{ id: GRANDCHILD, children: [] }] },
      ]);
      expect(rows[0]?.subRows.map((row) => [row.id, row.depth])).toEqual([
        [PLAIN_SPLIT, 1],
        [GRANDCHILD, 2],
      ]);
    });

    it("keeps each split immediately followed by its own children", () => {
      const blocked = "split-blocked" as TerminalId;
      metas[blocked] = makeMeta({
        agent: makeAgent("awaiting_user"),
        lastActivityAt: 5,
      });
      const rows = rankTree([
        { id: PLAIN_SPLIT, children: [{ id: blocked, children: [] }] },
        { id: AGENT_SPLIT, children: [] },
      ]);
      expect(rows[0]?.subRows.map((row) => row.id)).toEqual([
        PLAIN_SPLIT,
        blocked,
        AGENT_SPLIT,
      ]);
    });

    it("uses a GRANDCHILD's activity for the tile's window fate", () => {
      metas[GRANDCHILD] = makeMeta({ lastActivityAt: 9_000 });
      const staleInputs: Array<number | null> = [];
      const rows = rankDockRows(
        [PARENT],
        getMeta,
        (recencyAt) => {
          staleInputs.push(recencyAt);
          return recencyAt !== null && recencyAt < 1_000;
        },
        classOfMeta(getMeta),
        () => [
          { id: PLAIN_SPLIT, children: [{ id: GRANDCHILD, children: [] }] },
        ],
      );
      expect(staleInputs).toEqual([9_000]);
      expect(rows[0]?.bucket).not.toBe("parked");
    });

    it("drops a whole subtree while the middle split's metadata is pending", () => {
      const missing = "split-missing" as TerminalId;
      metas[GRANDCHILD] = makeMeta({ lastActivityAt: 30 });
      const rows = rankTree([
        { id: missing, children: [{ id: GRANDCHILD, children: [] }] },
      ]);
      expect(rows[0]?.subRows).toEqual([]);
    });
  });
});
