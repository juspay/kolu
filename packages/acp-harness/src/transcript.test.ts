/**
 * A FAILED CALL SAYS WHY ONCE.
 *
 * The adapter reports a call twice: the arming frame carries its arguments, the
 * settling frame its answer — and for a failed call that answer is the error,
 * which the call's content already carries as the reason the card shows. So
 * the folded JSON under a failed call is what was ASKED, never the error again.
 */

import { describe, expect, it } from "vitest";
import { type FixtureRow, published } from "./rows.testlib.ts";
import { Transcript } from "./transcript";

/** A CONVERSATION LIKE KOLU'S CONDUCTOR'S, spelled in the fixture product's
 *  own rows ({@link ./rows.testlib.ts}): a turn the host started is a delivery
 *  like a person's, the break between two conversations is a row, and a wipe
 *  lets the counters run on because this product's `seq` is written to a
 *  store. */
const conversation = (from = 0): Transcript<FixtureRow> =>
  new Transcript<FixtureRow>({
    from,
    deliverable: (row) => row.kind === "user" || row.kind === "rung",
    countersSurviveClear: true,
    breakKind: "divider",
  });

const ASKED = JSON.stringify({ command: "false" }, null, 2);
const ANSWER = JSON.stringify("exit 1", null, 2);

const detailOf = (rows: ReadonlyArray<FixtureRow>): string | undefined => {
  const row = rows.find((one) => one.kind === "tool");
  return row?.kind === "tool" ? row.detail : undefined;
};

/** What the class minted, decoded the way a server decodes it — strictly, so
 *  a field the contract does not declare is red here (`./rows.testlib.ts`). */
const rowsOf = (
  transcript: Transcript<FixtureRow>,
): ReadonlyArray<FixtureRow> => transcript.rows().map(published);

/** One call, armed with its input, then settled with `status` and its answer. */
const settle = (
  status: "completed" | "failed",
  progress: string | undefined,
): ReadonlyArray<FixtureRow> => {
  const transcript = conversation();
  transcript.tool("c1", {
    title: "Bash",
    status: "in_progress",
    detail: ASKED,
    asked: ASKED,
  });
  transcript.tool("c1", {
    status,
    detail: ANSWER,
    progress,
  });
  return rowsOf(transcript);
};

describe("the folded JSON of a call", () => {
  it("is what was asked once the call FAILED with a reason", () => {
    expect(detailOf(settle("failed", "```\nexit 1\n```"))).toBe(ASKED);
  });

  it("keeps the answer for a failure that said nothing else", () => {
    // Its answer is then the only place the error is.
    expect(detailOf(settle("failed", undefined))).toBe(ANSWER);
  });

  it("is the newest report for a call that did not fail", () => {
    expect(detailOf(settle("completed", "done"))).toBe(ANSWER);
  });
});

