import {
  agentRowFields,
  askRowFields,
  noticeRowFields,
  rowHead,
  toolRowFields,
  userRowFields,
} from "@kolu/acp/wire";
import { Schema } from "effect";
import { describe, expect, test } from "vitest";

import { type Change, says, Transcript } from "./transcript.ts";

const clock = (from: string) => {
  let at = Date.parse(from);
  return {
    now: () => at,
    pass: (ms: number) => {
      at += ms;
    },
  };
};

const OlaiRowSchema = Schema.Union([
  Schema.Struct({
    ...userRowFields,
    auth: Schema.optionalKey(Schema.Literal(true)),
    rang: Schema.optionalKey(Schema.String),
    context: Schema.optionalKey(Schema.Array(Schema.Unknown)),
    attachments: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  Schema.Struct({
    ...agentRowFields,
  }),
  Schema.Struct({
    ...toolRowFields,
    called: Schema.optionalKey(Schema.String),
    row: Schema.optionalKey(Schema.String),
    reply: Schema.optionalKey(Schema.Unknown),
    terminals: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  }),
  Schema.Struct({
    ...askRowFields,
  }),
  Schema.Struct({
    ...rowHead,
    kind: Schema.Literal("refusal"),
    text: Schema.String,
    refusal: Schema.Unknown,
  }),
  Schema.Struct({
    ...noticeRowFields,
  }),
]);
type OlaiRow = typeof OlaiRowSchema.Type;

const checked = (row: OlaiRow): OlaiRow =>
  Schema.decodeUnknownSync(OlaiRowSchema, { onExcessProperty: "error" })(row);

const conversation = (now?: () => number): Transcript<OlaiRow> =>
  new Transcript<OlaiRow>({
    ...(now === undefined ? {} : { now }),
    deliverable: (row) => row.kind === "user",
    firstSeq: "zero",
    retitle: (row, move) =>
      row.kind === "tool" &&
      row.row === undefined &&
      move.extra?.row !== undefined
        ? move.title
        : undefined,
  });

const rows = (transcript: Transcript<OlaiRow>): ReadonlyArray<OlaiRow> =>
  [...transcript.entries().values()].map(checked).sort((a, b) => a.seq - b.seq);

const asKind = <K extends OlaiRow["kind"]>(
  entry: OlaiRow | undefined,
  kind: K,
): Extract<OlaiRow, { kind: K }> | undefined =>
  entry?.kind === kind ? (entry as Extract<OlaiRow, { kind: K }>) : undefined;

const parentOf = (entry: OlaiRow | undefined): string | undefined =>
  entry?.kind === "tool" || entry?.kind === "ask" ? entry.parent : undefined;

const NOTHING: Change<OlaiRow> = { upserts: [], removes: [], appends: [] };

const touched = (change: Change<OlaiRow>): ReadonlyArray<string> =>
  change.upserts.map((row) => checked(row).id);

const added = (change: Change<OlaiRow>): ReadonlyArray<string> =>
  change.appends.map((piece) => `${piece.of}@${piece.at}:${piece.text}`);

describe("whether a change says anything", () => {
  test("an append-only change says something", () => {
    const transcript = conversation();
    transcript.say("one");
    const chunk = transcript.say(" more");
    expect(chunk.upserts).toEqual([]);
    expect(chunk.removes).toEqual([]);
    expect(says(chunk)).toBe(true);
  });

  test("a change that carries nothing says nothing", () => {
    expect(says(NOTHING)).toBe(false);
  });

  test("a row and a removal each say something", () => {
    const transcript = conversation();
    expect(says(transcript.add("notice", "cancelled"))).toBe(true);
    expect(says(transcript.clear())).toBe(true);
  });
});

describe("prose", () => {
  test("chunks accumulate into one row, not one row each", () => {
    const transcript = conversation();
    transcript.say("Hello");
    transcript.say(", ");
    transcript.say("world");

    expect(rows(transcript)).toHaveLength(1);
    expect(rows(transcript)[0]).toMatchObject({
      kind: "agent",
      text: "Hello, world",
      streaming: true,
    });
  });

  test("a chunk into an open row is published as the chunk, never as the row", () => {
    const transcript = conversation();
    const opened = transcript.say("Hello");
    expect(touched(opened)).toEqual(["agent:1"]);
    expect(added(opened)).toEqual([]);

    expect(added(transcript.say(", "))).toEqual(["agent:1@5:, "]);
    expect(added(transcript.say("world"))).toEqual(["agent:1@7:world"]);
    expect(touched(transcript.say("!"))).toEqual([]);
  });

  test("what the pieces say and what the row holds are the same text", () => {
    const transcript = conversation();
    const said = ["Once", " upon", " a", " time"];
    let text = "";
    for (const chunk of said) {
      const change = transcript.say(chunk);
      for (const piece of change.appends) {
        expect(piece.at).toBe(text.length);
        text += piece.text;
      }
      for (const row of change.upserts) text = row.text;
    }
    expect(text).toBe(said.join(""));
    expect(rows(transcript)[0]?.text).toBe(said.join(""));
  });

  test("the end of a paragraph publishes it whole, pieces and all", () => {
    const transcript = conversation();
    transcript.say("a long ");
    transcript.say("answer");
    const settled = transcript.settle();

    expect(settled.upserts.map((row) => [row.id, row.text])).toEqual([
      ["agent:1", "a long answer"],
    ]);
    expect(added(settled)).toEqual([]);
  });

  test("a replay of the conversation arrives whole", () => {
    const transcript = conversation();
    transcript.say("still ");
    transcript.say("going");
    expect(rows(transcript)[0]).toMatchObject({
      kind: "agent",
      text: "still going",
      streaming: true,
    });
  });

  test("the turn ending stops the cursor", () => {
    const transcript = conversation();
    transcript.say("done thinking");
    const settled = transcript.settle();

    expect(touched(settled)).toEqual(["agent:1"]);
    expect(asKind(rows(transcript)[0], "agent")?.streaming).toBeUndefined();
  });

  test("settling twice says nothing the second time", () => {
    const transcript = conversation();
    transcript.say("x");
    transcript.settle();
    expect(transcript.settle()).toEqual(NOTHING);
  });

  test("a row stops streaming the moment something else opens", () => {
    const transcript = conversation();
    transcript.say("let me look");
    const change = transcript.tool("call-1", { title: "search_nodes" });

    expect(touched(change)).toEqual(["agent:1", "tool:call-1"]);
    expect(asKind(rows(transcript)[0], "agent")?.streaming).toBeUndefined();

    transcript.say("found it");
    expect(rows(transcript).map((entry) => entry.text)).toEqual([
      "let me look",
      "search_nodes",
      "found it",
    ]);
  });

  test("a standalone row closes the open one too", () => {
    const transcript = conversation();
    transcript.say("thinking");
    transcript.add("notice", "cancelled");
    expect(asKind(rows(transcript)[0], "agent")?.streaming).toBeUndefined();
  });

  test("a replayed message's chunks accumulate the way the agent's do", () => {
    const transcript = conversation();
    transcript.userSaid("what did ");
    transcript.userSaid("we decide?");

    expect(rows(transcript)).toHaveLength(1);
    expect(rows(transcript)[0]).toMatchObject({
      kind: "user",
      text: "what did we decide?",
    });
  });

  test("a question and the answer to it are two paragraphs, not one", () => {
    const transcript = conversation();
    transcript.userSaid("what did we decide?");
    transcript.say("we decided to order the cabinets.");

    expect(rows(transcript).map((entry) => [entry.kind, entry.text])).toEqual([
      ["user", "what did we decide?"],
      ["agent", "we decided to order the cabinets."],
    ]);
  });
});

describe("tool calls", () => {
  test("a second report is the same row, not a second one", () => {
    const transcript = conversation();
    transcript.tool("call-1", {
      title: "outlines_done",
      status: "in_progress",
    });
    transcript.tool("call-1", { status: "completed", detail: "{}" });

    expect(rows(transcript)).toHaveLength(1);
    expect(rows(transcript)[0]).toMatchObject({
      kind: "tool",
      text: "outlines_done",
      status: "completed",
      detail: "{}",
    });
  });

  test("an absent field is unchanged, never cleared", () => {
    const transcript = conversation();
    transcript.tool("call-1", { title: "outlines_done", detail: "{}" });
    transcript.tool("call-1", { status: "completed" });
    expect(rows(transcript)[0]).toMatchObject({
      text: "outlines_done",
      detail: "{}",
    });
  });

  test("a call's name is picked once, and a later title does not move it", () => {
    const transcript = conversation();
    transcript.tool("call-1", { title: "bash", status: "in_progress" });
    transcript.tool("call-1", {
      title: "waiting for the command",
      status: "in_progress",
    });
    transcript.tool("call-1", { title: "bash failed", status: "failed" });

    expect(rows(transcript)[0]).toMatchObject({
      text: "bash",
      status: "failed",
    });
  });

  test("a call nothing has named yet is named by the frame that names it", () => {
    const transcript = conversation();
    transcript.tool("call-1", { status: "in_progress" });
    expect(rows(transcript)[0]?.text).toBe("call-1");

    transcript.tool("call-1", { title: "read the notes", status: "completed" });
    expect(rows(transcript)[0]).toMatchObject({
      text: "read the notes",
      status: "completed",
    });
  });

  test("a provisional title is shown, and the frame that refines it names the row", () => {
    const transcript = conversation();
    transcript.tool("call-1", {
      title: "Terminal",
      status: "pending",
      provisional: true,
    });
    expect(rows(transcript)[0]?.text).toBe("Terminal");

    transcript.tool("call-1", { title: "echo hello", status: "in_progress" });
    expect(rows(transcript)[0]).toMatchObject({
      text: "echo hello",
      status: "in_progress",
    });

    transcript.tool("call-1", { title: "Bash", status: "completed" });
    expect(rows(transcript)[0]).toMatchObject({
      text: "echo hello",
      status: "completed",
    });
  });

  test("a frame repeating one already in says nothing", () => {
    const transcript = conversation();
    const move = {
      title: "read the notes",
      status: "completed" as const,
      detail: "{}",
      diffs: [{ path: "notes.md", oldText: "one", newText: "two" }],
      locations: ["notes.md:3"],
      spawned: { kind: "Explore" },
    };
    transcript.tool("call-1", move);
    expect(transcript.tool("call-1", structuredClone(move))).toEqual(NOTHING);
    expect(rows(transcript)).toHaveLength(1);
  });

  test("a repeat does not take back the mark its turn left", () => {
    const transcript = conversation();
    transcript.tool("call-1", {
      title: "a call nobody reported on",
      status: "in_progress",
    });
    transcript.settle();
    expect(asKind(rows(transcript)[0], "tool")?.stranded).toBe(true);

    transcript.tool("call-1", {
      title: "a call nobody reported on",
      status: "in_progress",
    });
    expect(asKind(rows(transcript)[0], "tool")?.stranded).toBe(true);
  });

  test("a row keeps its place in the conversation when it is updated", () => {
    const transcript = conversation();
    transcript.tool("call-1", { title: "first" });
    transcript.add("notice", "in between");
    transcript.tool("call-1", { status: "completed" });

    expect(rows(transcript).map((entry) => entry.text)).toEqual([
      "first",
      "in between",
    ]);
  });

  test("a subagent's call names the row of the Agent frame, not its id", () => {
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", { title: "find the call sites" });
    transcript.tool("call-1", { title: "Grep", parent: "tool:toolu_01AGENT" });

    expect(rows(transcript)[1]).toMatchObject({ parent: "tool:toolu_01AGENT" });
    expect(transcript.entries().get("tool:toolu_01AGENT")).toBeDefined();
  });

  test("the main agent's own calls are in nobody's lane", () => {
    const transcript = conversation();
    transcript.tool("call-1", { title: "Grep" });
    expect(parentOf(rows(transcript)[0])).toBeUndefined();
  });

  test("a completion that forgets the agent does not take the row out of its lane", () => {
    const transcript = conversation();
    transcript.tool("call-1", {
      title: "Grep",
      status: "in_progress",
      parent: "tool:toolu_01AGENT",
    });
    transcript.tool("call-1", { status: "completed" });

    expect(rows(transcript)[0]).toMatchObject({
      status: "completed",
      parent: "tool:toolu_01AGENT",
    });
  });

  test("a call that spawned an agent goes on having spawned one", () => {
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", {
      title: "explore the outline",
      status: "pending",
      spawned: { kind: "Explore" },
    });
    transcript.tool("toolu_01AGENT", { status: "in_progress", spawned: {} });
    transcript.tool("toolu_01AGENT", { status: "completed" });

    expect(rows(transcript)[0]).toMatchObject({
      status: "completed",
      spawned: { kind: "Explore" },
    });
  });

  test("a spawn is one before it says which kind of agent it sent", () => {
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", {
      title: "explore the outline",
      spawned: {},
    });
    expect(asKind(rows(transcript)[0], "tool")?.spawned).toEqual({
      kind: null,
      said: null,
    });

    transcript.tool("toolu_01AGENT", { spawned: { kind: "Explore" } });
    expect(rows(transcript)[0]).toMatchObject({
      text: "explore the outline",
      spawned: { kind: "Explore" },
    });
  });

  test("an ordinary call never becomes a spawn", () => {
    const transcript = conversation();
    transcript.tool("call-1", { title: "Grep", status: "completed" });
    expect(asKind(rows(transcript)[0], "tool")?.spawned).toBeUndefined();
  });

  test("a task's report lands on the arming and stays there", () => {
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", {
      title: "Task",
      status: "in_progress",
      spawned: { said: "count the ticks" },
      armed: { task: "a4015bf2ba1fa514d", description: "count the ticks" },
    });
    transcript.tool("toolu_01AGENT", {
      armed: {
        task: "a4015bf2ba1fa514d",
        report: "I have thorough coverage now.\n\n# Findings\n",
      },
    });
    transcript.tool("toolu_01AGENT", { status: "completed" });

    expect(asKind(rows(transcript)[0], "tool")?.armed).toEqual({
      task: "a4015bf2ba1fa514d",
      description: "count the ticks",
      ended: null,
      report: "I have thorough coverage now.\n\n# Findings\n",
    });
  });

  test("a report for a call that was never announced writes no row", () => {
    const transcript = conversation();
    const change = transcript.tool("toolu_01GHOST", {
      armed: { task: "ghost", report: "nobody sent this agent out" },
    });
    expect(change.upserts).toEqual([]);
    expect(rows(transcript)).toEqual([]);
  });

  test("a call that ARMED A TASK keeps what it was armed with when it dies", () => {
    const transcript = conversation();
    transcript.tool("toolu_01WATCH", {
      title: "Monitor",
      status: "in_progress",
      armed: { task: "bu13xz2ie", description: "kolu fleet watch" },
    });
    transcript.tool("toolu_01WATCH", {
      status: "failed",
      armed: { task: "bu13xz2ie", ended: "killed" },
    });

    expect(rows(transcript)[0]).toMatchObject({
      status: "failed",
      armed: {
        task: "bu13xz2ie",
        description: "kolu fleet watch",
        ended: "killed",
      },
    });
  });

  test("A DEATH LANDS AT THE BOTTOM, as a row of its own", () => {
    const transcript = conversation();
    transcript.tool("toolu_01WATCH", {
      title: "Monitor",
      status: "in_progress",
      armed: { task: "bu13xz2ie", description: "kolu fleet watch" },
    });
    transcript.settle();
    transcript.user("what else is on the list?");
    transcript.say("this and that");
    transcript.settle();
    transcript.tool("toolu_01WATCH", {
      status: "failed",
      armed: { task: "bu13xz2ie", ended: "failed" },
      progress: 'Background command "kolu fleet watch" failed with exit code 3',
    });

    const said = rows(transcript);
    expect(said[said.length - 1]).toMatchObject({
      kind: "notice",
      text: 'Background command "kolu fleet watch" failed with exit code 3',
    });
    expect(said[0]).toMatchObject({ kind: "tool", status: "failed" });
    expect(asKind(said[0], "tool")?.armed?.ended).toBe("failed");
  });

  test("the harness's sentence arrives a beat late and REFINES that row", () => {
    const transcript = conversation();
    transcript.tool("toolu_01WATCH", {
      title: "Monitor",
      status: "in_progress",
      armed: { task: "bu13xz2ie", description: "kolu fleet watch" },
    });
    transcript.tool("toolu_01WATCH", {
      status: "failed",
      armed: { task: "bu13xz2ie", ended: "killed" },
    });
    expect(rows(transcript)[1]).toMatchObject({
      kind: "notice",
      text: "the background task “kolu fleet watch” ended (killed)",
    });

    transcript.tool("toolu_01WATCH", {
      status: "failed",
      armed: { task: "bu13xz2ie", ended: "killed" },
      progress: 'Monitor "kolu fleet watch" was stopped',
    });
    const said = rows(transcript);
    expect(said.length).toBe(2);
    expect(said[1]).toMatchObject({
      kind: "notice",
      text: 'Monitor "kolu fleet watch" was stopped',
    });
  });

  test("... and every later frame about a dead task says nothing at all", () => {
    const transcript = conversation();
    transcript.tool("toolu_01WATCH", {
      title: "Monitor",
      status: "in_progress",
      armed: { task: "bu13xz2ie", description: "kolu fleet watch" },
    });
    const ending = {
      status: "failed" as const,
      armed: { task: "bu13xz2ie", ended: "failed" },
      progress: "it fell over",
    };
    transcript.tool("toolu_01WATCH", ending);
    const after = transcript.tool("toolu_01WATCH", ending);

    expect(rows(transcript).length).toBe(2);
    expect(after.upserts.length).toBe(0);
  });

  test("A DEATH MID-ANSWER DOES NOT CUT THE ANSWER IN HALF", () => {
    const transcript = conversation();
    transcript.tool("toolu_01WATCH", {
      title: "Monitor",
      status: "in_progress",
      armed: { task: "bu13xz2ie", description: "kolu fleet watch" },
    });
    transcript.settle();
    transcript.user("what about the fleet?");
    transcript.begins();
    transcript.say("Once upon a time the fleet was waiting and ");
    transcript.tool("toolu_01WATCH", {
      status: "completed",
      armed: { task: "bu13xz2ie", ended: "completed" },
    });
    transcript.say("then the rest of the answer continues here.");
    transcript.settle();

    const said = rows(transcript);
    const prose = said.filter((entry) => entry.kind === "agent");
    expect(prose.length).toBe(1);
    expect(prose[0]?.text).toBe(
      "Once upon a time the fleet was waiting and then the rest of the answer continues here.",
    );
    expect(said[said.length - 1]).toMatchObject({
      kind: "notice",
      text: "the background task “kolu fleet watch” ended (completed)",
    });
  });

  test("... and an ordinary call in the same turn still ends the paragraph", () => {
    const transcript = conversation();
    transcript.begins();
    transcript.say("first I will look");
    transcript.tool("call-1", { title: "Grep", status: "in_progress" });
    transcript.say("and here is what I found");
    transcript.settle();

    const prose = rows(transcript).filter((entry) => entry.kind === "agent");
    expect(prose.map((entry) => entry.text)).toEqual([
      "first I will look",
      "and here is what I found",
    ]);
  });

  test("... nor does the frame that ARMS a task get the exemption", () => {
    const transcript = conversation();
    transcript.begins();
    transcript.say("arming the watch");
    transcript.tool("toolu_01WATCH", {
      title: "Monitor",
      status: "in_progress",
      armed: { task: "bu13xz2ie", description: "kolu fleet watch" },
    });
    transcript.say("armed; carrying on");
    transcript.settle();

    const prose = rows(transcript).filter((entry) => entry.kind === "agent");
    expect(prose.map((entry) => entry.text)).toEqual([
      "arming the watch",
      "armed; carrying on",
    ]);
  });
  test("an ordinary call never arms a task", () => {
    const transcript = conversation();
    transcript.tool("call-1", { title: "Grep", status: "completed" });
    expect(asKind(rows(transcript)[0], "tool")?.armed).toBeUndefined();
  });
});

