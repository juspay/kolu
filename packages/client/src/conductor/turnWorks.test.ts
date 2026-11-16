/** Which works a chat turn is about — read off the rows already in it and the
 *  works' own timelines. */

import type { ConductorRow } from "kolu-common/conductor";
import { endWork, joinWork, openWork, type Work, type WorkId } from "kolu-work";
import { describe, expect, it } from "vitest";
import { turnWorks } from "./turnWorks";

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
      key: { kind: "branch", host: "local", repo: "/r", branch },
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

const user = (id: string, minute: number, mentions: string[] = []) =>
  ({
    ...row(id, minute),
    kind: "user",
    text: "hello",
    attachments: [],
    mentions: mentions.map((terminalId) => ({
      terminalId: terminalId as never,
      host: "local",
      name: "t",
      intent: null,
      cwd: null,
    })),
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

describe("the works of a chat turn", () => {
  const works = new Map<WorkId, Work>([
    [A, work("a", [[`local/${PLANNER}`, 1]])],
    [B, work("b", [[`local/${IMPLEMENTOR}`, 2]])],
  ]);

  it("is the work of the terminal a wake-up rang for, on every row of the turn", () => {
    const rows = [wake("w", 5, PLANNER), agent("r", 6)];
    const out = turnWorks(rows, works);
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
    expect(turnWorks(rows, works).get("r")).toEqual([B, A]);
  });

  it("carries nothing over to a turn that names no work", () => {
    const rows = [wake("w", 5, PLANNER), agent("r1", 6), user("u", 7)];
    const out = turnWorks(rows, works);
    expect(out.get("w")).toEqual([A]);
    expect(out.get("u")).toEqual([]);
  });

  it("still finds a work that has finished", () => {
    const ended = new Map(works);
    const one = ended.get(A);
    if (one !== undefined)
      ended.set(
        A,
        endWork(one, { outcome: { kind: "merged", pr: 1 }, at: at(4) }),
      );
    expect(turnWorks([wake("w", 9, PLANNER)], ended).get("w")).toEqual([A]);
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
    const out = turnWorks(rows, moved);
    expect(out.get("early")).toEqual([A]);
    expect(out.get("late")).toEqual([B]);
  });

  it("names nothing for a terminal no work ever held", () => {
    expect(turnWorks([wake("w", 5, STRAY)], works).get("w")).toEqual([]);
  });
});
