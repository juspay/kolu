import {
  type ActiveTerminal,
  activeArm,
  LOCAL_LOCATION,
  type TerminalMetadata,
} from "@kolu/padi/surface";
import {
  type AgentInfo,
  type AttentionClass,
  agentUrgency,
  attentionClass,
  type TerminalId,
  URGENCY_RANK,
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

/** A row's URGENCY, as a number. Lower = more urgent.
 *
 *  This table lives HERE, not in production, because no production code reads
 *  it: nothing in the dock orders by urgency any more, and strip membership is
 *  the attention class. It survived as an exported constant purely so this file
 *  had something to assert about — a test fixture type-checked and re-read as if
 *  it were a runtime contract, needing eleven lines of doc telling the next
 *  reader not to wire a surface through it. A comment was doing a structure's
 *  job; now nothing may read it because nothing CAN.
 *
 *  The claim it exists for is still worth pinning: the dock's three agent-state
 *  buckets inherit the shared needs-you-first rank (`need=0 < work=1 < idle=2`),
 *  with `sleeping`/`parked`/`none` as the dock's own quieter tail below them —
 *  which is what stops `classifyDockRow` drifting from the shared vocabulary the
 *  rest of the fleet speaks (see `.claude/rules/dock-fleet-mirror.md`). The
 *  `Record<DockRowBucket, number>` annotation still compile-fails this file when
 *  a bucket is added, which is the drift the table guards. */
const DOCK_ROW_BUCKET_PRIORITY: Record<DockRowBucket, number> = {
  awaiting: URGENCY_RANK.need,
  working: URGENCY_RANK.work,
  // `linger` is a PAINT-only bucket (`classifyDockRow` never emits it — a
  // post-turn `waiting` agent ORDERS as idle), listed here only because the
  // priority table is total over the union; it ranks with idle, honestly.
  linger: URGENCY_RANK.idle,
  idle: URGENCY_RANK.idle,
  sleeping: 3,
  parked: 4,
  none: 5,
};

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
    git: null,
    location: LOCAL_LOCATION,
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
    lastActivityAt: null,
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
    git: null,
    // `pr` is restore-relevant now (true-when-dead, persisted like `git`), so it
    // rides the sleeping arm's `PersistedSnapshot` — the old frozen-`pr`
    // special case is gone and `pr` is a normal required field on both arms.
    pr: { kind: "absent" },
    location: LOCAL_LOCATION,
    lastActivityAt,
  };
}

/** Convenience: rank a single terminal and return its ORDER bucket. */
function bucket(meta: TerminalMetadata, stale: boolean): DockRowBucket {
  return rankOne(meta, stale).bucket;
}

/** Convenience: rank a single terminal and return its PIP bucket (the colour
 *  the row's `StatePip` paints, decoupled from order). */
function pip(meta: TerminalMetadata, stale: boolean): DockRowBucket {
  return rankOne(meta, stale).pip;
}