describe("an agent that was sent out", () => {
  const sent = {
    title: "survey the web package",
    status: "in_progress" as const,
    spawned: { kind: "Explore" },
  };

  const notices = (transcript: Transcript<OlaiRow>): ReadonlyArray<string> =>
    rows(transcript)
      .filter((entry) => entry.kind === "notice")
      .map((entry) => entry.text);

  test("a spawn whose call fails says an AGENT ended, not a background task", () => {
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", sent);
    transcript.say("meanwhile I will keep reading the other package");
    transcript.tool("toolu_01AGENT", { status: "failed" });

    const said = rows(transcript);
    expect(said[said.length - 1]).toMatchObject({
      kind: "notice",
      text: "the agent “survey the web package” ended (failed)",
    });
    expect(said[0]).toMatchObject({ kind: "tool", status: "failed" });
  });

  test("a spawn that comes back lands no line at all", () => {
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", sent);
    transcript.tool("toolu_01AGENT", { status: "completed" });

    expect(notices(transcript)).toEqual([]);
    expect(rows(transcript)).toHaveLength(1);
  });

  test("A REOPENED CALL'S TASK HAS NOT ENDED, whatever the last outing said", () => {
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", { ...sent, armed: { task: "bu13xz2ie" } });
    transcript.tool("toolu_01AGENT", {
      status: "completed",
      armed: {
        task: "bu13xz2ie",
        ended: "completed",
        report: "outing one found three notes.",
      },
    });
    transcript.tool("toolu_01AGENT", { status: "in_progress" });

    const out = asKind(rows(transcript)[0], "tool");
    expect(out?.armed).toEqual({
      task: "bu13xz2ie",
      description: null,
      ended: null,
      report: null,
    });
    expect(out?.status).toBe("in_progress");

    transcript.tool("toolu_01AGENT", {
      status: "completed",
      armed: {
        task: "bu13xz2ie",
        ended: "completed",
        report: "outing two pushed the branch.",
      },
    });
    expect(asKind(rows(transcript)[0], "tool")?.armed).toEqual({
      task: "bu13xz2ie",
      description: null,
      ended: "completed",
      report: "outing two pushed the branch.",
    });
  });

  test("... so a turn ending under a RESUMED async agent leaves it alone", () => {
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", { ...sent, armed: { task: "bu13xz2ie" } });
    transcript.tool("toolu_01AGENT", {
      status: "completed",
      armed: { task: "bu13xz2ie", ended: "completed" },
    });
    transcript.tool("toolu_01AGENT", { status: "in_progress" });
    transcript.settle();

    expect(asKind(rows(transcript)[0], "tool")?.stranded).toBeUndefined();
  });

  test("A SECOND OUTING'S ENDING IS ITS OWN NEWS, not the first one's again", () => {
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", { ...sent, armed: { task: "bu13xz2ie" } });
    transcript.tool("toolu_01AGENT", {
      status: "completed",
      armed: { task: "bu13xz2ie", ended: "completed" },
    });
    expect(notices(transcript)).toEqual([
      "the agent “survey the web package” ended (completed)",
    ]);

    transcript.tool("toolu_01AGENT", { status: "in_progress" });
    transcript.tool("toolu_01AGENT", { status: "failed" });
    expect(notices(transcript)).toEqual([
      "the agent “survey the web package” ended (completed)",
      "the agent “survey the web package” ended (failed)",
    ]);
  });

  test("A SECOND OUTING THAT WENT FINE SAYS SO TOO, like the first one did", () => {
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", { ...sent, armed: { task: "bu13xz2ie" } });
    transcript.tool("toolu_01AGENT", {
      status: "completed",
      armed: { task: "bu13xz2ie", ended: "completed" },
    });
    transcript.tool("toolu_01AGENT", { status: "in_progress" });
    transcript.tool("toolu_01AGENT", {
      status: "completed",
      armed: { task: "bu13xz2ie", ended: "completed" },
    });

    expect(notices(transcript)).toEqual([
      "the agent “survey the web package” ended (completed)",
      "the agent “survey the web package” ended (completed)",
    ]);
  });

  test("... and a SECOND OUTING'S FAILURE takes the harness's sentence too", () => {
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", { ...sent, armed: { task: "bu13xz2ie" } });
    transcript.tool("toolu_01AGENT", {
      status: "completed",
      armed: { task: "bu13xz2ie", ended: "completed" },
    });
    transcript.tool("toolu_01AGENT", { status: "in_progress" });
    transcript.tool("toolu_01AGENT", {
      status: "failed",
      armed: { task: "bu13xz2ie", ended: "failed" },
    });
    transcript.tool("toolu_01AGENT", {
      status: "failed",
      armed: { task: "bu13xz2ie", ended: "failed" },
      progress: "the agent ran out of context",
    });

    expect(notices(transcript)).toEqual([
      "the agent “survey the web package” ended (completed)",
      "the agent ran out of context",
    ]);
  });

  test("... and so does a SYNCHRONOUS spawn's, whose reason lands a beat late", () => {
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", sent);
    transcript.tool("toolu_01AGENT", { status: "failed" });
    transcript.tool("toolu_01AGENT", {
      status: "failed",
      progress: "the agent was killed",
    });

    expect(notices(transcript)).toEqual(["the agent was killed"]);
  });

  test("an async spawn's every ending is said, good ones included", () => {
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", { ...sent, armed: { task: "bu13xz2ie" } });
    transcript.settle();
    transcript.user("what else is on the list?");
    transcript.say("this and that");
    transcript.settle();
    transcript.tool("toolu_01AGENT", {
      status: "completed",
      armed: { task: "bu13xz2ie", ended: "completed" },
    });

    expect(notices(transcript)).toEqual([
      "the agent “survey the web package” ended (completed)",
    ]);
  });

  test("ONE DEATH IS ONE ROW, however many ways it is reported", () => {
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", { ...sent, armed: { task: "bu13xz2ie" } });
    transcript.tool("toolu_01AGENT", { status: "failed" });
    transcript.tool("toolu_01AGENT", {
      status: "failed",
      armed: { task: "bu13xz2ie", ended: "failed" },
    });

    expect(notices(transcript)).toEqual([
      "the agent “survey the web package” ended (failed)",
    ]);
    expect(rows(transcript)).toHaveLength(2);
  });

  test("the harness's sentence about a dead agent refines that one row", () => {
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", { ...sent, armed: { task: "bu13xz2ie" } });
    transcript.tool("toolu_01AGENT", {
      status: "failed",
      armed: { task: "bu13xz2ie", ended: "failed" },
    });
    expect(notices(transcript)).toEqual([
      "the agent “survey the web package” ended (failed)",
    ]);

    transcript.tool("toolu_01AGENT", {
      status: "failed",
      armed: { task: "bu13xz2ie", ended: "failed" },
      progress: 'Agent "survey the web package" exited before reporting',
    });
    expect(notices(transcript)).toEqual([
      'Agent "survey the web package" exited before reporting',
    ]);
  });

  test("an ordinary background task is still a background task", () => {
    const transcript = conversation();
    transcript.tool("toolu_01WATCH", {
      title: "Monitor",
      status: "in_progress",
      armed: { task: "bu13xz2ie", description: "kolu fleet watch" },
    });
    transcript.tool("toolu_01WATCH", {
      status: "failed",
      armed: { task: "bu13xz2ie", ended: "killed" },
    });

    expect(notices(transcript)).toEqual([
      "the background task “kolu fleet watch” ended (killed)",
    ]);
  });

  test("a spawn its turn walked away from says it never reported back", () => {
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", sent);
    transcript.settle();

    expect(notices(transcript)).toEqual([
      "the agent “survey the web package” ended (never reported back)",
    ]);
    expect(asKind(rows(transcript)[0], "tool")?.stranded).toBe(true);

    transcript.begins();
    transcript.settle();
    expect(notices(transcript)).toHaveLength(1);
  });

  test("... but an agent out when the CONVERSATION died says nothing of its own", () => {
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", sent);
    transcript.tool("toolu_02AGENT", {
      ...sent,
      title: "survey the server package",
    });
    transcript.abandon();

    expect(notices(transcript)).toEqual([]);
    expect(
      rows(transcript).map((entry) => asKind(entry, "tool")?.stranded),
    ).toEqual([true, true]);
  });
});

