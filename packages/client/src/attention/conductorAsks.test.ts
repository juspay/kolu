/** The Conductor's bell: when something that needs you rings. Each case is
 *  one a person would notice — a stray ring for an old wait, a second ring for
 *  the same one, or a new one that stayed silent. */

import { Option } from "effect";
import {
  ABOUT_WORK,
  answerAsk,
  askQuestions,
  joinWork,
  type NeedsYou,
  needsYou,
  openWork,
  type Question,
  recordEvent,
  type Work,
  type WorkEvent,
  workIdOf,
} from "kolu-work";
import { describe, expect, it } from "vitest";
import {
  type BellReading,
  type ConductorBellHooks,
  createConductorBell,
} from "./conductorAsks";

const OLAI = "branch:local/%2Fcode%2Folai/chat-on-any-entity";
const KOLU = "branch:local/%2Fcode%2Fkolu/agents-closure-in-cache";

const question = (work: string, ask: string): NeedsYou => ({
  work,
  title: work === OLAI ? "Agent chat" : "Published agents",
  why: { why: "question", ask, question: "May I?", since: "t" },
  since: "t",
  wanted: "May I?",
  key: JSON.stringify([work, "question", ask]),
});

const merge = (work: string, pr: number, sha: string): NeedsYou => ({
  work,
  title: "Agent chat",
  why: {
    why: "merge",
    pr: Option.some({
      number: pr,
      head: { kind: "commit", sha },
      link: { kind: "unrecorded" },
    }),
    since: "t",
  },
  since: "t",
  wanted: `Merge PR #${pr}`,
  key: JSON.stringify([work, "merge", String(pr), sha]),
});

const reading = (
  needs: ReadonlyArray<NeedsYou>,
  over: Partial<BellReading> = {},
): BellReading => ({
  ownAsks: [],
  workAsks: needs.flatMap((one) =>
    one.why.why === "question" ? [one.why.ask] : [],
  ),
  works: new Set([OLAI, KOLU]),
  needs,
  memory: null,
  reply: undefined,
  ...over,
});

function harness() {
  const rang: Array<{ items: string[]; own: number | null }> = [];
  const memoryRang: string[] = [];
  const replies: string[] = [];
  const hooks: ConductorBellHooks = {
    deliver: (one) => {
      if (one.items.length > 0 || one.ownOpen !== null)
        rang.push({
          items: one.items.map((item) => item.wanted),
          own: one.ownOpen,
        });
      if (one.memory !== null) memoryRang.push(one.memory.identity);
      if (one.reply !== null) replies.push(one.reply.turn);
    },
  };
  const bell = createConductorBell(hooks);
  return { bell, rang, memoryRang, replies };
}

/** A finished reply to a message a person typed. */
const typed = (turn: string) => ({ turn, text: "Done. More.", work: null });