/** Stand-in for the attention mirror: fold the fixture's own agent through the
 *  shared partition, which is what padi publishes and the dock reads back. */
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
  // The activity-window selector exists to compress yesterday's queue
  // out of the prominent buckets. A waiting agent past the threshold
  // MUST route to `parked` — not stay in `awaiting` — or the selector
  // has no effect on the wall-of-cards problem it solves. Identity is
  // preserved at the render layer (QuietRowBody paints AgentIndicator
  // when meta.agent is set), not by keeping the row in `awaiting`.
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
    // `waiting` is the post-turn lull (Claude's end_turn / an interrupt): the
    // agent finished its turn and yielded, it is NOT blocked on you. The dock
    // ranks it idle, matching `agentProjection.agentUrgency` (and pulam-web) —
    // contrast `awaiting_user` below, which floats to the awaiting row. The
    // render layer still paints the AgentIndicator from `meta.agent`, so the
    // quieter bucket doesn't erase the agent's identity.
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
    // padi publishes the composed record with a fresh agent before it stamps
    // `lastActivityAt`, so this product is a real frame, not a hypothetical.
    // Ranking it `none` used to trip `rankSubRow`'s agent fence and throw out of
    // the dock's memo — the whole Dock, gone, for one split's first frame.
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
    // A sleeping tile is still subject to the activity window: a fresh dormant
    // tile keeps its ☾ bucket, but once its last activity falls outside the
    // window it routes to `parked` like any other stale row, so the selector
    // actually compresses yesterday's slept terminals out of the dock.
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

  // The window's recency for a sleeping tile is `sleptAt` (when you put it to
  // sleep), NOT `lastActivityAt` (its last agent transition). The previous two
  // tests stub `isStale` to a constant, so they never exercise WHICH timestamp
  // the ranker keys on — these drive the real `isStale` to pin the seam.
  const realStale = (now: number, thresholdMs: number) => (ts: number | null) =>
    isStale(ts, now, thresholdMs);
  const NOW = 1_700_000_000_000;
  const WINDOW = 24 * 60 * 60 * 1000; // 24h

  it("parks a plain shell slept long ago — keyed on sleptAt, not lastActivityAt:null", () => {
    // An agent-less dormant tile carries `lastActivityAt === null` (honest
    // never-active), which `isStale` exempts. If the window keyed on it, this
    // tile would NEVER park and old dormant shells would pile up. Keyed on
    // `sleptAt` (2 days ago) it parks.
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
    // `lastActivityAt` (3 days ago) is OUTSIDE the window, but the tile was
    // slept just now — keying on `sleptAt` keeps its ☾ instead of dropping it
    // the instant you sleep it.
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
    // rankDockRows must not clear or replace meta.agent when it routes a
    // terminal to `parked`. QuietRowBody reads meta.agent directly to paint
    // the AgentIndicator on the compact row; if ranking cleared it, the
    // sleep-overnight bug returns (row reads as a plain shell).
    const meta = makeMeta({ agent: makeAgent("waiting"), lastActivityAt: 1 });
    const agentBefore = meta.agent;
    rankDockRows(
      ["t1"] as TerminalId[],
      () => meta,
      () => true,
      classOfMeta(() => meta),
      () => [],
    );
    expect(meta.agent).toBe(agentBefore); // identity preserved — same object reference
    expect(meta.agent?.state).toBe("waiting");
  });
});

describe("row ORDER vs row COLOUR are decoupled — the pip matches the tile title", () => {
  // The dock row and the tile title both render through `StatePip`, so a given
  // state must paint the SAME pip colour in both. Order (rank) is a separate
  // axis: a fresh `waiting` agent sorts as `idle` (it doesn't float into the
  // needs-you order) yet keeps its `awaiting` glow, exactly as the title does.
  it("a fresh waiting agent ranks idle but its pip lingers (dim violet stays)", () => {
    const meta = makeMeta({
      agent: makeAgent("waiting"),
      lastActivityAt: Date.now(),
    });
    expect(bucket(meta, false)).toBe("idle"); // ORDER: not needs-you
    expect(pip(meta, false)).toBe("linger"); // COLOUR: the dim just-finished cue
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
      // `paintBucket` is the fold `TerminalMeta` feeds its title pip — the dock
      // row pip must agree so one state never shows two colours.
      expect(pip(meta, false)).toBe(paintBucket(makeAgent(state)));
    }
  });

  it("a sleeping row keeps sleeping paint; a never-touched shell paints idle (shell glyph)", () => {
    expect(pip(makeSleepingMeta(), false)).toBe("sleeping");
    // ORDER still ranks never-touched as `none` (quieter than idle), but PAINT
    // is `idle` so the shell identity glyph renders — Option C: every row core
    // is an identity mark; `empty` is only for genuinely blank call sites.
    expect(bucket(makeMeta(), false)).toBe("none");
    expect(pip(makeMeta(), false)).toBe("idle");
  });
});