describe("what a turn leaves behind", () => {
  test("a call still running when the turn ends is marked, status untouched", () => {
    const transcript = conversation();
    transcript.tool("call-1", { title: "Grep", status: "in_progress" });
    transcript.settle();

    expect(rows(transcript)[0]).toMatchObject({
      status: "in_progress",
      stranded: true,
    });
  });

  test("a call that came back is left alone", () => {
    const transcript = conversation();
    transcript.tool("call-1", { title: "Grep", status: "completed" });
    transcript.tool("call-2", { title: "Read", status: "failed" });
    transcript.settle();

    expect(
      rows(transcript).map((entry) => asKind(entry, "tool")?.stranded),
    ).toEqual([undefined, undefined]);
  });

  test("nor is anything that is not a call", () => {
    const transcript = conversation();
    transcript.user("done order");
    transcript.say("looking");
    transcript.settle();

    expect(
      rows(transcript).map((entry) => asKind(entry, "tool")?.stranded),
    ).toEqual([undefined, undefined]);
  });

  test("A LATER TURN DOES NOT UNDO IT — which is the whole point", () => {
    const transcript = conversation();
    transcript.tool("call-1", { title: "Grep", status: "in_progress" });
    transcript.settle();
    transcript.user("try again");
    transcript.begins();
    transcript.tool("call-2", { title: "Read", status: "in_progress" });

    expect(rows(transcript)[0]).toMatchObject({ text: "Grep", stranded: true });
    expect(asKind(rows(transcript)[2], "tool")?.stranded).toBeUndefined();
  });

  test("a turn STARTING says it too, so no path has to have remembered", () => {
    const transcript = conversation();
    transcript.tool("call-1", { title: "Grep", status: "pending" });
    transcript.begins();

    expect(asKind(rows(transcript)[0], "tool")?.stranded).toBe(true);
  });

  test("A CALL THAT ARMED A BACKGROUND TASK IS NOT LEFT BEHIND", () => {
    const transcript = conversation();
    transcript.tool("toolu_01WATCH", {
      title: "Monitor",
      status: "in_progress",
      armed: { task: "bu13xz2ie", description: "kolu fleet watch" },
    });
    transcript.settle();
    transcript.user("what else is on the list?");
    transcript.begins();
    transcript.settle();

    expect(asKind(rows(transcript)[0], "tool")?.stranded).toBeUndefined();
  });

  test("... until the harness says how it ended, when it is an ordinary row again", () => {
    const transcript = conversation();
    transcript.tool("toolu_01WATCH", {
      title: "Monitor",
      status: "in_progress",
      armed: { task: "bu13xz2ie" },
    });
    transcript.tool("toolu_01WATCH", {
      status: "in_progress",
      armed: { task: "bu13xz2ie", ended: "stopped" },
    });
    transcript.settle();

    expect(asKind(rows(transcript)[0], "tool")?.stranded).toBe(true);
  });

  test("a call that reports again is running again", () => {
    const transcript = conversation();
    transcript.tool("call-1", { title: "Grep", status: "in_progress" });
    transcript.settle();
    expect(asKind(rows(transcript)[0], "tool")?.stranded).toBe(true);

    transcript.tool("call-1", { status: "in_progress", progress: "halfway" });
    expect(asKind(rows(transcript)[0], "tool")?.stranded).toBeUndefined();
  });

  test("marking is said once, not once per turn", () => {
    const transcript = conversation();
    transcript.tool("call-1", { title: "Grep", status: "in_progress" });
    expect(touched(transcript.settle())).toEqual(["tool:call-1"]);
    expect(touched(transcript.begins())).toEqual([]);
    expect(touched(transcript.settle())).toEqual([]);
  });

  test("a turn that ends beside another closes ITS paragraph and nothing else", () => {
    const transcript = conversation();
    transcript.say("the tide is, in the end, the most tangible evidence.");
    transcript.tool("call-1", { title: "Grep", status: "in_progress" });
    transcript.say("…and here is more of the same answer.");

    transcript.stopSaying();
    transcript.say("BANANA");

    expect(rows(transcript).map((entry) => entry.text)).toEqual([
      "the tide is, in the end, the most tangible evidence.",
      "Grep",
      "…and here is more of the same answer.",
      "BANANA",
    ]);
    expect(asKind(rows(transcript)[1], "tool")?.stranded).toBeUndefined();
  });

  test("... and closing twice is not news", () => {
    const transcript = conversation();
    transcript.say("done");
    expect(touched(transcript.stopSaying())).toEqual(["agent:1"]);
    expect(transcript.stopSaying()).toEqual(NOTHING);
  });
});

