/**
 * THE SAME RULES, ASKED BY THE OTHER PRODUCT — olai's chat plugin's transcript
 * suite, run against the ONE class both products share.
 *
 * PORTED FROM `juspay/olai` (`packages/plugins/chat/src/transcript.test.ts`) at
 * the commit the shared runner was taken from. What changed is the SPELLING a
 * product supplies, not an assertion:
 *
 *   - the row type below is olai's, declared HERE from the shared field objects
 *     in `@kolu/acp/wire` plus olai's own fields — which is the whole point of
 *     the exercise: the class never names one of them;
 *   - `conversation()` becomes a factory that hands the class olai's row type
 *     and olai's two switches (a wipe resets the counters; a turn's delivery is
 *     a `user` row and nothing else);
 *   - `touched` reads a change's upserts by ROW rather than by `[key, row]`
 *     pair, because the shared `Change` carries rows (kolu's shape, and the one
 *     both wire members encode).
 *
 * Everything else — every expectation, every scenario — is byte-for-byte the
 * file this replaces.
 */

import type {
  Armed,
  Ask,
  Delivery,
  FileDiff,
  Spawned,
  ToolStatus,
} from "@kolu/acp/wire";
import { describe, expect, test } from "vitest";

import { clock } from "./clock.testlib.ts";
import { type Change, says, Transcript } from "./transcript.ts";

/** OLAI'S ROWS, as its chat plugin declares them — the five shared kinds plus
 *  `refusal`, and the fields only olai sets. The class neither knows nor reads
 *  one of them. */
type OlaiRow = {
  readonly id: string;
  readonly seq: number;
  readonly since: string;
} & (
  | {
      readonly kind: "user";
      readonly text: string;
      readonly queued?: true;
      readonly delivery?: Delivery;
      readonly auth?: true;
      readonly rang?: string;
      readonly context?: ReadonlyArray<unknown>;
      readonly attachments?: ReadonlyArray<string>;
    }
  | { readonly kind: "agent"; readonly text: string; readonly streaming?: true }
  | {
      readonly kind: "tool";
      readonly text: string;
      readonly status: ToolStatus;
      readonly detail?: string;
      readonly called?: string;
      readonly row?: string;
      readonly reply?: unknown;
      readonly terminals?: ReadonlyArray<unknown>;
      readonly progress?: string;
      readonly diffs?: ReadonlyArray<FileDiff>;
      readonly locations?: ReadonlyArray<string>;
      readonly parent?: string;
      readonly spawned?: Spawned;
      readonly armed?: Armed;
      readonly stranded?: true;
      readonly resumed?: string;
      readonly startedAt?: string;
    }
  | {
      readonly kind: "ask";
      readonly text: string;
      readonly ask: Ask;
      readonly parent?: string;
    }
  | {
      readonly kind: "refusal";
      readonly text: string;
      readonly refusal: unknown;
    }
  | { readonly kind: "notice"; readonly text: string }
);

/** olai's conversation: olaI's row union, a wipe that starts the counters again,
 *  and no row kind but `user` carrying a turn's delivery marks. */
const conversation = (now?: () => number): Transcript<OlaiRow> =>
  new Transcript<OlaiRow>({
    ...(now === undefined ? {} : { now }),
    deliverable: (row) => row.kind === "user",
    // olai's panel counts rows from nothing, so the first row is `seq` 0 — the
    // one product difference the class keeps as a value rather than a branch.
    denseSeq: true,
    // ... AND THE ONE SHAPE ITS ENGINES HAVE that a title rule must know about:
    // a raw label arrives first, and the row's real name arrives with the
    // OWNERSHIP a frame later. Every other row keeps its first title for good.
    retitle: (row, move) =>
      row.kind === "tool" &&
      row.row === undefined &&
      move.extra?.row !== undefined
        ? move.title
        : undefined,
  });

/** The rows as a reader would see them: conversation order, which is `seq`. */
const rows = (transcript: Transcript<OlaiRow>): ReadonlyArray<OlaiRow> =>
  [...transcript.entries().values()].sort((a, b) => a.seq - b.seq);

/** A row of this kind, or `undefined` — so a test that reads a kind-specific
 *  field names the kind rather than pretending every row carries it. */
const asKind = <K extends OlaiRow["kind"]>(
  entry: OlaiRow | undefined,
  kind: K,
): Extract<OlaiRow, { kind: K }> | undefined =>
  entry?.kind === kind ? (entry as Extract<OlaiRow, { kind: K }>) : undefined;

const parentOf = (entry: OlaiRow | undefined): string | undefined =>
  entry?.kind === "tool" || entry?.kind === "ask" ? entry.parent : undefined;

/** A change that says nothing at all — spelled once, because the empty
 *  answer has three fields now and a test asserting two of them would pass
 *  while the third carried a piece nobody meant to publish. */
const NOTHING: Change<OlaiRow> = { upserts: [], removes: [], appends: [] };

/** What one change touched, so a test can say a re-publish happened rather
 *  than inferring it from the state afterwards. */
const touched = (change: Change<OlaiRow>): ReadonlyArray<string> =>
  change.upserts.map((row) => row.id);

/** What one change ADDED to a row, as `<key>@<offset>:<text>` — the other half
 *  of {@link touched}, and spelled the same way for the same reason: a
 *  streaming answer's whole subject is what a change carries about a row it is
 *  not republishing. */