describe("dock ⇄ agentProjection urgency parity (the cross-consumer differential)", () => {
  // The #1535 review flagged that nothing pinned "the dock ranks an agent state
  // the SAME way pulam-tui / pulam-web do". This asserts it structurally: for
  // every agent state, the dock's row RANK equals the shared
  // `agentProjection.agentUrgency`'s rank. Both sides read PRODUCTION constants —
  // the shared `URGENCY_RANK` and this file's own bucket table — so
  // there is no hand-written fixture table to drift from the production tables
  // (the bug a parallel `{awaiting→need, …}` map would reintroduce). If the dock
  // ever re-grows a bucket that disagrees (the historical `waiting`→awaiting
  // drift), this goes red.
  const STATES: AgentInfo["state"][] = [
    "thinking",
    "tool_use",
    "running_background",
    "awaiting_user",
    "waiting",
  ];

  for (const state of STATES) {
    it(`ranks a fresh ${state} agent at agentProjection's urgency`, () => {
      // A non-null lastActivityAt so an idle-urgency agent lands in `idle`, not
      // the never-touched `none` tail (which carries no agent and no urgency).
      const meta = makeMeta({ agent: makeAgent(state), lastActivityAt: 1 });
      expect(DOCK_ROW_BUCKET_PRIORITY[bucket(meta, false)]).toBe(
        URGENCY_RANK[agentUrgency(makeAgent(state))],
      );
    });
  }

  it("excludes the dock-only tail buckets from the agent-state rank set", () => {
    // The three agent-state buckets share the shared urgency ranks; the dock's
    // own quieter tail (sleeping/parked/none) sits BELOW them. Pinning that the
    // tail ranks strictly above (later than) idle catches a future misroute that
    // sent an agent state into the tail (e.g. waiting→parked) — it would no
    // longer satisfy the parity assertion above, and this guards the boundary.
    const tail: DockRowBucket[] = ["sleeping", "parked", "none"];
    for (const bucketKey of tail) {
      expect(DOCK_ROW_BUCKET_PRIORITY[bucketKey]).toBeGreaterThan(
        URGENCY_RANK.idle,
      );
    }
  });
});

describe("rowRecencyAt — the one recency the window and the row display share", () => {
  // The dock keys the activity window AND the row's "Xs ago" cell on this same
  // value, so the age a row shows is the age that decides whether it's hidden.
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

  /** Flat splits of the tile — the depth-1 shape. */
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

    // The pane tree arrives from the store — the same index the canvas paints
    // as a tab strip. Re-ordering here made the dock and the canvas disagree
    // about which tab is second; the blocked split is surfaced by the dock's
    // needs-you strip instead, which moves nothing.
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
      // Same paint fold as a top-level shell row — identity mark, not blank.
      pip: "idle",
    });
  });

  it("classifies agent-bearing splits once for paint and attention consumers", () => {
    const sub = rank([AGENT_SPLIT])[0]?.subRows[0];
    expect(sub?.kind).toBe("agent");
    expect(sub).toMatchObject({ pip: "working" });
  });

  // The regression this describe block exists for: a split of a split is a real
  // parent→child edge and is NOT a top-level tile, so a ranker that stopped at
  // one hop left it with no dock row anywhere — invisible and unreachable, even
  // though the canvas painted it as a tab (#2059).
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
      // Depth-first, in the store's sibling order: a grandchild rides directly
      // under its own parent rather than being stranded beneath an unrelated
      // sibling. This held under the old urgency sort too — what changed is
      // that the sibling order is now the store's, so nothing can re-sort the
      // sequence out from under the indent.
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
        blocked, // the grandchild, directly under its own parent…
        AGENT_SPLIT, // …and only then the next top sibling.
      ]);
    });

    it("uses a GRANDCHILD's activity for the tile's window fate", () => {
      // A split shares its parent's window fate at any depth: a busy grandchild
      // must keep the whole tile — and therefore its own landing — in the dock.
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
      // An entry indented under a row that isn't there reads as a lie; the
      // reactive recomputation brings both back together.
      const missing = "split-missing" as TerminalId;
      metas[GRANDCHILD] = makeMeta({ lastActivityAt: 30 });
      const rows = rankTree([
        { id: missing, children: [{ id: GRANDCHILD, children: [] }] },
      ]);
      expect(rows[0]?.subRows).toEqual([]);
    });
  });
});