describe("when a row arrived", () => {
  test("a row is stamped with the instant it first appeared", () => {
    const time = clock("2026-08-21T12:00:00.000Z");
    const transcript = conversation(time.now);
    transcript.tool("call-1", { title: "Grep", status: "pending" });
    expect(rows(transcript)[0]?.since).toBe("2026-08-21T12:00:00.000Z");
  });

  test("... and keeps it, however many times the call reports again", () => {
    const time = clock("2026-08-21T12:00:00.000Z");
    const transcript = conversation(time.now);
    transcript.tool("call-1", { title: "Grep", status: "pending" });
    time.pass(30_000);
    transcript.tool("call-1", { status: "in_progress", progress: "halfway" });
    time.pass(30_000);
    transcript.tool("call-1", { status: "completed" });

    expect(rows(transcript)[0]?.since).toBe("2026-08-21T12:00:00.000Z");
  });

  test("a row cannot be handed one: the writer decides, like `seq`", () => {
    const time = clock("2026-08-21T12:00:00.000Z");
    const transcript = conversation(time.now);
    transcript.user("hello", { since: "1999-01-01T00:00:00.000Z" } as never);
    expect(rows(transcript)[0]?.since).toBe("2026-08-21T12:00:00.000Z");
  });

  test("A CALL THAT WAS OVER AND IS RUNNING AGAIN is stamped with the moment", () => {
    const time = clock("2026-08-21T12:00:00.000Z");
    const transcript = conversation(time.now);
    transcript.tool("toolu_01AGENT", {
      title: "Task",
      status: "in_progress",
      spawned: { said: "author the PR" },
    });
    time.pass(20 * 60_000);
    transcript.tool("toolu_01AGENT", { status: "completed" });
    time.pass(3 * 60 * 60_000);
    transcript.tool("toolu_01AGENT", { status: "in_progress" });

    const said = rows(transcript);
    expect(said).toHaveLength(1);
    expect(asKind(said[0], "tool")).toMatchObject({
      status: "in_progress",
      since: "2026-08-21T12:00:00.000Z",
      resumed: "2026-08-21T15:20:00.000Z",
    });
  });

  test("... and a call on its FIRST outing carries no such stamp", () => {
    const time = clock("2026-08-21T12:00:00.000Z");
    const transcript = conversation(time.now);
    transcript.tool("call-1", { title: "Grep", status: "pending" });
    time.pass(1_000);
    transcript.tool("call-1", { status: "in_progress", progress: "halfway" });

    expect(asKind(rows(transcript)[0], "tool")?.resumed).toBeUndefined();
  });

  test("... nor does a call its turn walked away from, reporting late", () => {
    const time = clock("2026-08-21T12:00:00.000Z");
    const transcript = conversation(time.now);
    transcript.tool("call-1", { title: "Grep", status: "in_progress" });
    transcript.settle();
    time.pass(60_000);
    transcript.tool("call-1", {
      status: "in_progress",
      progress: "still here",
    });

    const late = asKind(rows(transcript)[0], "tool");
    expect(late?.stranded).toBeUndefined();
    expect(late?.resumed).toBeUndefined();
  });

  test("a REPEAT of the reopening frame does not restamp the outing", () => {
    const time = clock("2026-08-21T12:00:00.000Z");
    const transcript = conversation(time.now);
    transcript.tool("toolu_01AGENT", {
      title: "Task",
      status: "in_progress",
      spawned: {},
    });
    transcript.tool("toolu_01AGENT", { status: "completed" });
    time.pass(60_000);
    transcript.tool("toolu_01AGENT", { status: "in_progress" });
    time.pass(60_000);
    const again = transcript.tool("toolu_01AGENT", { status: "in_progress" });

    expect(says(again)).toBe(false);
    expect(asKind(rows(transcript)[0], "tool")?.resumed).toBe(
      "2026-08-21T12:01:00.000Z",
    );
  });

  test("a stamp cannot be handed in either: it is the writer's, like `since`", () => {
    const time = clock("2026-08-21T12:00:00.000Z");
    const transcript = conversation(time.now);
    transcript.tool("call-1", {
      title: "Grep",
      status: "pending",
      resumed: "1999-01-01T00:00:00.000Z",
    } as never);

    expect(asKind(rows(transcript)[0], "tool")?.resumed).toBeUndefined();
  });

  test("the row a person typed is stamped too — one rule, not a tool's", () => {
    const time = clock("2026-08-21T12:00:00.000Z");
    const transcript = conversation(time.now);
    transcript.say("thinking");
    time.pass(1_000);
    transcript.add("notice", "the agent stopped");

    expect(rows(transcript).map((entry) => entry.since)).toEqual([
      "2026-08-21T12:00:00.000Z",
      "2026-08-21T12:00:01.000Z",
    ]);
  });
});

