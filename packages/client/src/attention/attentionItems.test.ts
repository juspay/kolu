/** THE WORDS OF EVERY ALERT, as pure functions — one table of what each
 *  source hands over, tested where a person would notice it: the title, the
 *  line under it, and where a click goes. */

import { Option } from "effect";
import type { MemoryNeed } from "kolu-common/conductorMemory";
import type { TerminalId } from "kolu-common/surface";
import type { NeedsYou } from "kolu-work";
import { describe, expect, it } from "vitest";
import {
  conversationItem,
  memoryItem,
  replyItems,
  terminalItem,
  workItem,
} from "./attentionItems";

const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;

const question = (work: string, ask: string): NeedsYou => ({
  work,
  title: "Agent chat",
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

describe("a terminal's item", () => {
  const subject = {
    title: "kolu/agents",
    description: "closing over the cache",
  };
  const base = { encHost: "local", hostLabel: "this machine", id: ID };

  it("asks for your input with the subject's title", () => {
    expect(terminalItem({ ...base, asking: true, subject })).toEqual({
      tag: `local/${ID}`,
      title: "kolu/agents needs your input",
      body: "closing over the cache",
      click: { kind: "terminal", host: "local", terminalId: ID },
      inFront: false,
    });
  });

  it("says the subject finished", () => {
    expect(terminalItem({ ...base, asking: false, subject }).title).toBe(
      "kolu/agents finished",
    );
  });

  it("names the host when there is no subject, asking", () => {
    expect(terminalItem({ ...base, asking: true, subject: undefined })).toEqual(
      {
        tag: `local/${ID}`,
        title: "An agent needs your input on this machine",
        body: undefined,
        click: { kind: "terminal", host: "local", terminalId: ID },
        inFront: false,
      },
    );
  });

  it("names the host when there is no subject, finished", () => {
    expect(
      terminalItem({ ...base, asking: false, subject: undefined }).title,
    ).toBe("An agent finished on this machine");
  });
});

describe("a work's item", () => {
  it("carries the question's ask, titled with the work and saying what is wanted", () => {
    expect(
      workItem(question("branch:local%2Fcode%2Fkolu", "a1"), false),
    ).toEqual({
      tag: 'work:["branch:local%2Fcode%2Fkolu","question","a1"]',
      title: "Agent chat",
      body: "May I?",
      click: { kind: "work", work: "branch:local%2Fcode%2Fkolu", ask: "a1" },
      inFront: false,
    });
  });

  it("carries no ask for a merge handed over", () => {
    const item = workItem(
      merge("branch:local%2Fcode%2Fkolu", 700, "c88"),
      true,
    );
    expect(item.click).toEqual({
      kind: "work",
      work: "branch:local%2Fcode%2Fkolu",
      ask: null,
    });
    expect(item.body).toBe("Merge PR #700");
    expect(item.inFront).toBe(true);
  });
});

describe("the conversation's own question", () => {
  it("says one question waits", () => {
    expect(conversationItem(1, false)).toEqual({
      tag: "conductor",
      title: "The conductor needs you",
      body: "One question is waiting",
      click: { kind: "conductor" },
      inFront: false,
    });
  });

  it("counts more than one", () => {
    expect(conversationItem(3, true)).toMatchObject({
      body: "3 questions are waiting",
      inFront: true,
    });
  });
});

describe("a memory proposal", () => {
  const waiting = (title: string | null, count: number): MemoryNeed => ({
    identity: "u2",
    count,
    title,
  });

  it("says what it would remember when there is one", () => {
    expect(memoryItem(waiting("Run the linter first", 1), false)).toEqual({
      tag: "memory",
      title: "The Conductor would like to remember something",
      body: "Run the linter first",
      click: { kind: "memory" },
      inFront: false,
    });
  });

  it("counts the batch when there are several", () => {
    expect(memoryItem(waiting(null, 4), true).body).toBe(
      "4 proposals are waiting",
    );
  });
});

describe("a finished reply to a message you typed", () => {
  const reply = { turn: "u1", text: "Done. More.", work: null };
  const WORK = "branch:local%2Fcode%2Fkolu";

  it("is nothing at all while the Conductor is in front of you", () => {
    expect(replyItems(reply, undefined, true)).toEqual([]);
  });

  it("says the Conductor replied, in its first sentence, opening the conversation", () => {
    expect(replyItems(reply, undefined, false)).toEqual([
      {
        tag: "reply:u1",
        title: "The Conductor replied",
        body: "Done.",
        click: { kind: "conductor" },
        inFront: false,
      },
    ]);
  });

  it("is titled with the work and opens its card, when the message was about one", () => {
    expect(
      replyItems({ ...reply, work: WORK }, "Page chats open in a pane", false),
    ).toEqual([
      {
        tag: "reply:u1",
        title: "Page chats open in a pane",
        body: "Done.",
        click: { kind: "work", work: WORK, ask: null },
        inFront: false,
      },
    ]);
  });

  it("says the Conductor replied when the work is one this browser does not know", () => {
    expect(replyItems({ ...reply, work: WORK }, undefined, false)).toEqual(
      replyItems(reply, undefined, false),
    );
  });
});
