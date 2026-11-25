/** Which works a chat turn is about — read off the rows already in it and the
 *  works' own timelines. */

import type { ConductorRow } from "kolu-common/conductor";
import { endWork, joinWork, openWork, type Work, type WorkId } from "kolu-work";
import { describe, expect, it } from "vitest";
import {
  AT_THE_END,
  WHILE_B_WAITS,
  WORK_OF_A,
  WORK_OF_B,
} from "./replyAcrossTurns.testlib";
import { chatTurns, joinsOf, turnWorks } from "./turnWorks";

const PLANNER = "11111111-1111-4111-8111-111111111111";
const IMPLEMENTOR = "22222222-2222-4222-8222-222222222222";
const STRAY = "33333333-3333-4333-8333-333333333333";

const at = (minute: number): string =>
  new Date(Date.UTC(2026, 10, 16, 12, minute)).toISOString();

const work = (
  branch: string,
  members: ReadonlyArray<readonly [string, number]>,
): Work =>
  members.reduce(
    (one, [terminal, minute]) =>
      joinWork(one, { terminal, role: "planner", at: at(minute) }),
    openWork({
      key: {
        kind: "branch",
        host: "local",
        repo: "/r",
        branch,
        repoBy: { kind: "git" },
      },
      title: branch,
      at: at(0),
      request: { kind: "none" },
    }),
  );

const A: WorkId = "branch:local/%2Fr/a";
const B: WorkId = "branch:local/%2Fr/b";

const row = (id: string, minute: number) => ({
  id,
  seq: minute,
  since: at(minute),
});

/** A message of yours, naming terminals and — since a mention is either —
 *  pieces of work. */
const user = (
  id: string,
  minute: number,
  mentions: string[] = [],
  works: WorkId[] = [],
) =>
  ({
    ...row(id, minute),
    kind: "user",
    text: "hello",
    attachments: [],
    mentions: [
      ...mentions.map((terminalId) => ({
        kind: "terminal" as const,
        terminalId: terminalId as never,
        host: "local",
        name: "t",
        intent: null,
        cwd: null,
      })),
      ...works.map((work) => ({
        kind: "work" as const,
        work,
        title: "a work",
      })),
    ],
  }) satisfies ConductorRow;

const agent = (id: string, minute: number) =>
  ({ ...row(id, minute), kind: "agent", text: "ok" }) satisfies ConductorRow;

const wake = (id: string, minute: number, terminalId: string) =>
  ({
    ...row(id, minute),
    kind: "wake",
    from: "kolu",
    events: [
      {
        ref: `local/${terminalId}`,
        host: "local",
        terminalId: terminalId as never,
        hostName: "local",
        name: "planner",
        agent: "claude-code",
        level: "stopped",
        at: at(minute),
      },
    ],
    text: "planner stopped",
  }) satisfies ConductorRow;

const tool = (id: string, minute: number, terminalId: string) =>
  ({
    ...row(id, minute),
    kind: "tool",
    text: "screen_text",
    status: "completed",
    kolu: {
      kind: "screen",
      terminalId: terminalId as never,
      host: "local",
      name: "t",
      snapshot: null,
    },
  }) satisfies ConductorRow;

const workAsk = (id: string, minute: number, of: WorkId) =>
  ({
    ...row(id, minute),
    kind: "work-ask",
    text: "Approve the plan?",
    ask: { fields: [], standing: { kind: "open" } },
    work: of,
  }) satisfies ConductorRow;

/** The works of each row's turn, as the transcript reads them. */
const read = (
  rows: readonly ConductorRow[],
  works: ReadonlyMap<WorkId, Work>,
): ReadonlyMap<string, ReadonlyArray<WorkId>> =>
  new Map(
    [...turnWorks(rows, works, joinsOf(works))].map(([id, turn]) => [
      id,
      turn.works,
    ]),
  );