describe("questions", () => {
  const fields = [
    {
      key: "question_0",
      label: null,
      hint: null,
      kind: "choice" as const,
      choices: [{ value: "yes", label: "yes", hint: null }],
      required: false,
      attachedTo: null,
    },
  ];

  test("answering a question moves the row it was asked on", () => {
    const transcript = conversation();
    transcript.ask("ask:1", "Shall I?", fields, null, null);
    const settled = transcript.settleAsk("ask:1", {
      how: "answered",
      answers: [{ key: "question_0", values: ["yes"] }],
    });

    expect(touched(settled)).toEqual(["ask:1"]);
    expect(rows(transcript)).toHaveLength(1);
    expect(rows(transcript)[0]).toMatchObject({
      kind: "ask",
      text: "Shall I?",
    });
    expect(asKind(rows(transcript)[0], "ask")?.ask).toEqual({
      fields,
      link: null,
      outcome: {
        how: "answered",
        answers: [{ key: "question_0", values: ["yes"] }],
      },
    });
  });

  test("a question closes the paragraph the agent was writing", () => {
    const transcript = conversation();
    transcript.say("I need to know something");
    const change = transcript.ask("ask:1", "Shall I?", fields, null, null);

    expect(touched(change)).toEqual(["agent:1", "ask:1"]);
    expect(asKind(rows(transcript)[0], "agent")?.streaming).toBeUndefined();
  });

  test("a subagent's question lands in that subagent's lane", () => {
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", { title: "explore the outline" });
    transcript.ask(
      "ask:1",
      "Allow `Bash`?",
      fields,
      null,
      "tool:toolu_01AGENT",
    );

    expect(rows(transcript)[1]).toMatchObject({
      kind: "ask",
      parent: "tool:toolu_01AGENT",
    });
    expect(transcript.entries().get("tool:toolu_01AGENT")).toBeDefined();
  });

  test("the main agent's own questions are in nobody's lane", () => {
    const transcript = conversation();
    transcript.ask("ask:1", "Shall I?", fields, null, null);
    expect(parentOf(rows(transcript)[0])).toBeUndefined();
  });

  test("answering a subagent's question leaves it in that subagent's lane", () => {
    const transcript = conversation();
    transcript.ask(
      "ask:1",
      "Allow `Bash`?",
      fields,
      null,
      "tool:toolu_01AGENT",
    );
    transcript.settleAsk("ask:1", {
      how: "answered",
      answers: [{ key: "question_0", values: ["yes"] }],
    });

    expect(rows(transcript)[0]).toMatchObject({ parent: "tool:toolu_01AGENT" });
  });

  test("a subagent's question does not break the run of its own work", () => {
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", { title: "explore the outline" });
    transcript.tool("call-1", { title: "Grep", parent: "tool:toolu_01AGENT" });
    transcript.ask(
      "ask:1",
      "Allow `Bash`?",
      fields,
      null,
      "tool:toolu_01AGENT",
    );
    transcript.tool("call-2", { title: "Bash", parent: "tool:toolu_01AGENT" });

    expect(rows(transcript).slice(1).map(parentOf)).toEqual([
      "tool:toolu_01AGENT",
      "tool:toolu_01AGENT",
      "tool:toolu_01AGENT",
    ]);
  });

  test("settling one that is no longer there says nothing", () => {
    const transcript = conversation();
    transcript.ask("ask:1", "Shall I?", fields, null, null);
    transcript.clear();

    expect(
      transcript.settleAsk("ask:1", { how: "withdrawn", answers: [] }),
    ).toEqual(NOTHING);
    expect(rows(transcript)).toEqual([]);
  });
});