const added = (change: Change<OlaiRow>): ReadonlyArray<string> =>
  change.appends.map((piece) => `${piece.of}@${piece.at}:${piece.text}`);

describe("whether a change says anything", () => {
  // The guard every publisher is written against, and the reason it is asked
  // of the change rather than spelled at each of them: a chunk of a streaming
  // answer moves no ROW, so a caller naming upserts and removes drops every
  // token of every answer and lets the paragraph appear when the turn ends.
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

  /**
   * The defect `transcript-stream-quadratic` names, as a claim about what a
   * change CARRIES rather than about what a row holds.
   *
   * A chunk used to be published as the whole row it grew, so an answer cost
   * the wire the sum of its own prefixes — 1,039,111 bytes for 3,218 of
   * answer, measured on a real turn. The row is still whole HERE, which is the
   * other half of the fix and what makes the pieces safe: a reader handed the
   * row is never handed part of one.
   */
  test("a chunk into an open row is published as the chunk, never as the row", () => {
    const transcript = conversation();
    const opened = transcript.say("Hello");
    // The FIRST chunk mints the row, because there is nothing on the far end
    // to append to yet — one row, carrying one chunk.
    expect(touched(opened)).toEqual(["agent:1"]);
    expect(added(opened)).toEqual([]);

    expect(added(transcript.say(", "))).toEqual(["agent:1@5:, "]);
    expect(added(transcript.say("world"))).toEqual(["agent:1@7:world"]);
    // ... and not one byte of the row itself.
    expect(touched(transcript.say("!"))).toEqual([]);
  });

  test("what the pieces say and what the row holds are the same text", () => {
    const transcript = conversation();
    const said = ["Once", " upon", " a", " time"];
    let text = "";
    for (const chunk of said) {
      const change = transcript.say(chunk);
      for (const piece of change.appends) {
        // The offset is where the piece belongs, so a reader with the row's
        // text this long puts it exactly here.
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

    // Whole, so nothing has to be reassembled to be right — and no piece rides
    // with it, because the row it would belong to is right there.
    expect(settled.upserts.map((row) => [row.id, row.text])).toEqual([
      ["agent:1", "a long answer"],
    ]);
    expect(added(settled)).toEqual([]);
  });

  test("a replay of the conversation arrives whole", () => {
    // What a late joiner is snapshotted from is `entries()`, and a row that is
    // still being said is in it complete — the pieces are an acceleration of a
    // fact this map states anyway.
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

  /**
   * The bug the single-source refactor removed, kept as a test.
   *
   * An agent that speaks, then calls a tool, has finished that paragraph — the
   * next thing it says is a new one. The pointer said so; the row did not,
   * because clearing the pointer did not re-publish the row it left. So a
   * cursor blinked on a finished paragraph until the end of the turn.
   */
  test("a row stops streaming the moment something else opens", () => {
    const transcript = conversation();
    transcript.say("let me look");
    const change = transcript.tool("call-1", { title: "search_nodes" });

    // The tool frame AND the paragraph it closed, in one frame.
    expect(touched(change)).toEqual(["agent:1", "tool:call-1"]);
    expect(asKind(rows(transcript)[0], "agent")?.streaming).toBeUndefined();

    // And the next thing said is a new paragraph, not an append to the old.
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
    // A replay is the one place a PERSON's words arrive in pieces: a message
    // typed here is written whole, before anything is on the wire, but a
    // conversation being re-opened comes back as however many chunks the agent
    // kept it in. A row per chunk is one sentence drawn as three bubbles down
    // the side of the panel — somebody's own words, taken apart, in the place a
    // reader looks to remember what they asked.
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
    // The KIND is what decides whether the open row is the right one to grow.
    // Nothing closes a paragraph between a person's words and the agent's reply
    // to them, so an agent chunk appended to an open user row would put the
    // answer inside the question.
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
    // A title is a DISPLAY string and the protocol says no more about it: an
    // agent is free to send the tool's name while the call is being announced,
    // a sentence about what it is doing while it runs, and something else again
    // when it fails. Taking the newest is a row that renames itself twice while
    // somebody reads it — and, for a spawn, a lane that renames itself with it.
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
    // The other side of the rule, and the shape a REPLAY has: a finished call
    // arrives as one collapsed report with no announcement in front of it, so
    // the frame that names it is not the first frame about it. "Picked once" is
    // about the first title, not about the first frame — a row left wearing its
    // own call id would be a panel that could not name a conversation's history.
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
    // One adapter announces a call the moment a tool use starts, before the
    // model's arguments have parsed, so its first title is derived from none:
    // a shell command arrives as the bare word "Terminal". The row wears that
    // while the arguments stream — a nameless row is worse — and the frame
    // that carries the real one NAMES it.
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

    // ... and then the ordinary rule, undiminished: the exception is about the
    // placeholder, not about the once-only naming it defers.
    transcript.tool("call-1", { title: "Bash", status: "completed" });
    expect(rows(transcript)[0]).toMatchObject({
      text: "echo hello",
      status: "completed",
    });
  });

  test("a frame repeating one already in says nothing", () => {
    // Agents repeat themselves — some send a report twice, byte for byte — and
    // a repeat is not a second report. Nothing about the call moved, so there
    // is nothing for a subscriber to be told.
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
    // A FRESH VALUE with the same words in it, which is what a second frame off
    // the wire is: an identical object would be answered by reference and prove
    // nothing about the comparison this rests on.
    expect(transcript.tool("call-1", structuredClone(move))).toEqual(NOTHING);
    expect(rows(transcript)).toHaveLength(1);
  });

  test("a repeat does not take back the mark its turn left", () => {
    // The half that is not merely quiet. The mark says "as far as this end can
    // tell, that one never came back", and it comes off when the agent reports
    // on the call again — so a repeat of a frame the row already had would put
    // a live face and a running clock back on a call in a conversation that has
    // gone idle, which is the bug the mark exists to prevent.
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
    // The panel looks the frame UP by what this field says, so what it says
    // has to be a key of this collection — the same rule `ask` rows follow in
    // the other direction. An id here would be a mapping somebody has to keep
    // in step for nothing.
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
    // The adapter stamps the attribution on a subagent's announcement and on
    // most of what follows, and it has shapes that carry only a status. A row
    // that read one of those as "no agent now" would step out of its lane at
    // the moment the call finished — which is the moment a reader looks.
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
    // The other end of the same rule, and it is sticky a level DOWN as well.
    // The fact arrives split across frames because the ARGUMENTS do: the call
    // is announced as the tool use starts, refined once they have parsed, and
    // sent with no arguments at all when the input would not serialize — and
    // its completion says nothing about being a spawn either. A row that took
    // the last word literally would stop being a spawn, or keep being one with
    // the kind of agent taken back off it.
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
    // The arguments arrive incrementally — announced as the tool use starts,
    // refined as they finish parsing — so the first frame can honestly say a
    // spawn happened and nothing about who. The row is drawable then; the
    // kind lands on the next frame.
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", {
      title: "explore the outline",
      spawned: {},
    });
    expect(asKind(rows(transcript)[0], "tool")?.spawned).toEqual({});

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
    // The report arrives on a later frame than the arming — an async agent's
    // task-notification, after the turn that sent it out has ended — and a
    // status-only update after that must not take it back off. It rides
    // `armed`, which is the vocabulary the ending already uses.
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
      // the shared encoding is kolu's: every field is spelled, `null` when this
      // outing has not reached it (olai's `Armed` left them absent)
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
    // The same stickiness one field over, and the row where it matters most.
    // A task's life is split across frames because the life IS split: the
    // frame that arms the call names the task, its kind and the description,
    // and the frame that settles it — minutes later, in another turn — names
    // the task and how it ended. Neither repeats the other, so without the
    // merge the row a person reads at the moment of death would have lost the
    // description that says WHICH watch just died.
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
    // The ruling this exists for: the arming row is at its birth position, and
    // a monitor armed at the top of a three-hour session is three hours of
    // scrollback away by the time it dies. So the ending is ALSO said where
    // the reader is, which in a transcript is the end of it.
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
    // ... at the END, under everything that happened in between, and not in
    // place of the arming row: that one is the record of the call and keeps
    // its own ending.
    expect(said[said.length - 1]).toMatchObject({
      kind: "notice",
      text: 'Background command "kolu fleet watch" failed with exit code 3',
    });
    expect(said[0]).toMatchObject({ kind: "tool", status: "failed" });
    expect(asKind(said[0], "tool")?.armed?.ended).toBe("failed");
  });

  test("the harness's sentence arrives a beat late and REFINES that row", () => {
    // The two bookends: a guaranteed patch with no summary, and the
    // notification carrying the sentence a moment later. A second row would be
    // the same death reported twice — which is exactly what a reader at the
    // bottom would read it as.
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
    // Nothing was said with the ending, so the row says the true thing it can.
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
    // A repeat is not a report, one row over: the transcript is keyed, and a
    // death is an event that happened once.
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
    // The review's SHOULD 1 (grok, at 71daeb9f). A persistent monitor is out,
    // somebody asks a question, the agent is mid-paragraph — and the monitor's
    // timeout fires. A tool frame ends the open paragraph, because normally it
    // means the agent stopped talking and did something; this frame means a
    // call made three hours ago just ended, and the agent has not stopped
    // anything. Closing on it left one answer in two halves with the death
    // between them.
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
    // ONE paragraph, whole — not two halves around a notice.
    const prose = said.filter((entry) => entry.kind === "agent");
    expect(prose.length).toBe(1);
    expect(prose[0]?.text).toBe(
      "Once upon a time the fleet was waiting and then the rest of the answer continues here.",
    );
    // ... and the death BELOW it, which is where the ruling puts it.
    expect(said[said.length - 1]).toMatchObject({
      kind: "notice",
      text: "the background task “kolu fleet watch” ended (completed)",
    });
  });

  test("... and an ordinary call in the same turn still ends the paragraph", () => {
    // The rule the exemption is carved out of, kept: a call the agent makes
    // WHILE it is talking is the agent having stopped to do something, and
    // what it says afterwards is a new paragraph. Only a frame about a task
    // already armed is exempt.
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
    // The arming frame IS the agent doing something — it made the call — so it
    // closes like any other. The exemption is for the frames that come back
    // about a task the row already carries.
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

// A SUBAGENT'S ENDING IS THE ONE THING A READER IS OWED WHERE THEY ARE LOOKING.
//
// Its calls have left this column — the panel files them under the `Agent` row
// that made them — so a fan-out that goes wrong changes nothing on screen, and
// the spawning row is at its birth position, which for a five-agent fan-out is
// above five agents' worth of whatever the main agent said next. So an ending
// is ALSO a line at the bottom, in the same place a background task's death
// lands and through the same guard.
//
// The word is what these are mostly about. *The background task “survey the web
// package” ended (failed)* is a sentence about a shell; what happened is that an
// agent died, and a person reading a fan-out has to tell those apart at a glance
// to know whether the work they are waiting on is coming.

describe("an agent that was sent out", () => {
  /** The frame the adapter sends as an `Agent` tool use starts: a title, a
   *  running status, and the fact that this one sent somebody. */
  const sent = {
    title: "survey the web package",
    status: "in_progress" as const,
    spawned: { kind: "Explore" },
  };

  /** The lines at the bottom, which is the whole subject here — a death is
   *  counted as well as read, because reporting one death twice is the failure
   *  half of these exist against. */
  const notices = (transcript: Transcript<OlaiRow>): ReadonlyArray<string> =>
    rows(transcript)
      .filter((entry) => entry.kind === "notice")
      .map((entry) => entry.text);

  test("a spawn whose call fails says an AGENT ended, not a background task", () => {
    // A SYNCHRONOUS subagent arms nothing — only an async `Agent` launch
    // registers a task with the harness — so there is no harness ending to read
    // and the row's own `failed` is the whole of what happened. Without this the
    // one visible trace of a dead agent is a status on a row somewhere above.
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", sent);
    transcript.say("meanwhile I will keep reading the other package");
    transcript.tool("toolu_01AGENT", { status: "failed" });

    const said = rows(transcript);
    // At the BOTTOM, under what the main agent went on to say — and the call's
    // own row keeps its ending, because a reader who scrolls back is owed it.
    expect(said[said.length - 1]).toMatchObject({
      kind: "notice",
      text: "the agent “survey the web package” ended (failed)",
    });
    expect(said[0]).toMatchObject({ kind: "tool", status: "failed" });
  });

  test("a spawn that comes back lands no line at all", () => {
    // The carve-out, and the reason it is not symmetrical with a task's. A
    // task's completion is news on a row that has been saying *still running*
    // for an hour; a subagent's is not — it reported into its own row's fold and
    // the main agent speaks in the very next breath. A line here would be one
    // row of furniture per agent per fan-out.
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", sent);
    transcript.tool("toolu_01AGENT", { status: "completed" });

    expect(notices(transcript)).toEqual([]);
    expect(rows(transcript)).toHaveLength(1);
  });

  test("A REOPENED CALL'S TASK HAS NOT ENDED, whatever the last outing said", () => {
    // The sharpest of the four facts an outing owns, and the one that is not
    // about drawing at all. `armed.ended` is what takes a call OUT of the
    // stranding exemption (`isTaskOut`), so an async agent still carrying its
    // first outing's ending is an agent whose face the next turn boundary
    // takes straight back off — the bug this whole change exists to end,
    // arriving one layer underneath it. `armed.report` is the same family:
    // outing #1's prose in the fold of outing #2 is "here is what the agent
    // found" while it is still out finding it.
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
    // Everything else the harness said about the task is as true of this outing
    // as of the last, and is still on the row. The last outing's ending and
    // its report are not.
    expect(out?.armed).toEqual({
      task: "bu13xz2ie",
      // ... and NOTHING was armed with a description here, so that one is null.
      description: null,
      // THE SHARED ENCODING IS KOLU'S: an `Armed` spells all four fields, with
      // `null` for the ones this outing has not reached (olai's left them
      // absent). These two are the last outing's, and they are not this one's.
      ended: null,
      report: null,
    });
    expect(out?.status).toBe("in_progress");

    // ... AND IT IS PUT BACK WHEN THIS OUTING ENDS, which is the other half and
    // the one a test that only watched the clearing would let rot: the harness
    // reports the second ending exactly as it reported the first
    // (`packages/plugins/claude/acp/patches/README.md` — the settle of a reopened call stamps it), so
    // the row is a call that has ended again rather than one that quietly
    // stopped being a task.
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
      // the shared encoding spells every field, `null` where the harness said
      // nothing (olai's `Armed` left them absent)
      description: null,
      ended: "completed",
      report: "outing two pushed the branch.",
    });
  });

  test("... so a turn ending under a RESUMED async agent leaves it alone", () => {
    // The consequence, said where a reader can see it: the exemption that keeps
    // a background task off the stranding sweep applies to the second outing
    // exactly as it applied to the first.
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
    // {@link #ended} remembers that a row's death has been reported, so that
    // the sentence arriving a beat after an ending refines that row rather than
    // minting a second. Spent on the first outing and never released, it would
    // silence the second — and the ending it would silence is the one a person
    // supervising a fan-out must not miss.
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
    // The variant the no-arming judgment was asked to weigh, and got wrong on
    // the settle: an async agent's completion is news at the bottom because the
    // row is an hour of scrollback away and the strip going quiet is the only
    // other face it has. That is as true of the outing somebody sent it on this
    // afternoon as of the one it was spawned with — so a second ending is said
    // where the first was, and a reader who was not watching the strip is told
    // both times.
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
    // The two bookends: a guaranteed patch that carries the status, and the
    // notification beside it that carries the words. The line is minted on the
    // first and REFINED by the second — on every outing, which is what the row's
    // own guard ({@link #dies}) was always able to do and what the spawn arm's
    // *has it only just failed* condition made unreachable. Left as it was, a
    // second outing's death said `failed` and nothing about why, with the reason
    // on a row at its birth position.
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
    // The same gap one kind of spawn over, and the one this arm is written for:
    // a subagent that armed nothing has only its own call's status to end on, so
    // a failure whose sentence arrives on a later frame had nowhere to put it.
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
    // The other kind of spawn: an async launch IS a background task, and the
    // harness reports how it ended in a turn of its own, minutes later. That
    // ending keeps the line a task's ending has always had — the row is far
    // above by then — and only the word changes.
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
    // The bug the re-keying closes. An async `Agent` launch ends TWICE as far
    // as this file is concerned — the call reaches `failed`, and the harness
    // says how the task it armed ended — and the two guards used to be in two
    // key spaces: one remembered by the row, one by the task's own id. So they
    // could not see each other, and the one death a person actually watches for
    // was reported to them twice, in two lines, at the bottom.
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", { ...sent, armed: { task: "bu13xz2ie" } });
    // The call falls over first — its own status, with nothing about the task.
    transcript.tool("toolu_01AGENT", { status: "failed" });
    // ... and the harness's ending for the task it armed arrives after it.
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
    // The two bookends, one row over from the task case: a guaranteed patch
    // carrying the ending, and the notification carrying the sentence a beat
    // later. A second row would be the same death reported twice — which is
    // exactly what a reader at the bottom would read it as.
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
    // The half that keeps the new word honest. Nothing about a task's death
    // moved: a monitor is not an agent, a reader who learned that sentence over
    // three hours of session is owed it unchanged, and the only thing that
    // decides between the two words is whether the call sent somebody out.
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
    // The ending NOTHING reports, and the reason a stranding is the one mark a
    // reader has to be told about rather than shown: the mark lands on a row
    // whose own calls are not in this column, so a fan-out whose agents never
    // come back leaves nothing on screen that changed. The word is olai's own —
    // the harness has none, because the harness does not know it happened.
    const transcript = conversation();
    transcript.tool("toolu_01AGENT", sent);
    transcript.settle();

    expect(notices(transcript)).toEqual([
      "the agent “survey the web package” ended (never reported back)",
    ]);
    expect(asKind(rows(transcript)[0], "tool")?.stranded).toBe(true);

    // ... and said ONCE. Stranding is asked at both ends of every turn, so a
    // line per idle spawn per turn would fill the bottom of the conversation
    // with the same death.
    transcript.begins();
    transcript.settle();
    expect(notices(transcript)).toHaveLength(1);
  });

  test("... but an agent out when the CONVERSATION died says nothing of its own", () => {
    // The one stranding that mints nothing. A dead agent owes a reader one
    // sentence about itself, which `chat.ts` publishes; six of them, one per
    // agent it happened to have out, would bury it in its own consequences.
    // The rows are still marked — the rails have to go out — and only the
    // telling is left to the conversation.
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
    // The agent that would have reported has finished, so nothing will ever
    // report on this call again. What the STATUS says is left exactly as it
    // came — `pending` is the agent's own word and the row is the record of
    // what it said — and what is added is olai's own observation.
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
    // `status` is a tool row's field, so every other kind of row is a row this
    // has nothing to say about — and a mark on one would be a claim about a
    // sentence somebody typed.
    const transcript = conversation();
    transcript.user("done order");
    transcript.say("looking");
    transcript.settle();

    expect(
      rows(transcript).map((entry) => asKind(entry, "tool")?.stranded),
    ).toEqual([undefined, undefined]);
  });

  test("A LATER TURN DOES NOT UNDO IT — which is the whole point", () => {
    // The bug this exists for. A dead agent's rows are deliberately not
    // cleared, so sending again puts a live turn over a transcript full of
    // calls that will never report. A panel asking "is a turn in flight" would
    // light every one of them back up at once; the mark is on the ROW, so it
    // survives the next turn and every turn after it.
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
    // `settle` normally says this already, at the honest moment. `begins` is
    // the other end of the same turn, and it is what makes "nothing from a
    // previous turn is unstranded under this one" a property rather than a
    // path: a turn that ended some way nobody thought of is still a turn the
    // next one starts after.
    const transcript = conversation();
    transcript.tool("call-1", { title: "Grep", status: "pending" });
    transcript.begins();

    expect(asKind(rows(transcript)[0], "tool")?.stranded).toBe(true);
  });

  test("A CALL THAT ARMED A BACKGROUND TASK IS NOT LEFT BEHIND", () => {
    // The one call whose whole point is to outlive the turn. A monitor armed
    // in one turn watches for an hour and reports its end in whatever turn is
    // open when it stops — or in none. Marking it would put out the live face
    // at the moment the task starts doing its work, and the row would say
    // "abandoned" about the very thing the panel was asked to show.
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
    // The half that keeps the exemption honest. An ended task's call needs no
    // exemption — it is settled, like any other call that came back — and the
    // exemption is read off the TASK's own life rather than off the row having
    // once armed one. A settled row is not stranded anyway; what this pins
    // is that the exemption stops applying, so an armed row whose agent died
    // between the ending and the report is marked like everything else.
    const transcript = conversation();
    transcript.tool("toolu_01WATCH", {
      title: "Monitor",
      status: "in_progress",
      armed: { task: "bu13xz2ie" },
    });
    transcript.tool("toolu_01WATCH", {
      // A harness that reported the ending without moving the status — the
      // status arm and the task arm are two facts, and this pins the one the
      // exemption reads.
      status: "in_progress",
      armed: { task: "bu13xz2ie", ended: "stopped" },
    });
    transcript.settle();

    expect(asKind(rows(transcript)[0], "tool")?.stranded).toBe(true);
  });

  test("a call that reports again is running again", () => {
    // The one thing that could make the mark untrue: it means "as far as
    // anything here knows, that one never came back", and a frame about it is
    // anything here knowing.
    const transcript = conversation();
    transcript.tool("call-1", { title: "Grep", status: "in_progress" });
    transcript.settle();
    expect(asKind(rows(transcript)[0], "tool")?.stranded).toBe(true);

    transcript.tool("call-1", { status: "in_progress", progress: "halfway" });
    expect(asKind(rows(transcript)[0], "tool")?.stranded).toBeUndefined();
  });

  test("marking is said once, not once per turn", () => {
    // This runs at both ends of every turn. A frame per idle call per turn
    // would be a conversation republishing its whole history to say nothing.
    const transcript = conversation();
    transcript.tool("call-1", { title: "Grep", status: "in_progress" });
    expect(touched(transcript.settle())).toEqual(["tool:call-1"]);
    expect(touched(transcript.begins())).toEqual([]);
    expect(touched(transcript.settle())).toEqual([]);
  });

  test("a turn that ends beside another closes ITS paragraph and nothing else", () => {
    // Two turns in a row is the ordinary shape now — a message typed while the
    // agent works is one — and the answers have to land in paragraphs of their
    // own. The agent's prose grows the row that is open, so a turn that ended
    // without closing one left the next turn's first word on the end of its
    // last sentence: `…the Moon at work.BANANA`, with the question BANANA
    // answered somewhere above it.
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
    // ... and the OTHER turn's call is still running. Stranding it because a
    // sibling finished would be the panel saying a live grep had been walked
    // away from, which is why this is not `settle`.
    expect(asKind(rows(transcript)[1], "tool")?.stranded).toBeUndefined();
  });

  test("... and closing twice is not news", () => {
    // Every turn that ends calls it, and most of them have nothing open.
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
    // The rule this stamp exists for. A long call reports itself several times
    // while it runs — content, locations, a status — and every one of those
    // comes through the same writer, so a re-stamp would reset the duration on
    // exactly the frames somebody is watching it grow.
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
    // `since` is off `RowContent` for the reason `seq` and `streaming` are —
    // every re-publish goes through a spread of the row as it stands, and a
    // field a caller could set is a field a caller could set WRONG once and
    // then carry forward forever.
    //
    // The TYPE is the first line of that: no door here takes a field the writer
    // derives, so the cast below is what somebody would have to write to get
    // past it. The derivation is the second line, and this is the test of it —
    // handed one anyway, the writer's own stamp is what lands.
    const time = clock("2026-08-21T12:00:00.000Z");
    const transcript = conversation(time.now);
    transcript.user("hello", { since: "1999-01-01T00:00:00.000Z" } as never);
    expect(rows(transcript)[0]?.since).toBe("2026-08-21T12:00:00.000Z");
  });

  test("A CALL THAT WAS OVER AND IS RUNNING AGAIN is stamped with the moment", () => {
    // A subagent that reported and was sent MORE WORK. The call that answers
    // for it is the one that SPAWNED it — the adapter reopens that very call
    // when the harness starts its task again (`packages/plugins/claude/acp/patches/README.md`), because
    // everything the agent does goes on being stamped with it — so the row goes
    // from over to running again, which is a transition nothing else makes.
    //
    // TWO STAMPS, and each answers a different question. `since` is where the
    // record starts and does not move, because a reader who scrolls back to
    // this row is owed when the agent was first sent out. `resumed` is what a
    // clock counts from, because *how long has this been out* is about the
    // outing rather than about the row.
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
    // Every call in nearly every conversation. `pending` is a running state —
    // it means "announced" — so the ordinary announcement-then-progress pair is
    // not a call going round twice, and a row that said it was would put a
    // second clock on the panel's commonest row.
    const time = clock("2026-08-21T12:00:00.000Z");
    const transcript = conversation(time.now);
    transcript.tool("call-1", { title: "Grep", status: "pending" });
    time.pass(1_000);
    transcript.tool("call-1", { status: "in_progress", progress: "halfway" });

    expect(asKind(rows(transcript)[0], "tool")?.resumed).toBeUndefined();
  });

  test("... nor does a call its turn walked away from, reporting late", () => {
    // A stranded call is not a call that STOPPED: its status is still running
    // and stays running, deliberately, because the row is the honest record of
    // a call that was announced and never came back. So a late report unmarks
    // it (which the mark's own rule already does) and starts no second outing —
    // the agent never went out twice, one turn simply stopped waiting.
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
    // Agents repeat themselves, and the transcript's own rule is that a frame
    // saying nothing new changes nothing. A stamp taken before that guard would
    // be the one field a repeat could still move — and it moves the clock a
    // person is reading, backwards, once per repeat.
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
    // `resumed` is off `RowContent` for the reason `since`, `seq` and
    // `stranded` are — every re-publish spreads the row as it stands, so a
    // field a caller could set is a field that rides past the decision meant to
    // make it. Handed one anyway, nothing lands: this row has been round once.
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
    // It is minted beside `seq`, by the one writer, for every kind of row. A
    // stamp that existed only for the rows the elapsed readout happens to draw
    // would be the row minter knowing about a face.
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
    // The form and its answer are one thing that happened. A second row would
    // leave an answer with nothing above it saying what was asked.
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
    // The row a person is about to act on. Drawn in the main column it says
    // the MAIN agent is asking, which is the one thing about a permission form
    // that cannot be wrong — and it names the `Agent` frame's own key, the
    // same shape a tool call the subagent made names it by, so the panel looks
    // one row up rather than mapping an id onto one.
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
    // The row is REWRITTEN when it settles rather than patched, so this is the
    // one place the attribution could be dropped — and it would be dropped at
    // the moment the row becomes the record of a decision somebody made.
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
    // THE VISIBLE HALF of the same bug. An unattributed form landing between
    // two of one subagent's calls is a row in no lane, which ENDS the stretch
    // — so the lane re-opens and introduces itself again underneath the form,
    // saying a second agent started where there was only ever one. The
    // transcript's half of that is that all three rows name the same lane;
    // what the panel then draws is `lanes.ts`'s.
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
    // A session replaced under a pending question empties the transcript before
    // the withdrawal arrives; minting a row here would put a dead question at
    // the top of a fresh conversation.
    const transcript = conversation();
    transcript.ask("ask:1", "Shall I?", fields, null, null);
    transcript.clear();

    expect(
      transcript.settleAsk("ask:1", { how: "withdrawn", answers: [] }),
    ).toEqual(NOTHING);
    expect(rows(transcript)).toEqual([]);
  });
});

// The rule every test here is about: THE MARK AND THE PROMPT MOVE TOGETHER.
// A row offering a retry with no prompt behind it offers one that refuses, and
// a prompt with no marked row is a message nobody can see. They live in one
// place so that neither is constructible, which is what these assert — always
// both, at every door.
//
// A message that is merely WAITING is not one of those marks and must not read
// as one: it went out, it is at the agent, and there is a turn in front of it.
// Its own field for its own reason — a row in the column of things that went
// wrong would tell a person the opposite of the truth.

describe("a message the agent has not started on", () => {
  test("says so on the row it was typed into, and keeps its words", () => {
    const transcript = conversation();
    const row = transcript.user("and check the other one");

    const marked = transcript.queued(row.key);
    // THE SAME ROW, like every other thing that can be true about a message
    // after it was drawn: no second row, no notice underneath.
    expect(touched(marked)).toEqual([row.key]);
    expect(rows(transcript)).toHaveLength(1);
    expect(rows(transcript)[0]).toMatchObject({
      kind: "user",
      text: "and check the other one",
      queued: true,
    });
    // ... and it is not a DELIVERY. Nothing has failed, so there is nothing to
    // offer to send again and nothing kept to send it with.
    expect(asKind(rows(transcript)[0], "user")?.delivery).toBeUndefined();
    expect(transcript.undelivered(row.key)).toBeNull();
  });

  test("and stops saying it when the agent takes it up", () => {
    const transcript = conversation();
    const row = transcript.user("and check the other one");
    transcript.queued(row.key);

    transcript.taken(row.key);
    // ABSENT rather than `false`, for `streaming`'s reason: an ordinary message
    // says nothing about this, and the writer only ever writes the one value.
    expect(asKind(rows(transcript)[0], "user")?.queued).toBeUndefined();
    expect(rows(transcript)[0]?.text).toBe("and check the other one");
  });

  test("taking up a row that never waited changes nothing", () => {
    // The caller's rule is "clear whoever is at the head now", asked on every
    // turn that ends — so most of these land on a row that never carried the
    // mark, and a no-op is what makes that rule safe to state that simply.
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
    // The mark is about a message somebody sent. A tool call or a notice has
    // nobody waiting on it and no words of anybody's on it.
    const transcript = conversation();
    transcript.add("notice", "cancelled");
    const [notice] = rows(transcript);

    expect(transcript.queued(notice?.id ?? "")).toEqual(NOTHING);
    expect(rows(transcript)[0]).not.toHaveProperty("queued");
  });
});

// And the mark is TWO marks, which is the other half of the same rule: a
// refusal is certain and keeps its prompt, a silence is not and keeps none, so
// the button a person can press exists exactly where pressing it is honest.

describe("a message the agent would not take", () => {
  test("the mark goes on the row that was already drawn, and the words stay", () => {
    const transcript = conversation();
    const row = transcript.user("done order", { context: [] });

    const marked = transcript.refused(
      row.key,
      {},
      "done order\nAbout: `order`",
    );
    // THE SAME ROW, not a second one and not a notice underneath: what a
    // person typed stays where they typed it, and the failure is a property
    // of that message rather than an event beside it.
    expect(touched(marked)).toEqual([row.key]);
    expect(rows(transcript)).toHaveLength(1);
    expect(rows(transcript)[0]).toMatchObject({
      kind: "user",
      text: "done order",
      delivery: "refused",
    });
    // The PROMPT, not the row's text: what the agent refused had a node line
    // under it, and a retry rebuilt from what the panel shows would send
    // something else.
    expect(transcript.undelivered(row.key)).toBe("done order\nAbout: `order`");
  });

  test("a retry that lands takes the mark off and lets the prompt go", () => {
    const transcript = conversation();
    const row = transcript.user("done order");
    transcript.refused(row.key, {}, "done order");

    transcript.sent(row.key);
    // ABSENT rather than a third value: an ordinary message says nothing about
    // this, and a row left carrying the field would go on being drawn as one
    // that had failed once.
    expect(asKind(rows(transcript)[0], "user")?.delivery).toBeUndefined();
    expect(rows(transcript)[0]?.text).toBe("done order");
    // ... and nothing is left to retry it with, so a second click is refused
    // rather than sending the message twice.
    expect(transcript.undelivered(row.key)).toBeNull();
  });

  test("marking a row a replaced session took away keeps neither half", () => {
    const transcript = conversation();
    const row = transcript.user("done order");
    transcript.clear();

    expect(transcript.refused(row.key, {}, "done order")).toEqual(NOTHING);
    expect(rows(transcript)).toEqual([]);
    // The prompt is not kept for a row that is not there: it would be a retry
    // nothing on screen could ask for, landing in a conversation that never
    // saw the message.
    expect(transcript.undelivered(row.key)).toBeNull();
  });

  test("clearing takes the prompts with the rows", () => {
    const transcript = conversation();
    const row = transcript.user("done order");
    transcript.refused(row.key, {}, "done order");

    transcript.clear();
    // The one place a conversation ends empties BOTH halves, so no caller has
    // to remember the second — which is the whole reason they live together.
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
      // THE WORDS ARE STILL THERE, which was always the promise. What is
      // missing is the certainty, not the message.
      text: "done order",
      delivery: "unanswered",
    });
    // NO PROMPT, and that is the design rather than an omission: the agent may
    // have this message already, so a retry would be a duplicate offered to
    // somebody with no way to tell. Keeping nothing is what makes the button
    // unofferable rather than merely undrawn.
    expect(transcript.undelivered(row.key)).toBeNull();
  });

  test("a refusal that turns into a silence lets its prompt go", () => {
    const transcript = conversation();
    const row = transcript.user("done order");
    transcript.refused(row.key, {}, "done order");

    // The retry went out and THAT one went quiet — the same row, a second
    // reading of what became of it. The first failure's prompt must not
    // outlive it: a button built from it would send a message the agent may
    // now be holding.
    transcript.unanswered(row.key);

    expect(asKind(rows(transcript)[0], "user")?.delivery).toBe("unanswered");
    expect(transcript.undelivered(row.key)).toBeNull();
  });
});

describe("refusals and replacement", () => {
  test("a refusal carries the failure itself, not a sentence about it", () => {
    const transcript = conversation();
    // WHAT the refusal carries is the product's: olai's `OpFailure`, here as
    // the two facts its own panel draws. The transcript copies it and reads
    // none of it — which is the claim this test makes.
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

    // And the sequence starts over, so a replayed conversation reads from the
    // top rather than after the one it replaced.
    transcript.add("user", "what did we decide?");
    expect(rows(transcript)[0]?.seq).toBe(0);
  });
});

/**
 * ... and what a death is CALLED, against the adapter this panel ships with
 * rather than against the convenient fiction the fixtures above share.
 *
 * The block above titles its spawns with what they were sent to do, which is
 * what the e2e fake agent does too — and it is not what the real adapter does.
 * An `Agent` call is titled with the TOOL's name, and a row's title is pinned
 * at the first frame that carries one, so every agent of a fan-out is a row
 * reading `Task`. Every test up to here passes either way, which is exactly how
 * the death lines came to say *the agent “Task” ended* while three other
 * surfaces had already been taught better (both reviewers of #412, converging).
 *
 * So these drive the SHAPE THE ADAPTER SENDS: a title that is the tool's name,
 * and the description beside it in `spawned.said`.
 */
describe("what a dead agent is called", () => {
  /** One agent of a fan-out, as the real adapter announces it. */
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
    // The failure this is written against is not that the row is wrong — it is
    // that four identical rows tell a reader something has gone wrong and then
    // refuse to say what. A bottom line is the one place a dead subagent is
    // reported now that its calls are drawn elsewhere.
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
    // The other ending, and the one nothing reports: `#strand` names the agent
    // out of the same field, so a fan-out abandoned at a turn's end reads as
    // two agents rather than as two copies of a tool's name.
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
    // The fallback, and it is the honest one: what a reader sees on the row.
    // Never a category — *agent* is what KIND was sent, which is a different
    // question and is drawn on the row's own line.
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
    // An ASYNC launch is both a spawn and an armed task, and the harness knows
    // what it armed. Two vocabularies for one question, and the more specific
    // one is the harness's — so this is the one case `said` does not decide.
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
    once: { called: "engine_read" },
    extra: { row: "notes", reply: { file: "one.olai" } },
  });
  transcript.tool("one", {
    title: "working",
    once: { called: "moving title" },
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
    once: { called: "engine_read" },
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
    once: { called: "moving" },
    extra: { row: "notes" },
  });
  expect(asKind(rows(transcript)[0], "tool")).toMatchObject({
    text: "Read a node",
    called: "engine_read",
  });
});

/**
 * `seq` IS DENSE FROM ZERO, and this is the assumption the client's "how many
 * older rows are there" rests on (`browser/chat/state.ts`'s `oldest`): the
 * number of rows below a row's `seq` is the row's `seq`, so a tab can answer
 * the count from what it holds without a round trip.
 *
 * It holds because `#write` mints a `seq` only for a key it has not seen
 * (`this.#seq++`) and a clear is the one thing that takes rows away — and it
 * restarts the counter with them. A tool call reported twice is the SAME key
 * and keeps its number. A cheaper "count the rows" would agree today and drift
 * silently on the first path that mints a second number for one row, which is
 * why the claim is written down where the counter lives rather than inferred at
 * the one reader.
 */
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