describe("the works of a chat turn", () => {
  const works = new Map<WorkId, Work>([
    [A, work("a", [[`local/${PLANNER}`, 1]])],
    [B, work("b", [[`local/${IMPLEMENTOR}`, 2]])],
  ]);

  it("is the work of the terminal a wake-up rang for, on every row of the turn", () => {
    const out = read([wake("w", 5, PLANNER), agent("r", 6)], works);
    expect(out.get("w")).toEqual([A]);
    expect(out.get("r")).toEqual([A]);
  });

  it("collects what the turn's tool calls, questions and mentions name, in order", () => {
    const rows = [
      user("u", 5, [IMPLEMENTOR]),
      tool("t", 6, PLANNER),
      workAsk("q", 7, B),
      agent("r", 8),
    ];
    expect(read(rows, works).get("r")).toEqual([B, A]);
  });

  it("reads a WORK you mentioned as the work of that turn, outright", () => {
    // No terminal of B is named anywhere in the turn: the mention says the
    // work itself, which is what `@page-chats-open-in-a-pane` sends.
    const rows = [user("u", 5, [], [B]), agent("r", 6)];
    expect(read(rows, works).get("r")).toEqual([B]);
  });

  it("names a work it mentioned and the work of a terminal it mentioned", () => {
    const rows = [user("u", 5, [PLANNER], [B]), agent("r", 6)];
    expect(read(rows, works).get("u")).toEqual([A, B]);
  });

  it("names nothing for a work the mirror no longer lists", () => {
    const gone = "branch:local/%2Fr/gone" as WorkId;
    expect(read([user("u", 5, [], [gone])], works).get("u")).toEqual([]);
  });

  it("carries nothing over to a turn that names no work", () => {
    const out = read(
      [wake("w", 5, PLANNER), agent("r1", 6), user("u", 7)],
      works,
    );
    expect(out.get("w")).toEqual([A]);
    expect(out.get("u")).toEqual([]);
  });

  it("names the row that starts each turn, a turn with no prompt row too", () => {
    // Rows before the first prompt are a turn of their own: its works are
    // drawn on its first row, whatever kind that is.
    const rows = [
      tool("t0", 1, PLANNER),
      agent("r0", 2),
      wake("w", 5, PLANNER),
    ];
    const turns = turnWorks(rows, works, joinsOf(works));
    expect(turns.get("r0")).toEqual({ head: "t0", works: [A] });
    expect(turns.get("w")?.head).toBe("w");
  });

  it("still finds a work that has finished", () => {
    const ended = new Map(works);
    const one = ended.get(A);
    if (one !== undefined)
      ended.set(
        A,
        endWork(one, { outcome: { kind: "merged", pr: 1 }, at: at(4) }),
      );
    expect(read([wake("w", 9, PLANNER)], ended).get("w")).toEqual([A]);
  });

  it("reads a terminal that moved as the work it had joined by the end of the turn", () => {
    const moved = new Map<WorkId, Work>([
      [A, work("a", [[`local/${STRAY}`, 1]])],
      [B, work("b", [[`local/${STRAY}`, 20]])],
    ]);
    const rows = [
      wake("early", 5, STRAY),
      agent("r", 6),
      user("u", 10),
      wake("late", 25, STRAY),
    ];
    const out = read(rows, moved);
    expect(out.get("early")).toEqual([A]);
    expect(out.get("late")).toEqual([B]);
  });

  it("names nothing for a terminal no work ever held", () => {
    expect(read([wake("w", 5, STRAY)], works).get("w")).toEqual([]);
  });
});