describe("a message the agent has not started on", () => {
  test("says so on the row it was typed into, and keeps its words", () => {
    const transcript = conversation();
    const row = transcript.user("and check the other one");

    const marked = transcript.queued(row.key);
    expect(touched(marked)).toEqual([row.key]);
    expect(rows(transcript)).toHaveLength(1);
    expect(rows(transcript)[0]).toMatchObject({
      kind: "user",
      text: "and check the other one",
      queued: true,
    });
    expect(asKind(rows(transcript)[0], "user")?.delivery).toBeUndefined();
    expect(transcript.undelivered(row.key)).toBeNull();
  });

  test("and stops saying it when the agent takes it up", () => {
    const transcript = conversation();
    const row = transcript.user("and check the other one");
    transcript.queued(row.key);

    transcript.taken(row.key);
    expect(asKind(rows(transcript)[0], "user")?.queued).toBeUndefined();
    expect(rows(transcript)[0]?.text).toBe("and check the other one");
  });

  test("taking up a row that never waited changes nothing", () => {
    const transcript = conversation();
    const row = transcript.user("done order");

    expect(transcript.taken(row.key)).toEqual(NOTHING);
    expect(asKind(rows(transcript)[0], "user")?.queued).toBeUndefined();
  });

  test("a row a replaced session took away is not minted to carry it", () => {
    const transcript = conversation();
    const row = transcript.user("and check the other one");
    transcript.clear();

    expect(transcript.queued(row.key)).toEqual(NOTHING);
    expect(transcript.taken(row.key)).toEqual(NOTHING);
    expect(rows(transcript)).toEqual([]);
  });

  test("only a `user` row can be waiting at all", () => {
    const transcript = conversation();
    transcript.add("notice", "cancelled");
    const [notice] = rows(transcript);

    expect(transcript.queued(notice?.id ?? "")).toEqual(NOTHING);
    expect(rows(transcript)[0]).not.toHaveProperty("queued");
  });
});

