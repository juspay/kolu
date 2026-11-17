/** The Conductor's bell: when something that needs you rings. Each case is
 *  one a person would notice — a stray ring for an old wait, a second ring for
 *  the same one, or a new one that stayed silent. */

import { Option } from "effect";
import type { NeedsYou } from "kolu-work";
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
  openAsks: needs.flatMap((one) =>
    one.why.why === "question" ? [one.why.ask] : [],
  ),
  ownAsks: [],
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
  return { bell: createConductorBell(hooks), rang, gates };
}

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
    // The works load one record at a time after the conversation's first
    // frame: a work met for the first time already waiting was waiting
    // before this browser looked.
    const { bell, rang } = harness();
    bell.observe(
      reading([], { works: new Set(), openAsks: ["a1"], ownAsks: ["a1"] }),
    );
    bell.observe(reading([question(KOLU, "a1"), merge(OLAI, 700, "c88")]));
    expect(rang).toEqual([]);
  });

  it("rings for a work born asking, whose record is new", () => {
    const { bell, rang } = harness();
    bell.observe(reading([], { works: new Set() }));
    bell.observe(reading([question(KOLU, "setup")]));
    expect(rang).toEqual([{ items: ["May I?"], own: null }]);
  });

  it("a question first heard as the conversation's own is not rung again when its work's record lands", () => {
    const { bell, rang } = harness();
    bell.observe(reading([], { works: new Set() }));
    bell.observe(
      reading([], { works: new Set(), openAsks: ["a1"], ownAsks: ["a1"] }),
    );
    bell.observe(reading([question(KOLU, "a1")]));
    expect(rang).toEqual([{ items: [], own: 1 }]);
  });

  it("the conversation's own question rings as today, quiet while the Conductor is in front of you", () => {
    const { bell, rang, gates } = harness();
    bell.observe(reading([]));
    bell.observe(reading([], { openAsks: ["c1"], ownAsks: ["c1"] }));
    gates.conversation = true;
    bell.observe(
      reading([], { openAsks: ["c1", "c2"], ownAsks: ["c1", "c2"] }),
    );
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
