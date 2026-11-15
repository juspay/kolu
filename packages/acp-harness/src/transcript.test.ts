/**
 * A FAILED CALL SAYS WHY ONCE.
 *
 * The adapter reports a call twice: the arming frame carries its arguments, the
 * settling frame its answer — and for a failed call that answer is the error,
 * which the call's content already carries as the reason the card shows. So
 * the folded JSON under a failed call is what was ASKED, never the error again.
 */

import type { ConductorRow } from "kolu-common/conductor";
import { describe, expect, it } from "vitest";
import { Transcript } from "./transcript";

const ASKED = JSON.stringify({ command: "false" }, null, 2);
const ANSWER = JSON.stringify("exit 1", null, 2);

const detailOf = (rows: ReadonlyArray<ConductorRow>): string | undefined => {
  const row = rows.find((one) => one.kind === "tool");
  return row?.kind === "tool" ? row.detail : undefined;
};

/** One call, armed with its input, then settled with `status` and its answer. */
const settle = (
  status: "completed" | "failed",
  progress: string | undefined,
): ReadonlyArray<ConductorRow> => {
  const transcript = new Transcript();
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
  return transcript.rows();
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
    const transcript = new Transcript();
    transcript.tool("c1", armed);
    const wiped = transcript.clear(["user:1"]);

    // The caller's `user:1` is a row this instance never minted — read back
    // out of a store at boot, or minted by the harness this one replaced —
    // and one wipe has to empty both ends of one conversation.
    expect(wiped.removes).toEqual(["tool:c1", "user:1"]);
    expect(transcript.rows()).toEqual([]);
  });

  it("forgets the calls, so the next conversation's are reported again", () => {
    // THE DEFECT THIS PINS. The rows were emptied at the CALLER and
    // everything kept beside them here — the picked name, the arguments, the
    // deaths announced, the calls a turn walked away from — stood. So the
    // next conversation's first call was "a repeat" of a row nobody was
    // holding any more: no upsert, and a panel a person had just emptied
    // stayed empty through a turn that really ran.
    const transcript = new Transcript();
    transcript.tool("c1", armed);
    transcript.clear([]);

    expect(transcript.tool("c1", armed).upserts.map((row) => row.id)).toEqual([
      "tool:c1",
    ]);
    expect(transcript.rows().map((row) => row.id)).toEqual(["tool:c1"]);
  });

  it("mints PAST the conversation it deleted", () => {
    // The counters do not go back: a row minted after the wipe must not sort
    // above — or collide with — one a reader is still holding.
    const transcript = new Transcript();
    transcript.tool("c1", armed);
    const before = transcript.rows()[0]?.seq ?? 0;
    transcript.clear([]);
    transcript.tool("c1", armed);
    expect(transcript.rows()[0]?.seq).toBeGreaterThan(before);
  });

  it("leaves nothing for a break to divide", () => {
    // A `— NEW SESSION —` over an empty transcript is a rule drawn between
    // nothing and nothing, whether the emptiness is a fresh conversation's or
    // a wiped one's.
    const transcript = new Transcript();
    transcript.tool("c1", armed);
    transcript.clear([]);
    expect(transcript.divider("new session")).toMatchObject({ key: null });
  });
});