describe("a message the agent would not take", () => {
  test("the mark goes on the row that was already drawn, and the words stay", () => {
    const transcript = conversation();
    const row = transcript.user("done order", { context: [] });

    const marked = transcript.refused(
      row.key,
      {},
      "done order\nAbout: `order`",
    );
    expect(touched(marked)).toEqual([row.key]);
    expect(rows(transcript)).toHaveLength(1);
    expect(rows(transcript)[0]).toMatchObject({
      kind: "user",
      text: "done order",
      delivery: "refused",
    });
    expect(transcript.undelivered(row.key)).toBe("done order\nAbout: `order`");
  });

  test("a retry that lands takes the mark off and lets the prompt go", () => {
    const transcript = conversation();
    const row = transcript.user("done order");
    transcript.refused(row.key, {}, "done order");

    transcript.sent(row.key);
    expect(asKind(rows(transcript)[0], "user")?.delivery).toBeUndefined();
    expect(rows(transcript)[0]?.text).toBe("done order");
    expect(transcript.undelivered(row.key)).toBeNull();
  });

  test("marking a row a replaced session took away keeps neither half", () => {
    const transcript = conversation();
    const row = transcript.user("done order");
    transcript.clear();

    expect(transcript.refused(row.key, {}, "done order")).toEqual(NOTHING);
    expect(rows(transcript)).toEqual([]);
    expect(transcript.undelivered(row.key)).toBeNull();
  });

  test("clearing takes the prompts with the rows", () => {
    const transcript = conversation();
    const row = transcript.user("done order");
    transcript.refused(row.key, {}, "done order");

    transcript.clear();
    expect(transcript.undelivered(row.key)).toBeNull();
  });
});

describe("a message nothing ever answered about", () => {
  test("the row says so, and there is nothing to send it again with", () => {
    const transcript = conversation();
    const row = transcript.user("done order", { context: [] });

    const marked = transcript.unanswered(row.key);

    expect(touched(marked)).toEqual([row.key]);
    expect(rows(transcript)[0]).toMatchObject({
      kind: "user",
      text: "done order",
      delivery: "unanswered",
    });
    expect(transcript.undelivered(row.key)).toBeNull();
  });

  test("a refusal that turns into a silence lets its prompt go", () => {
    const transcript = conversation();
    const row = transcript.user("done order");
    transcript.refused(row.key, {}, "done order");

    transcript.unanswered(row.key);

    expect(asKind(rows(transcript)[0], "user")?.delivery).toBe("unanswered");
    expect(transcript.undelivered(row.key)).toBeNull();
  });
});