describe("the Conductor's bell", () => {
  it("the first reading never rings, even with waits already open (a reload)", () => {
    const { bell, rang } = harness();
    bell.observe(reading([question(KOLU, "a1"), merge(OLAI, 700, "c88")]));
    expect(rang).toEqual([]);
  });

  it("a question put about a work rings once, by its words", () => {
    const { bell, rang } = harness();
    bell.observe(reading([]));
    bell.observe(reading([question(KOLU, "a1")]));
    bell.observe(reading([question(KOLU, "a1")]));
    expect(rang).toEqual([{ items: ["May I?"], own: null }]);
  });

  it("a hand-over PR going green rings, for a work this browser already knew", () => {
    const { bell, rang } = harness();
    bell.observe(reading([]));
    bell.observe(reading([merge(OLAI, 700, "c88")]));
    expect(rang).toEqual([{ items: ["Merge PR #700"], own: null }]);
  });

  it("#2400's flicker — can, cannot, can on one commit — is one ring", () => {
    const { bell, rang } = harness();
    bell.observe(reading([]));
    bell.observe(reading([merge(OLAI, 2400, "d3f4185")]));
    bell.observe(reading([]));
    bell.observe(reading([merge(OLAI, 2400, "d3f4185")]));
    expect(rang).toHaveLength(1);
  });

  it("a second commit going green rings again", () => {
    const { bell, rang } = harness();
    bell.observe(reading([]));
    bell.observe(reading([merge(OLAI, 2400, "d3f4185")]));
    bell.observe(reading([]));
    bell.observe(reading([merge(OLAI, 2400, "69b08e9")]));
    expect(rang).toHaveLength(2);
  });

  it("does not ring for a work's wait it only discovers as its record arrives", () => {
    // The works load one record at a time after the conversation's first
    // frame: a work met for the first time already waiting was waiting
    // before this browser looked.
    const { bell, rang } = harness();
    bell.observe(reading([], { works: new Set(), workAsks: ["a1"] }));
    bell.observe(reading([question(KOLU, "a1"), merge(OLAI, 700, "c88")]));
    expect(rang).toEqual([]);
  });

  it("rings for a work born asking, whose record is new", () => {
    const { bell, rang } = harness();
    bell.observe(reading([], { works: new Set() }));
    bell.observe(reading([question(KOLU, "setup")]));
    expect(rang).toEqual([{ items: ["May I?"], own: null }]);
  });

  it("judges a work's question by its work, though the question arrives before the work's record", () => {
    const { bell, rang } = harness();
    bell.observe(reading([], { works: new Set() }));
    bell.observe(reading([], { works: new Set(), workAsks: ["a1"] }));
    expect(rang).toEqual([]);
    bell.observe(reading([question(KOLU, "a1")]));
    expect(rang).toEqual([{ items: ["May I?"], own: null }]);
  });

  it("each new question of the conversation's own rings, with how many are open", () => {
    const { bell, rang } = harness();
    bell.observe(reading([]));
    bell.observe(reading([], { ownAsks: ["c1"] }));
    bell.observe(reading([], { ownAsks: ["c1", "c2"] }));
    expect(rang).toEqual([
      { items: [], own: 1 },
      { items: [], own: 2 },
    ]);
  });
});

describe("the Conductor's bell, for a reply to a message you typed", () => {
  it("does not ring for the first reply it has a reading of", () => {
    const { bell, replies } = harness();
    bell.observe(reading([]));
    bell.observe(reading([], { reply: typed("u1") }));
    expect(replies).toEqual([]);
  });

  it("rings once for a new reply", () => {
    const { bell, replies } = harness();
    bell.observe(reading([]));
    bell.observe(reading([], { reply: typed("u1") }));
    bell.observe(reading([], { reply: typed("u2") }));
    bell.observe(reading([], { reply: typed("u2") }));
    expect(replies).toEqual(["u2"]);
  });

  it("rings again for a later reply", () => {
    const { bell, replies } = harness();
    bell.observe(reading([]));
    bell.observe(reading([], { reply: typed("u1") }));
    bell.observe(reading([], { reply: typed("u2") }));
    bell.observe(reading([], { reply: typed("u3") }));
    expect(replies).toEqual(["u2", "u3"]);
  });

  it("rings nothing more when no reply is finished", () => {
    const { bell, replies } = harness();
    bell.observe(reading([]));
    bell.observe(reading([], { reply: typed("u1") }));
    bell.observe(reading([], { reply: typed("u2") }));
    bell.observe(reading([], { reply: null }));
    expect(replies).toEqual(["u2"]);
  });
});

