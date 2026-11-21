/** THE REPLY TO A MESSAGE A PERSON TYPED, read off the chat already in this
 *  page. Each case is one a person would notice: a chime for a reply they
 *  already saw arrive, for a question that rings for itself, or for words
 *  still being written. */

import type { ConductorRow } from "kolu-common/conductor";
import { describe, expect, it } from "vitest";
import { finishedReplyOf } from "./typedReply";
import { AT_THE_END } from "./replyAcrossTurns.testlib";

const at = (minute: number): string =>
  new Date(Date.UTC(2026, 10, 17, 3, minute)).toISOString();

const head = (id: string, minute: number) => ({
  id,
  seq: minute,
  since: at(minute),
});

const user = (id: string, minute: number): ConductorRow => ({
  ...head(id, minute),
  kind: "user",
  text: "what is left?",
  attachments: [],
});

const agent = (id: string, minute: number, text: string): ConductorRow => ({
  ...head(id, minute),
  kind: "agent",
  text,
});

const wake = (id: string, minute: number): ConductorRow => ({
  ...head(id, minute),
  kind: "wake",
  from: "kolu",
  events: [],
  text: "the planner stopped",
});

const workAsk = (id: string, minute: number): ConductorRow => ({
  ...head(id, minute),
  kind: "work-ask",
  text: "May I update master's required checks?",
  work: "branch:local/%2Fr/a",
  ask: { fields: [], standing: { kind: "open" } },
});

describe("the newest finished reply to a message a person typed", () => {
  it("is nothing while a turn is running, even when a second message was typed into it", () => {
    expect(
      finishedReplyOf(
        [user("u1", 0), agent("a1", 1, "Looking into it."), user("u2", 2)],
        true,
      ),
    ).toBeNull();
  });

  it("gives the whole answer once that turn ends, under the second message", () => {
    expect(
      finishedReplyOf(
        [
          user("u1", 0),
          agent("a1", 1, "Looking into it."),
          user("u2", 2),
          agent("a2", 3, "Both are done."),
        ],
        false,
      ),
    ).toEqual({ turn: "u2", text: "Both are done." });
  });

  it("takes the turn's last words, not its first", () => {
    expect(
      finishedReplyOf(
        [
          user("u1", 0),
          agent("a1", 1, "Done."),
          agent("a2", 2, "PR #7 is open."),
        ],
        false,
      ),
    ).toEqual({ turn: "u1", text: "PR #7 is open." });
  });

  it("is nothing while a turn is running: the newest finished one is the running one", () => {
    expect(
      finishedReplyOf(
        [
          user("u1", 0),
          agent("a1", 1, "Done."),
          agent("a2", 2, "PR #7 is open."),
        ],
        true,
      ),
    ).toBeNull();
  });

  it("reaches back past a message kolu itself sent", () => {
    expect(
      finishedReplyOf(
        [user("u1", 0), agent("a1", 1, "Done."), wake("w1", 2)],
        true,
      ),
    ).toEqual({ turn: "u1", text: "Done." });
  });

  it("skips a message still queued behind another turn", () => {
    expect(
      finishedReplyOf(
        [
          user("u1", 0),
          agent("a1", 1, "Done."),
          { ...user("u2", 2), queued: true } as ConductorRow,
        ],
        true,
      ),
    ).toBeNull();
  });

  it("skips a message that was refused", () => {
    expect(
      finishedReplyOf(
        [
          user("u1", 0),
          agent("a1", 1, "Done."),
          { ...user("u2", 2), delivery: "refused" } as ConductorRow,
        ],
        false,
      ),
    ).toEqual({ turn: "u1", text: "Done." });
  });

  it("is nothing for a turn kolu started itself", () => {
    expect(
      finishedReplyOf(
        [wake("w1", 0), agent("a1", 1, "The planner stopped.")],
        false,
      ),
    ).toBeNull();
  });

  it("is nothing when the reply said nothing", () => {
    expect(finishedReplyOf([user("u1", 0)], false)).toBeNull();
    expect(
      finishedReplyOf([user("u1", 0), agent("a1", 1, "   ")], false),
    ).toBeNull();
  });

  it("is nothing while the last words are still streaming", () => {
    expect(
      finishedReplyOf(
        [
          user("u1", 0),
          { ...agent("a1", 1, "Still wri"), streaming: true } as ConductorRow,
        ],
        false,
      ),
    ).toBeNull();
  });

  it("is nothing when the turn asked a question: the question rings for itself", () => {
    expect(
      finishedReplyOf(
        [user("u1", 0), agent("a1", 1, "One thing:"), workAsk("q1", 2)],
        false,
      ),
    ).toBeNull();
  });

  it("is nothing with no rows at all", () => {
    expect(finishedReplyOf([], false)).toBeNull();
  });
});

describe("the finished reply, when rows say which message they answer (#2420)", () => {
  it("is the reply under the turn a message was steered into", () => {
    // A steered message is part of the turn it landed in and starts none, so
    // the reply after it is that turn's.
    expect(
      finishedReplyOf(
        [
          user("u1", 0),
          { ...agent("a1", 1, "Looking into it."), turn: "u1" },
          { ...user("u2", 2), turn: "u1" },
          { ...agent("a2", 3, "Both are done."), turn: "u1" },
        ],
        false,
      ),
    ).toEqual({ turn: "u1", text: "Both are done." });
  });

  it("is the second message's reply once both turns are over", () => {
    expect(finishedReplyOf(AT_THE_END, false)).toEqual({
      turn: "user:3",
      text: "hello back",
    });
  });
});