describe("refusals and replacement", () => {
  test("a refusal carries the failure itself, not a sentence about it", () => {
    const transcript = conversation();
    const failure = {
      reason: "`done: Kitchen remodel` would leave the outlines invalid",
      verdict: {
        issues: [
          {
            code: "duplicate-id",
            file: "house.olai",
            line: 3,
            message: "`order` is already the id of another node",
          },
        ],
      },
    };
    transcript.add("refusal", "`outlines_done` was refused", {
      refusal: failure,
    });

    const entry = rows(transcript)[0];
    expect(entry?.kind).toBe("refusal");
    expect(asKind(entry, "refusal")?.refusal).toBe(failure);
  });

  test("clearing reports every key it dropped, so a subscriber empties", () => {
    const transcript = conversation();
    transcript.add("user", "hello");
    transcript.say("hi");
    transcript.tool("call-1", { title: "x" });

    const cleared = transcript.clear();
    expect([...cleared.removes].sort()).toEqual([
      "agent:2",
      "tool:call-1",
      "user:1",
    ]);
    expect(rows(transcript)).toEqual([]);

    transcript.add("user", "what did we decide?");
    expect(rows(transcript)[0]?.seq).toBe(0);
  });
});

describe("what a dead agent is called", () => {
  const dispatched = (said: string) => ({
    title: "Task",
    status: "in_progress" as const,
    spawned: { said },
  });

  const notices = (transcript: Transcript<OlaiRow>): ReadonlyArray<string> =>
    rows(transcript)
      .filter((entry) => entry.kind === "notice")
      .map((entry) => entry.text);

  test("a fan-out that falls over says WHICH agent, not four times `Task`", () => {
    const transcript = conversation();
    transcript.tool("toolu_01A", dispatched("count the markdown files"));
    transcript.tool("toolu_01B", dispatched("find every chat file"));
    transcript.tool("toolu_01A", { status: "failed" });
    transcript.tool("toolu_01B", { status: "failed" });

    expect(notices(transcript)).toEqual([
      "the agent “count the markdown files” ended (failed)",
      "the agent “find every chat file” ended (failed)",
    ]);
  });

  test("... and so does one the turn walked away from", () => {
    const transcript = conversation();
    transcript.tool("toolu_01A", dispatched("count the markdown files"));
    transcript.tool("toolu_01B", dispatched("find every chat file"));
    transcript.settle();

    expect(notices(transcript)).toEqual([
      "the agent “count the markdown files” ended (never reported back)",
      "the agent “find every chat file” ended (never reported back)",
    ]);
  });

  test("a spawn that described itself with nothing is called what its row is", () => {
    const transcript = conversation();
    transcript.tool("toolu_01A", {
      title: "Task",
      status: "in_progress",
      spawned: {},
    });
    transcript.tool("toolu_01A", { status: "failed" });

    expect(notices(transcript)).toEqual(["the agent “Task” ended (failed)"]);
  });

  test("the harness's own description still wins where it registered a task", () => {
    const transcript = conversation();
    transcript.tool("toolu_01A", {
      ...dispatched("count the markdown files"),
      armed: { task: "task-1", description: "counting markdown under docs" },
    });
    transcript.tool("toolu_01A", {
      armed: { task: "task-1", ended: "failed" },
    });

    expect(notices(transcript)).toEqual([
      "the agent “counting markdown under docs” ended (failed)",
    ]);
  });
});

test("tool names stay fixed while owner and reply accept later frames", () => {
  const transcript = conversation();
  transcript.tool("one", { status: "pending" });
  transcript.tool("one", {
    title: "Read a node",
    untilNamed: { called: "engine_read" },
    extra: { row: "notes", reply: { file: "one.olai" } },
  });
  transcript.tool("one", {
    title: "working",
    untilNamed: { called: "moving title" },
    extra: { row: "replacement", reply: { file: "two.olai" } },
  });
  expect(asKind(rows(transcript)[0], "tool")).toMatchObject({
    text: "Read a node",
    called: "engine_read",
    row: "replacement",
    reply: { file: "two.olai" },
  });
});

test("late ownership relabels once and keeps the first engine spelling", () => {
  const transcript = conversation();
  transcript.tool("late", {
    title: "engine_read",
    untilNamed: { called: "engine_read" },
  });
  transcript.tool("late", {
    title: "Read a node",
    extra: { row: "notes", reply: { file: "one.olai" } },
  });
  expect(asKind(rows(transcript)[0], "tool")).toMatchObject({
    text: "Read a node",
    called: "engine_read",
    row: "notes",
  });
  transcript.tool("late", {
    title: "moving",
    untilNamed: { called: "moving" },
    extra: { row: "notes" },
  });
  expect(asKind(rows(transcript)[0], "tool")).toMatchObject({
    text: "Read a node",
    called: "engine_read",
  });
});

describe("conversation order is countable", () => {
  test("rows carry 0, 1, 2 … and a repeat keeps its number", () => {
    const transcript = conversation();
    for (let at = 0; at < 5; at++) transcript.add("notice", `n${at}`);
    transcript.tool("one", { status: "pending" });
    transcript.tool("one", { status: "completed" });
    transcript.add("notice", "last");
    expect(rows(transcript).map((row) => row.seq)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });

  test("a clear restarts the count with the rows", () => {
    const transcript = conversation();
    transcript.add("notice", "one");
    transcript.add("notice", "two");
    transcript.clear();
    transcript.add("notice", "three");
    expect(rows(transcript).map((row) => row.seq)).toEqual([0]);
  });
});

describe("a refusal's `auth` mark, and how it comes off", () => {
  const authOf = (row: OlaiRow | undefined): boolean | undefined =>
    row?.kind === "user" ? row.auth : undefined;

  test("comes off when the message goes after all", () => {
    const transcript = conversation();
    const { key } = transcript.user("hello");
    transcript.refused(key, { auth: true }, "hello");
    expect(authOf(rows(transcript)[0])).toBe(true);

    transcript.sent(key);
    expect(authOf(rows(transcript)[0])).toBeUndefined();
    expect(rows(transcript)[0]).not.toHaveProperty("delivery");
  });

  test("comes off when nothing came back either", () => {
    const transcript = conversation();
    const { key } = transcript.user("hello");
    transcript.refused(key, { auth: true }, "hello");
    transcript.unanswered(key);
    expect(authOf(rows(transcript)[0])).toBeUndefined();
  });

  test("comes off when a later refusal carries no reason", () => {
    const transcript = conversation();
    const { key } = transcript.user("hello");
    transcript.refused(key, { auth: true }, "hello");
    transcript.refused(key);
    expect(authOf(rows(transcript)[0])).toBeUndefined();
  });
});