describe("the Conductor's bell, over real work records", () => {
  const KEY = {
    kind: "branch",
    host: "local",
    repo: "/code/olai",
    branch: "chat-in-a-pane",
    repoBy: "git",
  } as const;
  const ID = workIdOf(KEY);
  const AT = (minute: number): string =>
    new Date(Date.UTC(2026, 10, 18, 1, minute)).toISOString();

  /** A full work set to hand its PR over on green, its implementor working. */
  const handOver = (): Work => {
    const questions = [
      {
        id: "q-mode",
        topic: "setup",
        key: "mode",
        question: "Which mode?",
        options: ["full", "trivial"],
        given: { kind: "ask" },
      },
      {
        id: "q-green",
        topic: "setup",
        key: "on-green",
        question: "On green?",
        options: ["merge", "hand-over"],
        given: { kind: "ask" },
      },
    ] as const satisfies ReadonlyArray<Question>;
    const opened = openWork({
      key: KEY,
      title: "Page chats open in a pane",
      at: AT(0),
      request: { kind: "said", text: "waterfall it" },
    });
    const set = answerAsk(
      askQuestions(opened, { ask: "setup", questions, at: AT(1) }),
      {
        ask: "setup",
        at: AT(2),
        from: "card",
        reply: {
          kind: "answered",
          values: new Map([
            ["q-mode", ["full"]],
            ["q-green", ["hand-over"]],
          ]),
        },
      },
    );
    return joinWork(set, {
      terminal: "local/implementor",
      role: "implementor",
      at: AT(3),
    });
  };
  const HEAD = { kind: "commit", sha: "c88e0a1" } as const;
  const forge = (minute: number, event: Partial<WorkEvent>): WorkEvent =>
    ({ at: AT(minute), by: "kolu", about: ABOUT_WORK, ...event }) as WorkEvent;

  it("never rings for a green draft, and rings once when it is marked ready", () => {
    const { bell, rang } = harness();
    const read = (work: Work) =>
      bell.observe(reading(needsYou([[ID, work]]), { works: new Set([ID]) }));
    let work = handOver();
    read(work);
    work = [
      forge(10, {
        kind: "pr-opened",
        pr: 702,
        title: "Page chats open in a pane",
        url: { kind: "link", href: "https://github.com/o/olai/pull/702" },
        draft: "draft",
      }),
      forge(20, {
        kind: "checks-passed",
        by: "ci",
        pr: 702,
        head: HEAD,
        failing: [],
      }),
      // What GitHub answers for a green draft. Even on the record, it is
      // not a merge anybody can do.
      forge(20, {
        kind: "merge-state",
        pr: 702,
        head: HEAD,
        merge: { kind: "can" },
      }),
    ].reduce(recordEvent, work);
    read(work);
    expect(rang).toEqual([]);
    work = [
      forge(30, { kind: "draft-state", pr: 702, draft: "ready" }),
      forge(30, {
        kind: "merge-state",
        pr: 702,
        head: HEAD,
        merge: { kind: "can" },
      }),
    ].reduce(recordEvent, work);
    read(work);
    read(work);
    expect(rang).toEqual([{ items: ["Merge PR #702"], own: null }]);
  });
});

describe("the Conductor's bell, for memory", () => {
  const waiting = (identity: string, count: number) => ({
    identity,
    count,
    title: count === 1 ? "Run the linter first" : null,
  });

  it("never rings on the first reading, however much waits", () => {
    const { bell, memoryRang } = harness();
    bell.observe(reading([], { memory: waiting("u1", 3) }));
    expect(memoryRang).toEqual([]);
  });

  it("rings once for a batch, however many proposals it holds", () => {
    const { bell, memoryRang } = harness();
    bell.observe(reading([]));
    bell.observe(reading([], { memory: waiting("u2", 1) }));
    bell.observe(reading([], { memory: waiting("u2", 2) }));
    bell.observe(reading([], { memory: waiting("u2", 5) }));
    expect(memoryRang).toEqual(["u2"]);
  });

  it("rings again for a proposal from a later turn", () => {
    const { bell, memoryRang } = harness();
    bell.observe(reading([]));
    bell.observe(reading([], { memory: waiting("u2", 1) }));
    bell.observe(reading([], { memory: waiting("u3", 2) }));
    expect(memoryRang).toEqual(["u2", "u3"]);
  });

  it("takes the memory's own first frame as its baseline, even after the conversation's", () => {
    const { bell, memoryRang } = harness();
    bell.observe(reading([], { memory: undefined }));
    bell.observe(reading([], { memory: waiting("u1", 2) }));
    expect(memoryRang).toEqual([]);
    bell.observe(reading([], { memory: waiting("u4", 3) }));
    expect(memoryRang).toEqual(["u4"]);
  });
});
