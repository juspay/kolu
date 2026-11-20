import { describe, expect, it } from "vitest";
import { decodedAsServer, type FixtureRow } from "./rows.testlib.ts";
import { isTaskOut, Transcript } from "./transcript";

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

const rowsOf = (
  transcript: Transcript<FixtureRow>,
): ReadonlyArray<FixtureRow> => transcript.rows().map(decodedAsServer);

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
    expect(detailOf(settle("failed", undefined))).toBe(ANSWER);
  });

  it("is the newest report for a call that did not fail", () => {
    expect(detailOf(settle("completed", "done"))).toBe(ANSWER);
  });
});

describe("the wipe", () => {
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

    expect(wiped.removes).toEqual(["tool:c1", "user:1"]);
    expect(rowsOf(transcript)).toEqual([]);
  });

  it("forgets the calls, so the next conversation's are reported again", () => {
    const transcript = conversation();
    transcript.tool("c1", armed);
    transcript.clear([]);

    expect(transcript.tool("c1", armed).upserts.map((row) => row.id)).toEqual([
      "tool:c1",
    ]);
    expect(rowsOf(transcript).map((row) => row.id)).toEqual(["tool:c1"]);
  });

  it("mints PAST the conversation it deleted", () => {
    const transcript = conversation();
    transcript.tool("c1", armed);
    const before = rowsOf(transcript)[0]?.seq ?? 0;
    transcript.clear([]);
    transcript.tool("c1", armed);
    expect(rowsOf(transcript)[0]?.seq).toBeGreaterThan(before);
  });

  it("leaves nothing for a break to divide", () => {
    const transcript = conversation();
    transcript.tool("c1", armed);
    transcript.clear([]);
    expect(transcript.endsWithBreak()).toBe(true);
  });
});

describe("a refusal's mark, and how it comes off", () => {
  const signInOf = (row: FixtureRow | undefined): string | undefined =>
    row?.kind === "user" ? row.signIn : undefined;

  it("comes off when the message goes after all", () => {
    const transcript = conversation();
    const { key } = transcript.user("hello", {});
    transcript.refused(key, { signIn: "signed-out" });
    expect(signInOf(rowsOf(transcript)[0])).toBe("signed-out");

    transcript.sent(key);
    expect(signInOf(rowsOf(transcript)[0])).toBeUndefined();
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
    const transcript = conversation();
    const { key } = transcript.user("hello", {});
    transcript.refused(key, { signIn: "signed-out" });
    transcript.refused(key);
    expect(signInOf(rowsOf(transcript)[0])).toBeUndefined();
  });

  it("is not written onto a row that cannot carry one", () => {
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

describe("what changed for a chat like kolu's", () => {
  it("says a failed subagent ended, when nothing else would say it", () => {
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
    const transcript = conversation();
    transcript.tool("toolu_01", { status: "in_progress" });
    expect(rowsOf(transcript)[0]).toMatchObject({
      kind: "tool",
      text: "toolu_01",
    });
  });

  it("keeps a failed call's answer as its detail when no arguments were recorded", () => {
    const transcript = conversation();
    transcript.tool("call-1", { status: "in_progress", detail: ANSWER });
    transcript.tool("call-1", { status: "failed", progress: "it broke" });
    expect(detailOf(rowsOf(transcript))).toBe(ANSWER);
  });
});

describe("a call still out when the turn ends", () => {
  it("is marked, with the status the agent left on it", () => {
    const transcript = conversation();
    transcript.tool("call-1", { title: "Bash", status: "in_progress" });
    transcript.settle();

    expect(rowsOf(transcript)[0]).toMatchObject({
      kind: "tool",
      status: "in_progress",
      stranded: true,
    });
  });

  it("carries no mark once it has come back", () => {
    const transcript = conversation();
    transcript.tool("call-1", { title: "Bash", status: "in_progress" });
    transcript.tool("call-1", { status: "completed" });
    transcript.settle();

    const row = rowsOf(transcript)[0];
    expect(row?.kind === "tool" ? row.stranded : "not a tool row").toBe(
      undefined,
    );
  });
});

describe("whether a background task is still out", () => {
  const row = (over: {
    armed?: {
      task: string;
      description: null;
      ended: string | null;
      report: null;
    };
    status?: "pending" | "in_progress" | "completed" | "failed";
    stranded?: true;
  }) => ({
    armed: {
      task: "t1",
      description: null,
      ended: null,
      report: null,
    } as const,
    status: "in_progress" as const,
    ...over,
  });

  it("is out while nothing has said an ending", () => {
    expect(isTaskOut(row({}))).toBe(true);
  });

  it("is not out once the harness said how it ended", () => {
    expect(
      isTaskOut(
        row({
          armed: {
            task: "t1",
            description: null,
            ended: "completed",
            report: null,
          },
        }),
      ),
    ).toBe(false);
  });

  it("is not out once the CALL is over, whatever the task said", () => {
    expect(isTaskOut(row({ status: "completed" }))).toBe(false);
    expect(isTaskOut(row({ status: "failed" }))).toBe(false);
  });

  it("is not out on a row the turn walked away from", () => {
    expect(isTaskOut(row({ stranded: true }))).toBe(false);
  });

  it("is nothing at all for a call that armed no task", () => {
    expect(isTaskOut({ status: "in_progress" })).toBe(false);
  });
});