describe("a reply still being written when the next message is sent (#2420)", () => {
  const works = new Map<WorkId, Work>([
    [WORK_OF_A, work("a", [])],
    [WORK_OF_B, work("b", [])],
  ]);
  const ids = (rows: readonly ConductorRow[]): string[] =>
    rows.map((one) => one.id);
  const groups = (rows: readonly ConductorRow[]): string[][] =>
    chatTurns(rows).map((turn) => ids(turn.rows));

  it("keeps the rest of the reply in the first turn while the next message waits, with the first turn's work", () => {
    expect(groups(WHILE_B_WAITS)).toEqual([
      ["user:1", "agent:2", "tool:call-of-A", "agent:4"],
      ["user:3"],
    ]);
    const turns = turnWorks(WHILE_B_WAITS, works, joinsOf(works));
    for (const id of ["agent:2", "tool:call-of-A", "agent:4"])
      expect([id, turns.get(id)]).toEqual([
        id,
        { head: "user:1", works: [WORK_OF_A] },
      ]);
    expect(turns.get("user:3")).toEqual({
      head: "user:3",
      works: [WORK_OF_B],
    });
  });

  it("gives each turn its own reply once both are over", () => {
    expect(groups(AT_THE_END)).toEqual([
      ["user:1", "agent:2", "tool:call-of-A", "agent:4"],
      ["user:3", "agent:5"],
    ]);
    const turns = turnWorks(AT_THE_END, works, joinsOf(works));
    expect(turns.get("agent:5")).toEqual({
      head: "user:3",
      works: [WORK_OF_B],
    });
  });

  it("draws the whole first turn, then the message, then its reply — although `seq` puts the message first", () => {
    expect(chatTurns(AT_THE_END).flatMap((turn) => ids(turn.rows))).toEqual([
      "user:1",
      "agent:2",
      "tool:call-of-A",
      "agent:4",
      "user:3",
      "agent:5",
    ]);
  });

  it("gives the same turns when handed the order it draws them in", () => {
    const drawn = chatTurns(AT_THE_END).flatMap((turn) => turn.rows);
    expect(chatTurns(drawn)).toEqual(chatTurns(AT_THE_END));
  });

  it("keeps a message steered into a turn inside that turn, where it was typed", () => {
    const rows: ConductorRow[] = [
      user("u1", 1),
      { ...agent("a2", 2), turn: "u1" },
      { ...user("u3", 3), turn: "u1" },
      { ...agent("a4", 4), turn: "u1" },
    ];
    expect(groups(rows)).toEqual([["u1", "a2", "u3", "a4"]]);
  });

  it("makes a row whose message is not in the list a turn of its own, where it is", () => {
    // The saved chat keeps its newest rows only, so a reply can outlive the
    // message it answers. The message next to it does not adopt it.
    expect(
      groups([
        { ...agent("a0", 1), turn: "user:0" },
        user("u", 2),
        { ...agent("r", 3), turn: "u" },
        { ...agent("x", 4), turn: "gone" },
      ]),
    ).toEqual([["a0"], ["u", "r"], ["x"]]);
  });

  it("reads a terminal that moved after the next message was sent, and before the first turn ended, for the first turn", () => {
    const moved = new Map<WorkId, Work>([
      [A, work("a", [[`local/${STRAY}`, 1]])],
      [B, work("b", [[`local/${STRAY}`, 7]])],
    ]);
    const rows: ConductorRow[] = [
      user("u1", 5, [STRAY]),
      user("u3", 6),
      { ...agent("a4", 8), turn: "u1" },
      { ...agent("a5", 9), turn: "u3" },
    ];
    // The first turn ran until the second one STARTED (its first reply, at
    // minute 9), not until the second message was typed (minute 6): the
    // terminal joined work B at minute 7, inside the first turn.
    expect(read(rows, moved).get("u1")).toEqual([B]);
  });

  it("starts a turn whose message never waited at its first reply too, so the turn before runs through its thinking time", () => {
    // ON RECORD, as a choice: once `queued` comes off, a row cannot say it
    // ever waited, so every turn is taken to start at its first reply. Here
    // the second message was sent with nothing running (minute 6) and the
    // terminal moved at minute 7, before that turn's first reply (minute 8):
    // the move is read for the FIRST turn.
    const moved = new Map<WorkId, Work>([
      [A, work("a", [[`local/${STRAY}`, 1]])],
      [B, work("b", [[`local/${STRAY}`, 7]])],
    ]);
    const rows: ConductorRow[] = [
      user("u1", 2, [STRAY]),
      { ...agent("a1", 3), turn: "u1" },
      user("u2", 6),
      { ...agent("a2", 8), turn: "u2" },
    ];
    expect(read(rows, moved).get("u1")).toEqual([B]);
  });
});
