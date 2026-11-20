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
  ...over,
});

function harness() {
  const rang: Array<{ items: string[]; own: number | null }> = [];
  const gates = {
    alerts: true,
    onScreen: new Set<string>(),
    conversation: false,
  };
  const hooks: ConductorBellHooks = {
    alertsEnabled: () => gates.alerts,
    isItemWatched: (item) => gates.onScreen.has(item.key),
    isConversationWatched: () => gates.conversation,
    deliver: (items, own) =>
      rang.push({ items: items.map((one) => one.wanted), own }),
  };
  const raw = createConductorBell(hooks);
  const bell = {
    observe: (one: BellReading): void => {
      raw.observe(one);
      raw.settle();
    },
  };
  return { bell, raw, rang, gates };
}

describe("the Conductor's bell decides after the page has drawn", () => {
  it("is silent for a question that arrives in view: its box says so only after it is drawn", () => {
    const { raw, rang, gates } = harness();
    raw.observe(reading([]));
    const asked = question(KOLU, "a1");
    expect(raw.observe(reading([asked]))).toBe(true);
    gates.onScreen.add(asked.key);
    raw.settle();
    expect(rang).toEqual([]);
  });

  it("does not ring for an item that left the list before the page drew", () => {
    const { raw, rang } = harness();
    raw.observe(reading([]));
    raw.observe(reading([merge(OLAI, 2400, "d3f4185")]));
    raw.observe(reading([]));
    raw.settle();
    expect(rang).toEqual([]);
  });
});

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

  it("is silent while that very item is on screen in a focused window, and stays heard", () => {
    const { bell, rang, gates } = harness();
    bell.observe(reading([]));
    const green = merge(OLAI, 700, "c88");
    gates.onScreen.add(green.key);
    bell.observe(reading([green]));
    gates.onScreen.clear();
    bell.observe(reading([green]));
    expect(rang).toEqual([]);
  });

  it("rings while the Conductor is open on ANOTHER card", () => {
    const { bell, rang, gates } = harness();
    bell.observe(reading([]));
    gates.conversation = true;
    gates.onScreen.add(merge(OLAI, 700, "c88").key);
    bell.observe(reading([question(KOLU, "a1")]));
    expect(rang).toEqual([{ items: ["May I?"], own: null }]);
  });

  it("does not ring for a work's wait it only discovers as its record arrives", () => {
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
    const { raw, rang, gates } = harness();
    raw.observe(reading([], { works: new Set() }));
    gates.conversation = true;
    raw.observe(reading([], { works: new Set(), workAsks: ["a1"] }));
    raw.settle();
    expect(rang).toEqual([]);
    const asked = question(KOLU, "a1");
    raw.observe(reading([asked]));
    raw.settle();
    expect(rang).toEqual([{ items: ["May I?"], own: null }]);
    const second = harness();
    second.raw.observe(reading([], { works: new Set() }));
    second.raw.observe(reading([], { works: new Set(), workAsks: ["a1"] }));
    second.raw.settle();
    second.raw.observe(reading([asked]));
    second.gates.onScreen.add(asked.key);
    second.raw.settle();
    expect(second.rang).toEqual([]);
  });

  it("the conversation's own question rings as today, quiet while the Conductor is in front of you", () => {
    const { bell, rang, gates } = harness();
    bell.observe(reading([]));
    bell.observe(reading([], { ownAsks: ["c1"] }));
    gates.conversation = true;
    bell.observe(reading([], { ownAsks: ["c1", "c2"] }));
    expect(rang).toEqual([{ items: [], own: 1 }]);
  });

  it("alerts off: silent, and turning them on afterwards does not ring for that item", () => {
    const { bell, rang, gates } = harness();
    bell.observe(reading([]));
    gates.alerts = false;
    bell.observe(reading([question(KOLU, "a1")]));
    gates.alerts = true;
    bell.observe(reading([question(KOLU, "a1")]));
    expect(rang).toEqual([]);
  });
});

describe("the Conductor's bell, over real work records", () => {
  const KEY = {
    kind: "branch",
    host: "local",
    repo: "/code/olai",
    branch: "chat-in-a-pane",
  } as const;
  const ID = workIdOf(KEY);
  const AT = (minute: number): string =>
    new Date(Date.UTC(2026, 10, 18, 1, minute)).toISOString();

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