describe("the wipe", () => {
  /** One call, reported exactly as it was reported before — which is what an
   *  agent does in its NEXT conversation: call ids are numbered inside a
   *  session and the next session starts at one again. */
  const armed = {
    title: "Bash",
    status: "completed",
    detail: ASKED,
    asked: ASKED,
  } as const;

  it("removes its own rows and the ones the caller is holding", () => {
    const transcript = conversation();
    transcript.tool("c1", armed);
    const wiped = transcript.clear(["user:1"]);

    // The caller's `user:1` is a row this instance never minted — read back
    // out of a store at boot, or minted by the harness this one replaced —
    // and one wipe has to empty both ends of one conversation.
    expect(wiped.removes).toEqual(["tool:c1", "user:1"]);
    expect(rowsOf(transcript)).toEqual([]);
  });

  it("forgets the calls, so the next conversation's are reported again", () => {
    // THE DEFECT THIS PINS. The rows were emptied at the CALLER and
    // everything kept beside them here — the picked name, the arguments, the
    // deaths announced, the calls a turn walked away from — stood. So the
    // next conversation's first call was "a repeat" of a row nobody was
    // holding any more: no upsert, and a panel a person had just emptied
    // stayed empty through a turn that really ran.
    const transcript = conversation();
    transcript.tool("c1", armed);
    transcript.clear([]);

    expect(transcript.tool("c1", armed).upserts.map((row) => row.id)).toEqual([
      "tool:c1",
    ]);
    expect(rowsOf(transcript).map((row) => row.id)).toEqual(["tool:c1"]);
  });

  it("mints PAST the conversation it deleted", () => {
    // The counters do not go back: a row minted after the wipe must not sort
    // above — or collide with — one a reader is still holding.
    const transcript = conversation();
    transcript.tool("c1", armed);
    const before = rowsOf(transcript)[0]?.seq ?? 0;
    transcript.clear([]);
    transcript.tool("c1", armed);
    expect(rowsOf(transcript)[0]?.seq).toBeGreaterThan(before);
  });

  it("leaves nothing for a break to divide", () => {
    // A `— NEW SESSION —` over an empty transcript is a rule drawn between
    // nothing and nothing, whether the emptiness is a fresh conversation's or
    // a wiped one's.
    const transcript = conversation();
    transcript.tool("c1", armed);
    transcript.clear([]);
    // The class answers the QUESTION the guard is made of; that no divider is
    // minted over an empty transcript is pinned by `harness.test.ts`'s
    // "a break minted for a fresh session that will not open comes back out" and
    // its neighbours, which drive the conversation-side helper that asks this.
    expect(transcript.endsWithBreak()).toBe(true);
  });
});

describe("a refusal's mark, and how it comes off", () => {
  /** The refusal mark a person's own words can carry: which sign-in would fix
   *  it. */
  const signInOf = (row: FixtureRow | undefined): string | undefined =>
    row?.kind === "user" ? row.signIn : undefined;

  it("comes off when the message goes after all", () => {
    // THE DOOR A REFUSED MESSAGE OFFERS MUST NOT OUTLIVE THE REFUSAL: a row
    // that says "sign in to send this" about a message the agent already has
    // is the panel asking for something nobody needs.
    const transcript = conversation();
    const { key } = transcript.user("hello", {});
    transcript.refused(key, { signIn: "signed-out" });
    expect(signInOf(rowsOf(transcript)[0])).toBe("signed-out");

    transcript.sent(key);
    expect(signInOf(rowsOf(transcript)[0])).toBeUndefined();
    // ... and the delivery mark itself goes with it.
    expect(rowsOf(transcript)[0]).not.toHaveProperty("delivery");
  });

  it("comes off when nothing came back either", () => {
    const transcript = conversation();
    const { key } = transcript.user("hello", {});
    transcript.refused(key, { signIn: "account" });
    transcript.unanswered(key);
    expect(signInOf(rowsOf(transcript)[0])).toBeUndefined();
  });

  it("comes off when a later refusal has no reason of its own", () => {
    // The SECOND refusal knows only that the agent said no. Whatever reason the
    // first one had has stopped being the truth.
    const transcript = conversation();
    const { key } = transcript.user("hello", {});
    transcript.refused(key, { signIn: "signed-out" });
    transcript.refused(key);
    expect(signInOf(rowsOf(transcript)[0])).toBeUndefined();
  });

  it("is not written onto a row that cannot carry one", () => {
    // A notice is not the delivery of a turn, so it has no `delivery` and no
    // sign-in door. Marking it would be a field no product's schema declares.
    const transcript = conversation();
    const { key } = transcript.write({
      kind: "notice",
      text: "the turn was cancelled",
    });
    expect(transcript.refused(key, { signIn: "signed-out" }).upserts).toEqual(
      [],
    );
    expect(rowsOf(transcript)[0]).not.toHaveProperty("delivery");
  });
});

/**
 * SIX THINGS A CHAT LIKE KOLU'S DOES DIFFERENTLY NOW, each pinned here.
 *
 * The class took olai's behaviour wherever the two originals differed without a
 * reason to keep both, and every difference below is a change a person can see.
 * They are asserted against a row union with kolu's own SHAPE (via
 * {@link published}), so the behaviour is the class's to keep — not a side
 * effect of olai's row type.
 */
