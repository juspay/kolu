/** The reducer's three obligations: a snapshot ASSIGNS (the fence's replay must
 *  not double rows), a delta refines in place, and a streamed append splices at
 *  the offset the writer stamped. */

import type {
  ConductorFrame,
  ConductorRow,
  ConductorToolRow,
} from "kolu-common/conductor";
import { describe, expect, it } from "vitest";
import {
  applyFrame,
  EMPTY_TRANSCRIPT,
  foldFailureRuns,
  foldNoticeRuns,
  foldToolRuns,
  type TranscriptItem,
} from "./transcript";

const agentRow = (id: string, seq: number, text: string): ConductorRow => ({
  id,
  seq,
  since: "2026-01-01T00:00:00.000Z",
  kind: "agent",
  text,
});

const snapshot = (rows: ConductorRow[], seq = 1): ConductorFrame => ({
  kind: "snapshot",
  seq,
  rows,
});

const delta = (
  patch: Partial<Extract<ConductorFrame, { kind: "delta" }>>,
): ConductorFrame => ({
  kind: "delta",
  seq: 2,
  upserts: [],
  removes: [],
  appends: [],
  ...patch,
});

describe("applyFrame", () => {
  it("assigns on a snapshot rather than merging", () => {
    const first = applyFrame(
      EMPTY_TRANSCRIPT,
      snapshot([agentRow("a", 1, "x")]),
    );
    // What a reconnect delivers: the SAME row again, in a fresh snapshot.
    const second = applyFrame(first, snapshot([agentRow("a", 1, "x")], 7));
    expect(second.rows).toHaveLength(1);
    expect(second.seq).toBe(7);
  });

  it("orders a snapshot by seq, whatever order it arrived in", () => {
    const state = applyFrame(
      EMPTY_TRANSCRIPT,
      snapshot([agentRow("b", 2, "second"), agentRow("a", 1, "first")]),
    );
    expect(state.rows.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("upserts in place and inserts a new row at its seq", () => {
    const base = applyFrame(
      EMPTY_TRANSCRIPT,
      snapshot([agentRow("a", 1, "one"), agentRow("c", 3, "three")]),
    );
    const refined = applyFrame(
      base,
      delta({ upserts: [agentRow("a", 1, "ONE"), agentRow("b", 2, "two")] }),
    );
    expect(refined.rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(refined.rows[0]).toMatchObject({ text: "ONE" });
  });

  it("removes by id", () => {
    const base = applyFrame(
      EMPTY_TRANSCRIPT,
      snapshot([agentRow("a", 1, "one"), agentRow("b", 2, "two")]),
    );
    expect(applyFrame(base, delta({ removes: ["a"] })).rows).toHaveLength(1);
  });

  it("appends streamed prose at the stamped offset", () => {
    const base = applyFrame(
      EMPTY_TRANSCRIPT,
      snapshot([agentRow("a", 1, "Hel")]),
    );
    const grown = applyFrame(
      base,
      delta({ appends: [{ of: "a", at: 3, text: "lo" }] }),
    );
    expect(grown.rows[0]).toMatchObject({ text: "Hello" });
  });

  it("makes a re-delivered piece a no-op instead of a stutter", () => {
    const base = applyFrame(
      EMPTY_TRANSCRIPT,
      snapshot([agentRow("a", 1, "Hello")]),
    );
    const again = applyFrame(
      base,
      delta({ appends: [{ of: "a", at: 3, text: "lo" }] }),
    );
    expect(again.rows[0]).toMatchObject({ text: "Hello" });
  });

  it("ignores an append addressed to a row it does not have", () => {
    const base = applyFrame(
      EMPTY_TRANSCRIPT,
      snapshot([agentRow("a", 1, "x")]),
    );
    const after = applyFrame(
      base,
      delta({ appends: [{ of: "ghost", at: 0, text: "…" }] }),
    );
    expect(after.rows).toEqual(base.rows);
  });

  it("applies upserts before the appends that address them", () => {
    const state = applyFrame(
      EMPTY_TRANSCRIPT,
      delta({
        upserts: [agentRow("a", 1, "Hel")],
        appends: [{ of: "a", at: 3, text: "lo" }],
      }),
    );
    expect(state.rows[0]).toMatchObject({ text: "Hello" });
  });

  it("applies removes before the upserts that re-mint the same id", () => {
    // The canonical order is removes → upserts → appends (stated on
    // `ConductorFrameSchema`, obeyed by the host's fold too). A frame that
    // retires a row and re-states it — an ask settled and asked again — must
    // end with the row, not without it.
    const base = applyFrame(
      EMPTY_TRANSCRIPT,
      snapshot([agentRow("a", 1, "old")]),
    );
    const after = applyFrame(
      base,
      delta({ removes: ["a"], upserts: [agentRow("a", 1, "new")] }),
    );
    expect(after.rows).toEqual([agentRow("a", 1, "new")]);
  });
});

describe("foldNoticeRuns", () => {
  const notice = (id: string, seq: number, text: string): ConductorRow => ({
    id,
    seq,
    since: "2026-01-01T00:00:00.000Z",
    kind: "notice",
    text,
  });

  it("draws a run of identical notices ONCE, with its count", () => {
    // The field case: a fixed loop left eight copies of one exit notice in a
    // transcript that is already on disk. A reader rule, so they fold on read.
    const entries = foldNoticeRuns(
      Array.from({ length: 8 }, (_, i) =>
        notice(`n${i}`, i, "the agent exited"),
      ),
    );
    expect(entries).toEqual([
      { row: notice("n0", 0, "the agent exited"), repeat: 8 },
    ]);
  });

  it("keeps non-adjacent repeats apart — they are separate events", () => {
    const entries = foldNoticeRuns([
      notice("a", 1, "the agent exited"),
      agentRow("b", 2, "then it ran again"),
      notice("c", 3, "the agent exited"),
    ]);
    expect(entries.map((e) => [e.row.id, e.repeat])).toEqual([
      ["a", 1],
      ["b", 1],
      ["c", 1],
    ]);
  });

  it("folds only identical text, and only notices", () => {
    const entries = foldNoticeRuns([
      notice("a", 1, "exited (code 0)"),
      notice("b", 2, "exited (code 1)"),
      agentRow("c", 3, "same"),
      agentRow("d", 4, "same"),
    ]);
    expect(entries.map((e) => e.repeat)).toEqual([1, 1, 1, 1]);
  });
});

describe("foldToolRuns", () => {
  const SINCE = "2026-01-01T00:00:00.000Z";
  const TERMINAL = "11111111-1111-4111-8111-111111111111";
  const tool = (
    id: string,
    seq: number,
    extra: Partial<ConductorToolRow> = {},
  ): ConductorRow =>
    ({
      id,
      seq,
      since: SINCE,
      kind: "tool",
      text: id,
      status: "completed",
      ...extra,
    }) as ConductorToolRow;
  const user = (id: string, seq: number): ConductorRow => ({
    id,
    seq,
    since: SINCE,
    kind: "user",
    text: "hi",
    attachments: [],
  });
  const notice = (id: string, seq: number): ConductorRow => ({
    id,
    seq,
    since: SINCE,
    kind: "notice",
    text: "something happened",
  });
  /** What the panel draws, as `id` for a row and `[ids]` for a fold. */
  const drawn = (rows: ConductorRow[]): (string | string[])[] =>
    foldToolRuns(foldNoticeRuns(rows)).map((item: TranscriptItem) =>
      item.kind === "entry"
        ? item.entry.row.id
        : item.rows.map((row) => row.id),
    );

  it("folds the calls between two pieces of prose into ONE fold", () => {
    expect(
      drawn([
        agentRow("a", 1, "Looking."),
        tool("t1", 2),
        tool("t2", 3),
        tool("t3", 4),
        agentRow("b", 5, "Found it."),
      ]),
    ).toEqual(["a", ["t1", "t2", "t3"], "b"]);
  });

  it("folds a run's settled calls while the turn is still going, and leaves the running one out", () => {
    // The Conductor has not said a word yet: what a person sees is ONE
    // "Details" and the call in flight, not a wall of finished cards.
    expect(
      drawn([
        user("u", 0),
        tool("t1", 1),
        tool("t2", 2),
        tool("t3", 3, { status: "in_progress" }),
      ]),
    ).toEqual(["u", ["t1", "t2"], "t3"]);
  });

  it("folds the calls that open the transcript, before any boundary", () => {
    expect(
      drawn([
        tool("t0", 0),
        agentRow("a", 1, "Looked."),
        user("u1", 2),
        tool("t1", 3),
        tool("t2", 4),
        agentRow("b", 5, "Done."),
      ]),
    ).toEqual([["t0"], "a", "u1", ["t1", "t2"], "b"]);
  });

  it("never folds across what the human typed", () => {
    expect(
      drawn([
        agentRow("a", 1, "Looking."),
        tool("t1", 2),
        user("u1", 3),
        tool("t2", 4),
        agentRow("b", 5, "Done."),
      ]),
    ).toEqual(["a", ["t1"], "u1", ["t2"], "b"]);
  });

  it("keeps what a reader would lose in the flow, and folds the rest around it", () => {
    const rows = [
      agentRow("a", 1, "Starting the planner."),
      tool("done", 2),
      tool("running", 3, { status: "in_progress" }),
      tool("pending", 4, { status: "pending" }),
      tool("failed", 5, { status: "failed" }),
      tool("stranded", 6, { stranded: true }),
      tool("task-out", 7, {
        armed: { task: "t", description: null, ended: null, report: null },
      }),
      tool("task-over", 8, {
        armed: {
          task: "t",
          description: null,
          ended: "completed",
          report: null,
        },
      }),
      tool("agent-line", 9, {
        kolu: {
          kind: "create",
          terminalId: TERMINAL as never,
          host: "local",
          name: "planner",
          cwd: null,
          agent: null,
        },
      }),
      tool("create-no-terminal", 10, {
        kolu: {
          kind: "create",
          terminalId: null,
          host: null,
          name: "planner",
          cwd: null,
          agent: null,
        },
      }),
      notice("n", 11),
      agentRow("b", 12, "It is up."),
    ];
    expect(drawn(rows)).toEqual([
      "a",
      ["done", "task-over", "create-no-terminal"],
      "running",
      "pending",
      "failed",
      "stranded",
      "task-out",
      "agent-line",
      "n",
      "b",
    ]);
  });

  it("draws no fold when every call in the run stays in the flow", () => {
    expect(
      drawn([
        agentRow("a", 1, "Trying."),
        tool("failed", 2, { status: "failed" }),
        agentRow("b", 3, "That failed."),
      ]),
    ).toEqual(["a", "failed", "b"]);
  });

  it("keys the fold by the boundary before its run — steady as calls join and when prose closes it", () => {
    const keyOf = (rows: ConductorRow[]) =>
      foldToolRuns(foldNoticeRuns(rows)).find((item) => item.kind === "fold")
        ?.key;
    const working = keyOf([
      user("u", 0),
      tool("t1", 1),
      tool("t2", 2, { status: "in_progress" }),
    ]);
    const settled = keyOf([user("u", 0), tool("t1", 1), tool("t2", 2)]);
    const spoken = keyOf([
      user("u", 0),
      tool("t1", 1),
      tool("t2", 2),
      agentRow("b", 3, "Done."),
    ]);
    expect(working).toBe("fold:u");
    expect(settled).toBe(working);
    expect(spoken).toBe(working);
  });

  it("never folds across a wake — the machine's line STARTS a turn", () => {
    // The calls before the wake belong to the work that was running when the
    // terminal rang; folding across it would put the answer to the wake in the
    // same closed Details as whatever came before it.
    const wake = (id: string, seq: number): ConductorRow => ({
      id,
      seq,
      since: SINCE,
      kind: "wake",
      from: "kolu",
      events: [
        {
          ref: `local/${TERMINAL}`,
          host: "local",
          terminalId: TERMINAL as never,
          hostName: "local",
          name: "planner",
          agent: "claude-code",
          level: "stopped",
          at: SINCE,
        },
      ],
      text: "planner stopped",
    });
    expect(
      drawn([
        agentRow("a", 1, "Watching."),
        tool("t1", 2),
        wake("w", 3),
        tool("t2", 4),
        agentRow("b", 5, "Done."),
      ]),
    ).toEqual(["a", ["t1"], "w", ["t2"], "b"]);
  });
});

describe("foldFailureRuns", () => {
  const SINCE = "2026-01-01T00:00:00.000Z";
  /** A failed `screen_text` on one terminal, answered the way the MCP edge
   *  answers a terminal padi does not hold. */
  const unread = (id: string, seq: number, terminal: string): ConductorRow =>
    ({
      id,
      seq,
      since: SINCE,
      kind: "tool",
      text: "screen_text",
      status: "failed",
      tool: "screen_text",
      server: "kolu",
      progress: `\`\`\`\nsurface-mcp: Terminal ${terminal} not found\n\`\`\``,
      kolu: {
        kind: "screen",
        terminalId: terminal,
        host: "remote:srid@zest",
        name: null,
        snapshot: `surface-mcp: Terminal ${terminal} not found`,
      },
    }) as unknown as ConductorRow;
  const failed = (
    id: string,
    seq: number,
    tool: string,
    progress: string,
  ): ConductorRow =>
    ({
      id,
      seq,
      since: SINCE,
      kind: "tool",
      text: tool,
      status: "failed",
      tool,
      progress,
    }) as unknown as ConductorRow;
  const settled = (id: string, seq: number): ConductorRow =>
    ({
      id,
      seq,
      since: SINCE,
      kind: "tool",
      text: id,
      status: "completed",
    }) as unknown as ConductorRow;
  const user = (id: string, seq: number): ConductorRow => ({
    id,
    seq,
    since: SINCE,
    kind: "user",
    text: "status?",
    attachments: [],
  });
  const drawn = (rows: ConductorRow[]) =>
    foldFailureRuns(foldToolRuns(foldNoticeRuns(rows))).map(
      (item: TranscriptItem) =>
        item.kind === "failures"
          ? `${item.tool} ×${item.rows.length}: ${item.reason}`
          : item.kind === "fold"
            ? item.rows.map((row) => row.id)
            : item.entry.row.id,
    );

  it("says the same failure on six terminals ONCE, with the terminal taken out", () => {
    expect(
      drawn([
        user("u", 0),
        ...["a", "b", "c", "d", "e", "f"].map((t, i) =>
          unread(`s${i}`, i + 1, `${t}${t}${t}-terminal`),
        ),
      ]),
    ).toEqual(["u", "screen_text ×6: Terminal not found"]);
  });

  it("is a run as drawn: a settled call that joined a fold drawn earlier does not split it", () => {
    expect(
      drawn([
        user("u", 0),
        settled("look", 1),
        unread("s1", 2, "t1"),
        settled("ok", 3),
        unread("s2", 4, "t2"),
      ]),
    ).toEqual(["u", ["look", "ok"], "screen_text ×2: Terminal not found"]);
  });

  it("splits on a different reason, a different tool, and anything drawn between", () => {
    expect(
      drawn([
        user("u", 0),
        unread("s1", 1, "t1"),
        failed("x", 2, "screen_text", "the host is not connected"),
        failed("y", 3, "Bash", "exit 1"),
        failed("z", 4, "Bash", "exit 1"),
        user("u2", 5),
        failed("w", 6, "Bash", "exit 1"),
      ]),
    ).toEqual(["u", "s1", "x", "Bash ×2: exit 1", "u2", "w"]);
  });

  it("keys a run by its first failure, steady as more join it", () => {
    const keyOf = (count: number) =>
      foldFailureRuns(
        foldToolRuns(
          foldNoticeRuns(
            Array.from({ length: count }, (_, i) =>
              unread(`s${i}`, i, `t${i}`),
            ),
          ),
        ),
      ).find((item) => item.kind === "failures")?.key;
    expect(keyOf(2)).toBe("failures:s0");
    expect(keyOf(6)).toBe(keyOf(2));
  });
});