describe("what changed for a chat like kolu's", () => {
  it("says a failed subagent ended, when nothing else would say it", () => {
    // A SYNCHRONOUS subagent arms no task, so its own status is the whole of
    // what happened — and its calls are filed under it, so the row that failed
    // is the only trace. One line at the bottom, and the row keeps its ending.
    const transcript = conversation();
    transcript.tool("call-1", {
      title: "survey the package",
      status: "in_progress",
      spawned: { kind: "Explore" },
    });
    transcript.say("meanwhile I keep reading");
    transcript.tool("call-1", { status: "failed" });

    const rows = rowsOf(transcript);
    expect(rows[rows.length - 1]).toMatchObject({
      kind: "notice",
      text: "the agent “survey the package” ended (failed)",
    });
  });

  it("says a death in the harness's own words, and lets a later sentence replace them", () => {
    // A background shell's exit code arrives on the frame AFTER the one that
    // ends the task, and it is the sentence a person needs. The first line is
    // refined rather than a second row minted.
    const transcript = conversation();
    transcript.tool("call-1", {
      title: "watch the build",
      status: "in_progress",
      armed: {
        task: "t1",
        description: "watch the build",
        ended: null,
        report: null,
      },
    });
    transcript.tool("call-1", {
      armed: {
        task: "t1",
        description: "watch the build",
        ended: "failed",
        report: null,
      },
    });
    expect(rowsOf(transcript).at(-1)).toMatchObject({
      kind: "notice",
      text: "the background task “watch the build” ended (failed)",
    });

    transcript.tool("call-1", {
      status: "failed",
      progress: 'Background command "bun test" failed with exit code 3',
    });
    const notices = rowsOf(transcript).filter((row) => row.kind === "notice");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      text: 'Background command "bun test" failed with exit code 3',
    });
  });

  it("names an undescribed subagent by its row's title", () => {
    // The adapter titles a subagent call with the TOOL's name, so four of them
    // read *the agent "Task" ended* — a line that says something went wrong and
    // refuses to say which. The row's own title is the name a reader knows.
    const transcript = conversation();
    transcript.tool("a", {
      title: "count the markdown files",
      status: "in_progress",
      spawned: { said: null, kind: "Task" },
    });
    transcript.tool("a", { status: "failed" });
    expect(rowsOf(transcript).at(-1)).toMatchObject({
      text: "the agent “count the markdown files” ended (failed)",
    });
  });

  it("does not end the paragraph for a frame that only reports a known task's life", () => {
    // The call was made an hour ago; this frame is the harness reporting its
    // end. Cutting the answer in half around a notice is one paragraph drawn as
    // two, with the notice wedged between.
    const transcript = conversation();
    transcript.tool("call-1", {
      title: "watch the build",
      status: "in_progress",
      armed: {
        task: "t1",
        description: "watch the build",
        ended: null,
        report: null,
      },
    });
    transcript.say("the first half, ");
    transcript.tool("call-1", {
      armed: {
        task: "t1",
        description: "watch the build",
        ended: "completed",
        report: null,
      },
    });
    transcript.say("and the second");

    const said = rowsOf(transcript).filter((row) => row.kind === "agent");
    expect(said).toHaveLength(1);
    expect(said[0]).toMatchObject({
      text: "the first half, and the second",
      streaming: true,
    });
  });

  it("shows a call's id when the agent never named it", () => {
    // A row with no title at all was a nameless card; the id at least says
    // WHICH call it is.
    const transcript = conversation();
    transcript.tool("toolu_01", { status: "in_progress" });
    expect(rowsOf(transcript)[0]).toMatchObject({
      kind: "tool",
      text: "toolu_01",
    });
  });

  it("keeps a failed call's answer as its detail when no arguments were recorded", () => {
    // The answer is then the only place the error is. With the arguments
    // recorded (the case at the top of this file) the detail is what was ASKED.
    const transcript = conversation();
    transcript.tool("call-1", { status: "in_progress", detail: ANSWER });
    transcript.tool("call-1", { status: "failed", progress: "it broke" });
    expect(detailOf(rowsOf(transcript))).toBe(ANSWER);
  });
});
