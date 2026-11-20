/**
 * The harness, against a REALLY SPAWNED agent.
 *
 * Every hazard this package exists to handle is a fact about two processes and
 * a pipe — a frame from a session we left, a question still open when a turn is
 * cancelled, a prompt that arrives while the agent is busy — so the fixture is
 * a process (`@kolu/acp-client`'s `fixtures/agent.ts`) rather than a mock of a connection. A
 * mock able to express those races would be the harness written twice.
 *
 * Which is also why this is the `test:daemon` lane: every case here forks a
 * detached process group, and the one `afterEach` below is what guarantees a
 * failing assertion cannot walk away from one.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  allowingOurs,
  type Leg,
  mcpCallBy,
  namedExactly,
  type Reported,
} from "@kolu/acp/engine";
import { afterEach, describe, expect, test } from "vitest";
import {
  type Compaction,
  type Harness,
  type HarnessChange,
  type HarnessOptions,
  HarnessRefused,
  type HarnessState,
  type PersonSaid,
  startHarness,
} from "./harness.ts";
import {
  type FixtureFile,
  type FixtureRow,
  published,
} from "./rows.testlib.ts";
import type { RowContent } from "./transcript.ts";
import { fixtureAgent } from "@kolu/acp-client/testlib";

/** The store a signed-out sentence NAMES. Any path: what is under test is
 *  that the panel says WHICH directory was judged, never that this harness
 *  knows anything about what is in one. */
const CONFIG_DIR = "/tmp/kolu-test-home/.claude";

/** The standing prompt, as DATA — a product's words, and all this package has
 *  to keep about them is that they ride the first message of a session that
 *  has not been taught and no later one. */
const TEACHING = "# [fixture] you are the fixture's conversation";

/** How the fixture spells an MCP server's tools — the pinned Claude adapter's
 *  own spelling, which is what makes the auto-allow rule's positive
 *  recognition worth testing against it. */
const spelling = (server: string): string => `mcp__${server}__`;

const meta = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

/** What the fixture's own forwarded message says — the `_test/raw` channel,
 *  standing in for the one the pinned adapter forwards its wrapped CLI's
 *  messages on. A leg with `rawMessages: null` would make the `_meta` every
 *  open pays for untestable, which is how it went unread. */
const RAW = {
  openMeta: { test: { forward: true } },
  method: "_test/raw",
  modelIn: (params: unknown): string | null => {
    const model = meta(params)?.model;
    return typeof model === "string" ? model : null;
  },
  serversIn: (params: unknown): ReadonlyArray<Reported> | null => {
    const servers = meta(params)?.servers;
    if (!Array.isArray(servers)) return null;
    return servers.flatMap((entry): ReadonlyArray<Reported> => {
      const row = meta(entry);
      return typeof row?.name === "string" && typeof row.status === "string"
        ? [
            {
              name: row.name,
              attached: row.status === "connected",
              said: row.status,
            },
          ]
        : [];
    });
  },
};

/** A leg that reads the fixture's wire: its `_meta` names the tool, its parent
 *  and the background task a call armed. Everything else answers the honest
 *  nothing an agent that says nothing answers. */
const leg: Leg = {
  spelling,
  mcpCall: mcpCallBy(spelling),
  replyIn: () => undefined,
  // The fixture says "this account cannot" the way the pinned Claude adapter
  // does: `data.errorKind` on the refusal.
  accountRefusal: (data) => flag(data, "errorKind") === "rate_limit",
  toolNameIn: (value) => {
    const name = meta(value)?.name;
    return typeof name === "string" ? name : null;
  },
  toolNameOf: () => null,
  // The fixture's agent puts one question to a person as a form, and this is
  // its spelling of it — the one member every leg answers in its own
  // vocabulary.
  asksThroughForm: (name) => name === "AskUserQuestion",
  allowedWithoutAsking: allowingOurs(spelling),
  parentToolUse: (value) => {
    const parent = meta(value)?.parent;
    return typeof parent === "string" ? parent : null;
  },
  spawned: () => null,
  backgroundTask: (value) => {
    const armed = meta(meta(value)?.background);
    if (armed === null || typeof armed.task !== "string") return null;
    return {
      task: armed.task,
      ...(typeof armed.description === "string"
        ? { description: armed.description }
        : {}),
      ...(typeof armed.ended === "string" ? { ended: armed.ended } : {}),
    };
  },
  taskNotification: () => null,
  listedIn: () => null,
  prologueIn: () => null,
  bypassMode: "bypassPermissions",
  bypassModeRequired: false,
  // The two the harness does not read and the fixture's agent does not offer.
  // They are on `Leg` because `@kolu/acp` is a SHARED vocabulary — olai's own
  // panel steers and promises a queue — and a kolu leg answers them with the
  // honest nothing of an agent that advertises neither.
  steering: null,
  queues: () => false,
  rawMessages: RAW,
  models: {
    config: "model",
    nameIn: namedExactly,
    // The fixture's picker offers three rows and every one of them is a model
    // at the same size; a value it does not offer has no window to report,
    // which is the `null` a header draws nothing for.
    windowIn: (labels, id) => (labels.has(id) ? 200_000 : null),
  },
};

const silent = { info: () => {}, warn: () => {}, error: () => {} };

interface Running {
  readonly harness: Harness<FixtureRow>;
  /** Every row the harness has published, folded the way a caller folds them
   *  — so the assertions below are about what a READER sees rather than about
   *  the harness's own copy. */
  readonly rows: () => ReadonlyArray<FixtureRow>;
  readonly states: ReadonlyArray<HarnessState>;
}

/** WHAT A PERSON TYPED, as this fixture product hands it over: the words are
 *  the row's and the wire's alike, because nothing of this product rides above
 *  them. A product that composes something (kolu's mention block) is what the
 *  two fields are for. */
const typed = (
  text: string,
  files: ReadonlyArray<FixtureFile>,
): PersonSaid<FixtureRow> => ({
  text,
  body: text,
  extra: { attachments: files },
  files,
});

/**
 * WHAT THIS FIXTURE PRODUCT READS A TOOL CALL AS.
 *
 * Two frames carry one call — the arming frame has the input and the settling
 * frame the answer — so the reader FOLDS what it is handed into what it was
 * last told, field by field, which is the shape every product's reader has.
 * A call nobody handed us a server for is read as nothing at all.
 */
const readCall: HarnessOptions<FixtureRow>["readCall"] = (frame, held) => {
  const input = meta(frame.input);
  const answer = meta(frame.answer);
  const call = {
    about: text(input?.host) ?? text(answer?.id) ?? held?.call?.about ?? null,
    did: text(input?.worktree) ?? text(answer?.ran) ?? held?.call?.did ?? null,
  };
  // THE FIRST RECOGNISED CALL of the frame: this fixture's agent names one
  // tool per frame, which is the shape kolu's own reader is written for.
  const named = frame.mcp[0];
  if (
    named === undefined &&
    frame.asksThroughForm === undefined &&
    call.about === null &&
    call.did === null
  ) {
    return undefined;
  }
  return {
    extra: {
      server: named?.server,
      tool: named?.tool,
      // Absent rather than `false`: every optional field of a tool row means
      // UNCHANGED, and a call whose name has not arrived yet is not a call
      // anything has called ordinary.
      asksThroughForm: frame.asksThroughForm,
      ...(call.about === null && call.did === null ? {} : { call }),
    },
  };
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/** Every harness this file has started, so a failed assertion cannot leave a
 *  detached process group behind — `stop()` is the only thing that closes the
 *  pipe and kills the child, and a test that threw never reached its own. */
const started: Array<Harness<FixtureRow>> = [];

afterEach(async () => {
  const live = started.splice(0, started.length);
  await Promise.all(live.map((harness) => harness.stop("stopped by app")));
});

const open = async (
  fixture: string,
  extra: {
    resume?: string | null;
    resumedSeq?: number;
    resumedEndsWithDivider?: boolean;
    taught?: boolean;
    model?: string | null;
    leg?: Leg;
    mcpServers?: HarnessOptions<FixtureRow>["mcpServers"];
    whenNewSession?: "divide" | "clear";
    whenLoadRefused?: "fresh" | "report";
    whenReplayed?: "drop" | "keep";
    compacts?: HarnessOptions<FixtureRow>["compacts"];
    onCompaction?: HarnessOptions<FixtureRow>["onCompaction"];
    /** Extra argv for the fixture — a scripted agent that models two agents
     *  takes the difference on its command line rather than in a second copy
     *  of sixty lines of JSON-RPC. */
    args?: ReadonlyArray<string>;
  } = {},
): Promise<Running> => {
  const rows = new Map<string, FixtureRow>();
  const states: Array<HarnessState> = [];
  const fold = (change: HarnessChange<FixtureRow>): void => {
    if (change.kind === "state") {
      states.push(change.state);
      return;
    }
    // A TURN'S ENDING is a reading of its own; this suite follows rows.
    if (change.kind !== "rows") return;
    // DECODED AS A SERVER WILL, strictly, on the way in: a field the class
    // wrote that the product's contract does not declare is red here rather
    // than in a browser nobody is watching (`./rows.testlib.ts` argues it).
    for (const row of change.upserts) {
      const read = published(row);
      rows.set(read.id, read);
    }
    for (const id of change.removes) rows.delete(id);
    for (const append of change.appends) {
      const row = rows.get(append.of);
      if (row === undefined || !("text" in row)) continue;
      rows.set(append.of, {
        ...row,
        text: `${row.text.slice(0, append.at)}${append.text}`,
      });
    }
  };
  const harness = await startHarness<FixtureRow>({
    agent: "fixture-agent",
    leg: extra.leg ?? leg,
    adapter: {
      command: process.execPath,
      args: [fixtureAgent(fixture), ...(extra.args ?? [])],
    },
    cwd: process.cwd(),
    configDir: CONFIG_DIR,
    mcpServers: extra.mcpServers ?? [
      { kind: "stdio", name: "kolu", command: "/bin/true", args: [], env: {} },
    ],
    teaching: TEACHING,
    taught: extra.taught ?? false,
    ...(extra.compacts === undefined ? {} : { compacts: extra.compacts }),
    ...(extra.onCompaction === undefined
      ? {}
      : { onCompaction: extra.onCompaction }),
    log: silent,
    opens:
      extra.resume === undefined || extra.resume === null
        ? { kind: "fresh" }
        : { kind: "resume", id: extra.resume },
    ...(extra.resumedSeq === undefined ? {} : { resumedSeq: extra.resumedSeq }),
    ...(extra.resumedEndsWithDivider === undefined
      ? {}
      : { resumedEndsWithDivider: extra.resumedEndsWithDivider }),
    ...(extra.model === undefined ? {} : { model: extra.model }),
    readCall,
    // THE ARMS KOLU'S CONDUCTOR USES are the default here, because this suite
    // is the one that holds its behaviour; the other three have a suite of
    // their own (`./conversation.olai.test.ts`).
    whenNewSession: extra.whenNewSession ?? "divide",
    numbering: "continues",
    whenLoadRefused: extra.whenLoadRefused ?? "fresh",
    whenReplayed: extra.whenReplayed ?? "drop",
    onChange: fold,
  });
  started.push(harness);
  return {
    harness,
    rows: () => [...rows.values()].sort((a, b) => a.seq - b.seq),
    states,
  };
};

/** The agent's own refusal on the sign-in row — which is the AGENT's row: a
 *  row a person asked for has no refusal to read. */
const agentWhy = (state: {
  readonly signIn: HarnessState["signIn"];
}): string => {
  const cause = state.signIn?.cause;
  if (cause?.kind !== "agent")
    throw new Error(`no sign-in the agent offered: ${JSON.stringify(cause)}`);
  return cause.why;
};

/** Wait until the harness is idle again — the turn ran, and whatever it had to
 *  say has been said. A deadline rather than a sleep, so a hang fails with the
 *  state it hung in. */
const settled = async (running: Running, why: string): Promise<void> => {
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    const state = running.harness.state();
    if (state.phase === "idle" || state.phase === "asking") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${why}: still ${running.harness.state().phase}`);
};

/** The sign-in URL a method PRINTED, parsed — or `null` if it printed none.
 *
 *  A test that asked whether the output *contains* an address would be making
 *  the mistake the thing under test must never make: `https://evil.example/
 *  ?next=https://example.invalid/oauth` contains it too. Parse, then ask about
 *  the origin and the path, which is the only question with an answer. */
const oauthUrlIn = (output: string | null | undefined): URL | null => {
  const found = (output ?? "").match(/https:\/\/\S+/);
  if (found === null) return null;
  try {
    return new URL(found[0]);
  } catch {
    return null;
  }
};

/** ... and until the published STATE says something. Polled on the same
 *  deadline, because half of what a sign-in is reaches a reader as state
 *  rather than as the answer to a call: the methods, the output of the command
 *  running, and the line it is waiting for. */
const waitFor = async (
  running: Running,
  holds: (state: HarnessState) => boolean,
  why: string,
): Promise<void> => {
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    if (holds(running.harness.state())) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${why}: ${JSON.stringify(running.harness.state().signIn)}`);
};

const textOfKind = (
  running: Running,
  kind: FixtureRow["kind"],
): ReadonlyArray<string> =>
  running
    .rows()
    .filter((row) => row.kind === kind)
    .map((row) => ("text" in row ? row.text : ""));

/** What the fixture said back to a question only it can answer — the `servers`,
 *  `meta`, `modes` and `prompts` turns, which report what this process was
 *  TOLD. The last agent row is the answer, parsed. */
const asked = async (running: Running, about: string): Promise<unknown> => {
  await running.harness.prompt(typed(about, []), false);
  await settled(running, `the \`${about}\` turn never ended`);
  const said = textOfKind(running, "agent");
  return JSON.parse(said[said.length - 1] ?? "null");
};

/** A real 1×1 PNG, base64 as a browser hands one over — small enough to read
 *  and intact enough to assert on: what a test is asking is whether the bytes
 *  that crossed the pipe are the bytes that were pasted. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** WHERE THE FILES REALLY ARE for this run. padi writes an attachment out
 *  under its state root before it ever calls the harness, and the harness
 *  reads the bytes back off that path — so a fixture that invented a path
 *  would be testing a code path nobody runs. */
const ATTACHMENTS = await mkdtemp(path.join(tmpdir(), "acp-harness-"));

/** One attachment as a product hands it over: a NAME, a size and the PATH the
 *  bytes were written to. Nothing carries base64 on this wire — it cannot
 *  ride the frame — so the file below is the only copy there is. */
const written = async (
  fields: Omit<FixtureFile, "path">,
  contents: Buffer,
): Promise<FixtureFile> => {
  const where = path.join(ATTACHMENTS, fields.id);
  await writeFile(where, contents);
  return { ...fields, path: where };
};

/** One pasted image, written out. */
const picture = (
  over: Partial<Omit<FixtureFile, "path">> = {},
): Promise<FixtureFile> =>
  written(
    {
      id: "att-1",
      name: "shot.png",
      mimeType: "image/png",
      bytes: 68,
      ...over,
    },
    Buffer.from(PNG, "base64"),
  );

/** Wait until the subprocess is gone — the `die` turn answers nothing, so the
 *  only word a client gets about it is its own closed pipe. */
const dead = async (running: Running): Promise<void> => {
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    if (!running.harness.alive()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("the agent never died");
};

const dividers = (running: Running): ReadonlyArray<FixtureRow> =>
  running.rows().filter((one) => one.kind === "divider");

describe("one conversation with a real agent", () => {
  test("a prompt goes out and the answer comes back as one growing row", async () => {
    const running = await open("agent.ts");
    const { rowId } = await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");

    const rows = running.rows();
    const mine = rows.find((row) => row.id === rowId);
    expect(mine?.kind).toBe("user");
    expect(mine && "text" in mine ? mine.text : "").toBe("hello");
    expect(textOfKind(running, "agent")).toEqual(["hello back"]);
    // The row the harness holds and the row a reader folded out of the deltas
    // are the same row — which is what makes `appends` safe to send at all.
    expect(running.harness.rows().map((row) => row.id)).toEqual(
      rows.map((row) => row.id),
    );
    expect(running.harness.state().sessionId).toBe("sess-1");
  });

  test("the standing prompt rides the FIRST message and no later one", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the first turn never ended");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the second turn never ended");
    // What a PERSON typed is what the row says, both times: the teaching rides
    // the wire, not the transcript's record of what they said.
    expect(textOfKind(running, "user")).toEqual(["hello", "hello"]);

    // ... and the WIRE is asked, which is the half that used to pass whether
    // the teaching rode both turns or neither. The fixture kept every body:
    // the first carries the standing prompt above the word, and the second is
    // the word alone.
    const bodies = (await asked(running, "prompts")) as ReadonlyArray<string>;
    expect(bodies[0]).toBe(`${TEACHING}\n\nhello`);
    expect(bodies[1]).toBe("hello");
  });

  test("a frame for a session we left is dropped", async () => {
    const running = await open("agent.ts");
    // A new session CLOSES the one it replaces, which is what arms the fence.
    // The fixture mints a FRESH id per open and addresses its stale chunk to
    // the previous REAL one — an id this client genuinely held — so the fence
    // is the only thing standing between that chunk and the panel.
    await running.harness.newSession();
    expect(running.harness.state().sessionId).toBe("sess-2");
    await running.harness.prompt(typed("stale", []), false);
    await settled(running, "the turn never ended");
    expect(textOfKind(running, "agent")).toEqual(["live"]);
  });

  test("a new session keeps the history, with a divider between them", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the first turn never ended");
    await running.harness.newSession();
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the second turn never ended");

    // ONE transcript, two conversations: what was said before the break is
    // still there, and the divider says where the break was. Clearing it would
    // also have been a lie to padi, whose copy holds rows this process never
    // minted and could not have removed.
    const kinds = running.rows().map((row) => row.kind);
    expect(kinds.filter((kind) => kind === "divider")).toHaveLength(1);
    expect(textOfKind(running, "user")).toEqual(["hello", "hello"]);
    expect(textOfKind(running, "agent")).toEqual(["hello back", "hello back"]);
    // ... and every row still sorts after the one before it, because the
    // counters never went back.
    const seqs = running.rows().map((row) => row.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  test("a request about the session just left is turned away while the next one opens", async () => {
    // The window the fence exists for: the conversation has been left and the
    // next `session/new` has not answered, so there is no live session to tell
    // the request from. The fixture holds its answer to the open until this
    // request is answered, so the moment is reached every time rather than
    // raced for.
    const running = await open("agent.ts", {
      args: ["--ask-about-the-left-session"],
    });
    await running.harness.newSession();
    expect(running.harness.state().sessionId).toBe("sess-2");
    // NOT DRAWN: nobody is in the conversation it is about, so a question row
    // would be a request for a person to decide something on a dead session.
    expect(running.rows().filter((row) => row.kind === "ask")).toEqual([]);
    expect(running.harness.state().openAsks).toEqual([]);
    // ... and TURNED AWAY on the wire, which is what lets the agent's own
    // turn for that session end instead of waiting on an answer.
    expect(await asked(running, "leftAnswers")).toEqual([
      { outcome: { outcome: "cancelled" } },
    ]);
  });

  test("a cancel settles the question the turn was holding, withdrawn", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("ask", []), false);
    const until = Date.now() + 10_000;
    while (
      running.harness.state().openAsks.length === 0 &&
      Date.now() < until
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const [askId] = running.harness.state().openAsks;
    expect(askId).toBeDefined();

    await running.harness.cancel();
    await settled(running, "the cancelled turn never ended");

    const ask = running.rows().find((row) => row.id === askId);
    expect(ask?.kind).toBe("ask");
    // WITHDRAWN, never fabricated: nobody answered, and nobody is going to.
    expect(ask?.kind === "ask" ? ask.ask.outcome : null).toEqual({
      how: "withdrawn",
      answers: [],
    });
    expect(running.harness.state().openAsks).toEqual([]);
    // ... and the TURN really ended as cancelled, which is the agent's own
    // word and the only evidence the cancel reached it. The notice is where a
    // reader is told.
    expect(textOfKind(running, "notice")).toContain("the turn was cancelled");
  });

  test("a page the agent says is done settles the question row it was drawn as", async () => {
    // The page is held under the AGENT's own id, the only name
    // `elicitation/complete` says. Who files it and who looks it up are the two
    // halves of this harness, so they must read one record: filed in one and
    // looked up in the other, the row never settled and the turn waited on it
    // for ever.
    const running = await open("agent.ts");
    await running.harness.prompt(typed("visit", []), false);
    // IDLE, not merely settled: `asking` would also end a `settled` wait, and
    // the row standing open is exactly the failure.
    await waitFor(
      running,
      (state) => state.phase === "idle",
      "the turn waiting on the page never ended",
    );
    const ask = running.rows().find((row) => row.kind === "ask");
    expect(ask?.kind === "ask" ? ask.ask.outcome : null).toEqual({
      how: "answered",
      answers: [],
    });
    expect(running.harness.state().openAsks).toEqual([]);
  });

  test("a prompt sent while the agent is busy is marked queued, and unmarked when taken", async () => {
    const running = await open("agent.ts");
    // The fixture holds `slow` open until a SECOND prompt arrives, so the
    // queue is exercised by the thing that exercises it rather than by a
    // timer: a race this test cannot lose is one it also cannot lie about.
    const first = await running.harness.prompt(typed("slow", []), false);
    const second = await running.harness.prompt(typed("hello", []), false);
    const queued = running.rows().find((row) => row.id === second.rowId);
    expect(queued?.kind === "user" ? queued.queued : undefined).toBe(true);
    expect(first.rowId).not.toBe(second.rowId);

    await settled(running, "the queued turn never ended");
    const taken = running.rows().find((row) => row.id === second.rowId);
    expect(taken?.kind === "user" ? taken.queued : undefined).toBeUndefined();
  });

  test("a background task outlives its turn and its death lands as a notice", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("background", []), false);
    await settled(running, "the arming turn never ended");

    // The turn is over and the row is NOT stranded: outliving its turn is the
    // whole point of a background task, and the strip above the scroll says so.
    const armedRow = running
      .rows()
      .find((row) => row.kind === "tool" && row.armed !== undefined);
    expect(
      armedRow?.kind === "tool" ? armedRow.stranded : true,
    ).toBeUndefined();
    expect(running.harness.state().watching.map((one) => one.name)).toEqual([
      "watch the build",
    ]);

    await running.harness.prompt(typed("reap", []), false);
    await settled(running, "the reaping turn never ended");
    expect(textOfKind(running, "notice").join("\n")).toContain(
      "ended (completed)",
    );
    expect(running.harness.state().watching).toEqual([]);
  });

  test("a recognised call reaches the product's reader and lands on the row", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("kolu", []), false);
    await settled(running, "the turn never ended");

    const call = running.rows().find((row) => row.kind === "tool");
    // WHICH server and tool the client positively named is what the reader is
    // handed — a call it could not name reaches it with nothing, which is what
    // keeps a reading off somebody else's call.
    expect(call?.kind === "tool" ? call.server : null).toBe("kolu");
    expect(call?.kind === "tool" ? call.tool : null).toBe("lifecycle_create");
    // ... and BOTH FRAMES fold into one reading: the arming frame carried the
    // input (the host it was created on) and the settling frame the answer
    // (what ran), and the card draws what the two of them said.
    expect(call?.kind === "tool" ? call.call : null).toEqual({
      about: "remote:prod",
      did: "fix-parser",
    });
  });

  test("a turn the agent refuses marks the row refused and leaves the conversation alive", async () => {
    const running = await open("agent.ts");
    const { rowId } = await running.harness.prompt(typed("fail", []), false);
    await settled(running, "the failed turn never ended");
    const row = running.rows().find((one) => one.id === rowId);
    expect(row?.kind === "user" ? row.delivery : null).toBe("refused");
    expect(running.harness.state().phase).toBe("idle");
  });

  test("a load passes the SAME mcpServers — and the same `_meta` — a new session got", async () => {
    // One process, two opens: a fresh one and then the session replaced, so
    // both records are in the same fixture and comparable.
    const fresh = await open("agent.ts");
    await fresh.harness.newSession();
    expect(await asked(fresh, "servers")).toEqual([["kolu"], ["kolu"]]);
    // The `_meta` is the leg's own, and it is what the open is PAYING for: an
    // adapter reads its subscription off whichever call made the session, so a
    // load that sent a different one leaves every restored conversation silent.
    expect(await asked(fresh, "meta")).toEqual([RAW.openMeta, RAW.openMeta]);
    await fresh.harness.stop("stopped by app");

    // ... and the other door into an open: a RESUME, which is a
    // `session/load`.
    const resumed = await open("agent.ts", { resume: "sess-1" });
    expect(await asked(resumed, "servers")).toEqual([["kolu"]]);
    expect(await asked(resumed, "meta")).toEqual([RAW.openMeta]);
    expect(resumed.harness.state().sessionId).toBe("sess-1");
  });

  test("both MCP arms reach the wire in the shapes the adapter reads", async () => {
    // THE ONE KEY THE ADAPTER BRANCHES ON. `claude-agent-acp` 0.81.2
    // (`dist/acp-agent.js:6536-6558`) makes an entry with `type: "http"` an
    // HTTP server, an entry with NO `type` key a stdio server, and SILENTLY
    // DROPS one carrying `type: "stdio"`. So this asserts the ABSENCE of the
    // key on the stdio arm as hard as its presence on the http arm: a harness
    // that "completed" the union would hand the conductor a session with no
    // hands and no error anywhere.
    const running = await open("agent.ts", {
      mcpServers: [
        {
          kind: "stdio",
          name: "kolu",
          command: "/bin/true",
          args: ["mcp"],
          env: { PADI_SOCKET: "/tmp/padi.sock" },
        },
        {
          kind: "http",
          name: "kolu-fleet",
          url: "http://127.0.0.1:45121/mcp",
          headers: { Authorization: "Bearer deadbeef" },
        },
      ],
    });
    const shapes = await asked(running, "serverShapes");
    expect(shapes).toEqual([
      [
        {
          name: "kolu",
          command: "/bin/true",
          args: ["mcp"],
          env: [{ name: "PADI_SOCKET", value: "/tmp/padi.sock" }],
        },
        {
          type: "http",
          name: "kolu-fleet",
          url: "http://127.0.0.1:45121/mcp",
          headers: [{ name: "Authorization", value: "Bearer deadbeef" }],
        },
      ],
    ]);
    // `toEqual` on the whole entry already fails on a stray key, but say the
    // two rules in their own words so the reason survives a future edit: the
    // stdio arm carries NO `type`, the http arm carries one...
    const [firstOpen = []] = shapes as Array<Array<Record<string, unknown>>>;
    expect(firstOpen.map((entry) => "type" in entry)).toEqual([false, true]);
    // ... and the in-tree discriminant never crosses: `kind` on the wire would
    // be an unknown key on a server the adapter is about to spawn.
    expect(firstOpen.map((entry) => "kind" in entry)).toEqual([false, false]);
  });
});

describe("the permission mode a conversation is opened in", () => {
  test("is asked for after a new session AND after a load", async () => {
    const fresh = await open("agent.ts");
    expect(await asked(fresh, "modes")).toEqual([
      ["sess-1", "bypassPermissions"],
    ]);
    // The row on screen follows the CONFIRMED mode even though the agent sent
    // no `config_option_update` — the adapter is not obliged to, and a mode
    // row naming the mode we just moved off is a panel claiming the wrong
    // permissions.
    const mode = fresh.harness.state().options.find((one) => one.id === "mode");
    expect(mode?.value).toBe("bypassPermissions");
    await fresh.harness.stop("stopped by app");

    // A LOAD makes a session too, and a restored conversation that never asked
    // is the one where every write becomes a question somebody answers by hand.
    const resumed = await open("agent.ts", { resume: "sess-1" });
    expect(await asked(resumed, "modes")).toEqual([
      ["sess-1", "bypassPermissions"],
    ]);
  });

  test("a refusal is a row, and the conversation goes on without it", async () => {
    // A host that cannot have the mode the leg asks for — the pinned adapter
    // omits `bypassPermissions` under root unless IS_SANDBOX is set.
    const running = await open("agent.ts", {
      leg: { ...leg, bypassMode: "yolo" },
    });
    expect(running.harness.state().phase).toBe("idle");
    expect(textOfKind(running, "notice").join("\n")).toContain(
      "the permission mode `yolo` was not selected",
    );
    // The mode row still says what the agent confirmed, which is nothing: the
    // conversation is on the agent's own mode and says so.
    const mode = running.harness
      .state()
      .options.find((one) => one.id === "mode");
    expect(mode?.value).toBe("default");
    // ... and it is a conversation: the refusal cost nothing but a row.
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    expect(textOfKind(running, "agent")).toEqual(["hello back"]);
  });

  test("a leg that REQUIRES the mode gets a bring-up that fails loudly", async () => {
    // The other arm of the declaration, for an engine whose work is unsafe
    // without the mode: the open does not happen, the refusal is published,
    // and the subprocess goes with it rather than idling on a host with a
    // conversation nobody may use.
    const states: Array<HarnessState> = [];
    const starting = startHarness<FixtureRow>({
      agent: "fixture-agent",
      leg: { ...leg, bypassMode: "yolo", bypassModeRequired: true },
      adapter: {
        command: process.execPath,
        args: [fixtureAgent("agent.ts")],
      },
      cwd: process.cwd(),
      configDir: CONFIG_DIR,
      mcpServers: [],
      teaching: TEACHING,
      taught: false,
      opens: { kind: "fresh" },
      log: silent,
      numbering: "continues",
      readCall,
      whenNewSession: "divide",
      whenLoadRefused: "fresh",
      whenReplayed: "drop",
      onChange: (change) => {
        if (change.kind === "state") states.push(change.state);
      },
    });
    await expect(starting).rejects.toMatchObject({ name: "HarnessRefused" });
    const last = states[states.length - 1];
    expect(last?.phase).toBe("offline");
    expect(last?.refusal).toContain("`yolo` was not selected");
  });
});

describe("the model a person chose", () => {
  test("is put back after the open, in the picker's own vocabulary", async () => {
    // What the fixture comes up on is `default`; what somebody chose, and padi
    // remembered, is `sonnet`.
    const running = await open("agent.ts", { model: "sonnet" });
    expect(running.harness.state().model).toEqual({
      id: "sonnet",
      name: "Sonnet",
      window: 200_000,
    });
    // ... and it is the model a LATER conversation opens on, rather than the
    // one that was remembered when this process started.
    await running.harness.setOption("model", "haiku");
    await running.harness.newSession();
    expect(running.harness.state().model?.id).toBe("haiku");
  });

  test("a refused model leaves the conversation on the agent's own, and says so", async () => {
    const running = await open("agent.ts", { model: "fable" });
    // Open, usable, and honest: the header names what the agent confirmed.
    expect(running.harness.state().phase).toBe("idle");
    expect(running.harness.state().model?.id).toBe("default");
    expect(textOfKind(running, "notice").join("\n")).toContain(
      "could not be put back",
    );
  });

  test("the live model the agent reports wins over the picker's own value", async () => {
    const running = await open("agent.ts");
    expect(running.harness.state().model?.id).toBe("default");
    // The agent's own forwarded message names what the turn is REALLY running
    // on — the fact the picker cannot carry, because an adapter that handles a
    // model switch inside the CLI it wraps never sees a config change.
    await running.harness.prompt(typed("roster", []), false);
    await settled(running, "the turn never ended");
    expect(running.harness.state().model).toEqual({
      id: "sonnet",
      name: "Sonnet",
      window: 200_000,
    });
  });
});

describe("the MCP servers this conversation was handed", () => {
  test("start as handed with the path we handed, and move only on the agent's word", async () => {
    const running = await open("agent.ts");
    expect(running.harness.state().servers).toEqual([
      // `where` is the absolute command: "kolu is missing" is unreadable
      // without the path that was tried.
      { name: "kolu", standing: "handed", said: null, where: "/bin/true" },
    ]);

    await running.harness.prompt(typed("roster", []), false);
    await settled(running, "the turn never ended");
    // The AGENT said it reached this one, so the row moves and carries the
    // word it used. `ghost` is a server the agent named and nobody handed
    // over: it adds no row, because the roster answers "what did this
    // conversation get, and what became of it".
    expect(running.harness.state().servers).toEqual([
      {
        name: "kolu",
        standing: "connected",
        said: "connected",
        where: "/bin/true",
      },
    ]);
  });
});

describe("a conversation padi already holds the rows of", () => {
  test("drops the replay and mints past what is persisted", async () => {
    // The fixture replays two messages before it answers the load — history
    // the caller already has, in a poorer form: padi's copy carries kolu's own
    // readings, the agent's carries only what the agent said.
    const running = await open("agent.ts", {
      resume: "sess-1",
      resumedSeq: 12,
    });
    expect(running.rows()).toEqual([]);

    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    const rows = running.rows();
    expect(rows.map((row) => ("text" in row ? row.text : ""))).toEqual([
      "hello",
      "hello back",
    ]);
    // Nothing minted here may collide with a persisted row's id or sort above
    // one: a restored transcript whose next row claims `seq: 1` is a panel
    // folding the new message into the middle of the old conversation.
    for (const row of rows) expect(row.seq).toBeGreaterThan(12);
    expect(rows.map((row) => row.id)).toEqual(["user:13", "agent:14"]);
  });

  test("keeps the session's own news while dropping its history", async () => {
    // The same load replays what the session IS as well as what was said in
    // it: the slash commands it offers and how full its context is. Those are
    // facts only this process holds, and leaving the conversation has just
    // reset both — a fence that dropped them would leave a resumed
    // conversation with no `/` completion and no context meter for its life.
    const running = await open("agent.ts", {
      resume: "sess-1",
      resumedSeq: 12,
    });

    expect(running.rows()).toEqual([]);
    const state = running.harness.state();
    expect(state.commands).toEqual([
      { name: "compact", description: "summarise the conversation" },
      { name: "cost", description: "what this has cost" },
    ]);
    expect(state.usage).toEqual({ used: 22102, size: 200000 });
  });

  test("is not taught again when the caller says it already was", async () => {
    // THE STANDING PROMPT IS A FACT ABOUT THE SESSION, not about the process
    // that is holding it. A harness is replaced for reasons that have nothing
    // to do with the conversation — an upgrade, a crash, a signature — and one
    // that assumed nothing put the standing prompt back into the middle of a
    // chat, every time.
    const running = await open("agent.ts", {
      resume: "sess-1",
      resumedSeq: 12,
      taught: true,
    });
    expect(running.harness.state().taught).toBe(true);

    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    const bodies = (await asked(running, "prompts")) as ReadonlyArray<string>;
    expect(bodies.filter((body) => body.includes(TEACHING))).toEqual([]);
  });

  test("... and a session it opens itself after that one IS taught", async () => {
    // A new conversation is an agent with no memory of the old one, so the
    // flag the caller handed in is about the session it named and nothing
    // else.
    const running = await open("agent.ts", {
      resume: "sess-1",
      resumedSeq: 12,
      taught: true,
    });
    await running.harness.newSession();
    expect(running.harness.state().taught).toBe(false);

    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    const bodies = (await asked(running, "prompts")) as ReadonlyArray<string>;
    expect(bodies[0]).toBe(`${TEACHING}\n\nhello`);
  });
});

describe("a conversation the agent does not have", () => {
  test("opens a fresh one, once, with a break and a line saying why", async () => {
    // THE OWNER'S HOST. A session id kolu persisted, a CLI that has never
    // heard of it, and the adapter's own refusal: `-32002 Resource not
    // found: <id>`. Read as "the agent is broken" that killed the child and
    // the conductor spawned another to ask the same dead id again — four
    // `the agent exited (code 0)` lines and no conversation.
    const running = await open("agent.ts", {
      resume: "gone-ba0d0775-2692-4460-ad85-61bec0aeb318",
      resumedSeq: 12,
    });

    // THE CONVERSATION IS OPEN, on a session this agent really made, and the
    // process that refused is still the process we are talking to.
    const state = running.harness.state();
    expect(state.phase).toBe("idle");
    expect(state.sessionId).toBe("sess-1");
    expect(state.refusal).toBeNull();
    expect(running.harness.alive()).toBe(true);

    // ONE break, and one line carrying the agent's own sentence. The break is
    // the mark a `newSession` mints, under the same rule — the agent's memory
    // was reset, which is exactly what happened.
    expect(dividers(running).map((one) => one.kind)).toEqual(["divider"]);
    const notices = textOfKind(running, "notice");
    expect(notices).toEqual([
      expect.stringContaining("could not be resumed") as unknown as string,
    ]);
    expect(notices[0]).toContain(
      "Resource not found: gone-ba0d0775-2692-4460-ad85-61bec0aeb318",
    );
    // Nothing died: the "the agent exited" line is what a torn-down adapter
    // writes, and there is no torn-down adapter here.
    expect(notices.join("\n")).not.toContain("the agent exited");

    // EXACTLY ONE OPEN. The fixture records the servers each `session/new`
    // and each ANSWERED `session/load` was handed, so one entry is one
    // conversation opened — the refused load pushed none, and nothing asked
    // twice.
    expect(await asked(running, "servers")).toEqual([["kolu"]]);
    // ... and the rows sort above what padi already holds, like any other
    // open's would.
    for (const row of running.rows()) expect(row.seq).toBeGreaterThan(12);
  });

  test("an AUTH refusal on the load is the other thing, and still offers the sign-in", async () => {
    // `-32000` is not a fact about the id: this agent will not open ANY
    // conversation until somebody signs in, so a `session/new` asked for in
    // the same breath is the same refusal again. The child stays, the offer
    // goes up, and nothing is minted — no break, because nothing was reset.
    const running = await open("agent.ts", {
      resume: "locked-sess-1",
      resumedSeq: 12,
    });

    const state = running.harness.state();
    expect(state.phase).toBe("offline");
    expect(state.sessionId).toBeNull();
    expect(running.harness.alive()).toBe(true);
    expect(agentWhy(state)).toContain("Authentication required");
    expect(state.signIn?.methods.map((one) => one.id)).toEqual([
      "subscription",
    ]);
    expect(dividers(running)).toEqual([]);
    expect(textOfKind(running, "notice")).toEqual([]);
  });

  test("a break minted for a fresh session that will not open comes back out", async () => {
    // BOTH REFUSALS IN ONE BRING-UP: the load is refused for the ID and the
    // fresh session for the SIGNATURE. The fall-through happened, the open did
    // not — and a break drawn across a transcript where nothing was reset is
    // what a retry stacks, four deep, in the owner's screenshot. The line
    // stays: the conversation really was not resumed.
    const running = await open("signed-out-agent.ts", { resume: "sess-1" });

    expect(dividers(running)).toEqual([]);
    expect(textOfKind(running, "notice")).toEqual([
      expect.stringContaining("could not be resumed") as unknown as string,
    ]);
    const state = running.harness.state();
    expect(state.phase).toBe("offline");
    expect(running.harness.alive()).toBe(true);
    expect(agentWhy(state)).toContain("Authentication required");

    // ... and the signature CHANGES NOTHING HERE. The conversation this
    // person ends up in is the restart's, with the session the caller names;
    // a harness that opened one of its own would be guessing at it out of an
    // id it was handed before any of this happened.
    expect(await running.harness.signIn("subscription")).toBe("signed-in");
    expect(running.harness.state().sessionId).toBeNull();
    expect(running.harness.state().phase).toBe("offline");
    expect(running.harness.state().signIn).toBeNull();
    expect(dividers(running)).toEqual([]);
  });
});

describe("an agent nobody is signed in to", () => {
  test("keeps the child, says why, and takes the signature without opening anything", async () => {
    // The open is REFUSED and the harness still resolves: the process that
    // refused is the process the sign-in has to run against, and killing it
    // here is how the only remedy a person is offered becomes unreachable.
    const running = await open("signed-out-agent.ts");
    const offline = running.harness.state();
    expect(offline.phase).toBe("offline");
    expect(offline.sessionId).toBeNull();
    expect(running.harness.alive()).toBe(true);
    // The agent's own sentence, never an empty string: the client draws the
    // row and the button off this, so "" is a signed-out host with nothing to
    // offer.
    expect(agentWhy(offline)).toContain("Authentication required");
    expect(offline.signIn?.attempt).toBeNull();
    // The methods come off the handshake, and the `env_var` one is not among
    // them: this harness offers only sign-ins it can actually run.
    expect(offline.signIn?.methods.map((one) => one.id)).toEqual([
      "subscription",
    ]);
    expect(offline.refusal).toContain("Authentication required");

    // The terminal method's own command is what runs — the fixture hands over
    // a line that prints a URL and exits 0, which is the whole of "it worked"
    // for every one of these CLIs.
    expect(await running.harness.signIn("subscription")).toBe("signed-in");

    // ... and the offer comes down, because the store has been written. The
    // conversation stays shut: this process read its credential at
    // `initialize` and a turn in a session it opened now would be refused
    // again. Re-entering is the caller's restart.
    const after = running.harness.state();
    expect(after.phase).toBe("offline");
    expect(after.sessionId).toBeNull();
    expect(after.signIn).toBeNull();
  });

  test("a sign-in nobody offers is refused, and the harness stays up", async () => {
    const running = await open("signed-out-agent.ts");
    await expect(running.harness.signIn("api-key")).rejects.toBeInstanceOf(
      HarnessRefused,
    );
    expect(running.harness.alive()).toBe(true);
  });

  test("offers the sign-in on the agent's own word, conversation and all", async () => {
    // THE SEQUENCE THE PINNED PAIR REALLY HAS, measured against
    // `claude-agent-acp` 0.81.2 over agent-distro's `claude` 2.1.319 with an
    // empty `$HOME`: the handshake advertises the terminal methods, the agent
    // pushes `{kind:"none"}`, `session/new` SUCCEEDS, and `-32000` does not
    // arrive until the turn. The offer used to be published by a refused OPEN
    // alone, so on this sequence nothing was ever offered: the panel drew a
    // composer over an agent that could not answer, and its sign-in button
    // said the agent had offered no way in.
    const running = await open("signed-out-open-agent.ts");
    await waitFor(running, (one) => one.signIn !== null, "nothing was offered");
    const state = running.harness.state();
    expect(state.sessionId).toBe("sess-1");
    expect(state.identity?.kind).toBe("none");
    expect(state.signIn?.methods.map((one) => one.id)).toEqual([
      "console-login",
    ]);
    // The agent's own label, and the store its signature was judged against —
    // a path the next person can look at instead of guessing which config dir
    // this server read.
    expect(agentWhy(state)).toContain("Not logged in");
    expect(agentWhy(state)).toContain(CONFIG_DIR);
  });

  test("runs the method, takes the code back, and leaves the conversation alone", async () => {
    const running = await open("signed-out-open-agent.ts");
    await waitFor(running, (one) => one.signIn !== null, "nothing was offered");
    const signing = running.harness.signIn("console-login");
    // THE URL REACHES THE PANEL as the row's own output, streamed out of the
    // command the method handed over. Asserted by PARSING what was printed
    // rather than by looking for the address inside it: a substring test on a
    // URL is the thing that passes for `https://evil.example/?x=https://…`,
    // and CodeQL flags it on sight (`js/incomplete-url-substring-sanitization`)
    // whether or not the string came from a fixture — a test that models a bad
    // check is still a bad check written down.
    await waitFor(
      running,
      (one) => oauthUrlIn(one.signIn?.attempt?.output ?? "") !== null,
      "the sign-in printed no URL",
    );
    const printed = oauthUrlIn(running.harness.state().signIn?.attempt?.output);
    expect(printed?.origin).toBe("https://example.invalid");
    expect(printed?.pathname).toBe("/oauth");
    // ... and the code a person reads off that page goes back down its stdin,
    // which is the half of a paste-a-code login that cannot be skipped.
    await running.harness.signInInput("ABCD-1234");
    expect(await signing).toBe("signed-in");
    const after = running.harness.state();
    // THE CONVERSATION IS THE ONE IT WAS. The session that exists was made by
    // a CLI with no credential and is no more usable than before — which is
    // why the caller restarts; what this end must not do is swap it for
    // another one behind the person's back.
    expect(after.sessionId).toBe("sess-1");
    expect(after.signIn).toBeNull();
  });

  test("signs in over a conversation the agent no longer has, and opens nothing", async () => {
    // THE WHOLE OF THE OWNER'S RUN, in one fixture: a panel that was signed in
    // once, so padi remembers a session id; a CLI that no longer has it; and
    // nobody signed in. The reopen a successful sign-in does used to send that
    // same dead id back down the wire, take the same `Resource not found`, and
    // reach the person as `Sign-in failed` — over an adapter the harness had
    // already torn down.
    const running = await open("signed-out-open-agent.ts", {
      resume: "ba0d0775-2692-4460-ad85-61bec0aeb318",
    });
    // The bring-up's own fall-through: one break, one line, a conversation.
    expect(running.harness.state().sessionId).toBe("sess-1");
    expect(dividers(running).length).toBe(1);
    expect(textOfKind(running, "notice")).toEqual([
      expect.stringContaining("Resource not found") as unknown as string,
    ]);

    await waitFor(running, (one) => one.signIn !== null, "nothing was offered");
    const signing = running.harness.signIn("console-login");
    await waitFor(
      running,
      (one) => oauthUrlIn(one.signIn?.attempt?.output ?? "") !== null,
      "the sign-in printed no URL",
    );
    await running.harness.signInInput("ABCD-1234");
    expect(await signing).toBe("signed-in");

    // WHAT A NEWLY SIGNED-IN PERSON SEES: the conversation the bring-up fell
    // back into, unchanged. Nothing was asked for a second time, so the dead
    // id was never sent again and nothing new was minted to say so.
    const after = running.harness.state();
    expect(after.phase).toBe("idle");
    expect(after.sessionId).toBe("sess-1");
    expect(after.signIn).toBeNull();
    expect(after.refusal).toBeNull();
    expect(dividers(running).length).toBe(1);
    expect(textOfKind(running, "notice").length).toBe(1);
  });

  test("offers it on a refused TURN, for an agent that never said who it is", async () => {
    const running = await open("signed-out-open-agent.ts", {
      args: ["--no-status"],
    });
    expect(running.harness.state().signIn).toBeNull();
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    const state = running.harness.state();
    expect(agentWhy(state)).toContain("Authentication required");
    expect(state.signIn?.methods.map((one) => one.id)).toEqual([
      "console-login",
    ]);
  });

  test("says what was asked and what came back when nothing is offered", async () => {
    // THE HONEST DEAD END. An agent that will not work and advertises no way
    // to fix it gets the whole account — which adapter, what it calls itself,
    // what kolu asked for, and the store it read — rather than a button this
    // end invented, which would run nothing.
    const running = await open("signed-out-open-agent.ts", {
      args: ["--no-methods"],
    });
    await waitFor(
      running,
      (one) => one.signIn !== null,
      "the dead end said nothing",
    );
    const state = running.harness.state();
    expect(state.signIn?.methods).toEqual([]);
    expect(agentWhy(state)).toContain("fixture-agent 0.0.1");
    expect(agentWhy(state)).toContain("offered no way to sign in");
    expect(agentWhy(state)).toContain('_meta["terminal-auth"]');
    expect(agentWhy(state)).toContain(CONFIG_DIR);
  });
});

describe("a person asking to sign in", () => {
  test("opens the row while signed in, with the advertised methods, and closes again untouched", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    const before = running.harness.state();
    expect(before.signIn).toBeNull();

    running.harness.askSignIn();
    const asked = running.harness.state().signIn;
    // A PERSON's row: no refusal to quote, the store the signature is read
    // from, and the methods the handshake advertised.
    expect(asked?.cause).toEqual({
      kind: "person",
      said: expect.stringContaining(CONFIG_DIR) as unknown as string,
    });
    expect(asked?.methods.map((one) => one.id)).toEqual(["subscription"]);
    expect(asked?.attempt).toBeNull();

    // Thought better of: everything is as it was.
    expect(await running.harness.signInCancel()).toBe(true);
    const after = running.harness.state();
    expect(after.signIn).toBeNull();
    expect(after.sessionId).toBe(before.sessionId);
    expect(after.phase).toBe("idle");
  });

  test("a row a person asked for comes down when the conversation is entered again", async () => {
    // The agent has not said anyone is signed out, so entering a conversation
    // answers the row's question the way it answers the agent's own offer: a
    // sign-in row standing over a working conversation is one a person would
    // press for nothing.
    const running = await open("agent.ts");
    running.harness.askSignIn();
    expect(running.harness.state().signIn).not.toBeNull();
    await running.harness.newSession();
    expect(running.harness.state().signIn).toBeNull();
  });

  test("entering a conversation while a sign-in runs keeps the attempt's row drawn", async () => {
    // The one place this differs from before the sign-in row had one owner:
    // entering used to hide the row until the attempt next printed. Now the
    // row an attempt is running in stays, because that is the honest state —
    // the process is still there, waiting for the code a person is typing.
    const running = await open("agent.ts", { args: ["--patient-login"] });
    running.harness.askSignIn();
    const signing = running.harness.signIn("subscription");
    await waitFor(
      running,
      (state) =>
        state.signIn?.attempt?.output.includes("type the code") ?? false,
      "the sign-in never asked for its code",
    );
    await running.harness.newSession();
    expect(running.harness.state().signIn?.attempt?.state).toBe("running");
    await running.harness.signInInput("1234");
    expect(await signing).toBe("signed-in");
    expect(running.harness.state().signIn).toBeNull();
  });

  test("runs a method a person asked for, and the conversation is the same one after", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    running.harness.askSignIn();
    expect(await running.harness.signIn("subscription")).toBe("signed-in");
    const state = running.harness.state();
    expect(state.signIn).toBeNull();
    expect(state.phase).toBe("idle");
    expect(state.sessionId).not.toBeNull();
  });

  test("leaves the person in the conversation they are in, not the one they booted in", async () => {
    // THE DEFECT THIS PINS: a sign-in used to re-enter the conversation out of
    // the id this process was STARTED with. Somebody who had pressed New
    // session and typed in it was put back in the one they had left, and the
    // restart that followed latched that. The harness re-enters nothing; the
    // caller restarts into the session that was live when the button was
    // pressed.
    const running = await open("agent.ts", { resume: "sess-booted" });
    expect(running.harness.state().sessionId).toBe("sess-booted");
    await running.harness.newSession();
    const moved = running.harness.state().sessionId;
    expect(moved).not.toBe("sess-booted");

    running.harness.askSignIn();
    expect(await running.harness.signIn("subscription")).toBe("signed-in");
    expect(running.harness.state().sessionId).toBe(moved);
  });

  test("a Cancel that lost the race to a login that landed answers `signed-in`", async () => {
    // The command exited 0 under the cancel's own SIGTERM, which for every one
    // of these CLIs means the credential store was written. Calling that
    // `cancelled` leaves the caller with no reason to restart, so the running
    // agent keeps the old signature against a store that holds the new one —
    // and nothing on screen says so.
    const running = await open("signed-out-open-agent.ts", {
      args: ["--login-outlives-cancel"],
    });
    await waitFor(running, (one) => one.signIn !== null, "nothing was offered");
    const signing = running.harness.signIn("console-login");
    await waitFor(
      running,
      (one) => oauthUrlIn(one.signIn?.attempt?.output ?? "") !== null,
      "the sign-in printed no URL",
    );

    expect(await running.harness.signInCancel()).toBe(true);
    expect(await signing).toBe("signed-in");
    // The row still comes down — that is what was pressed — and the offer
    // with it, because there is nothing left to sign in to.
    expect(running.harness.state().signIn).toBeNull();
  });

  test("an agent that advertised nothing says so, rather than drawing a button", async () => {
    const running = await open("text-only-agent.ts");
    running.harness.askSignIn();
    const asked = running.harness.state().signIn;
    expect(asked?.methods).toEqual([]);
    expect(asked?.cause).toEqual({
      kind: "person",
      said: expect.stringContaining(
        "offered no way to sign in",
      ) as unknown as string,
    });
  });

  test("a turn refused for the ACCOUNT marks the row so, off the agent's data", async () => {
    const running = await open("agent.ts");
    const { rowId } = await running.harness.prompt(typed("limit", []), false);
    await settled(running, "the refused turn never ended");
    const row = running.rows().find((one) => one.id === rowId);
    expect(row?.kind === "user" ? row.delivery : null).toBe("refused");
    expect(row?.kind === "user" ? row.signIn : null).toBe("account");
    // ... and nothing is forced on screen: the account IS signed in, and
    // waiting for the limit to reset is the other remedy. (A refusal with no
    // such data stays a plain one: "a turn the agent refuses…" above.)
    expect(running.harness.state().signIn).toBeNull();
  });
});

describe("a bring-up nothing can be done about", () => {
  test("publishes the refusal before it throws, and takes the child with it", async () => {
    const states: Array<HarnessState> = [];
    const starting = startHarness<FixtureRow>({
      agent: "fixture-agent",
      leg,
      adapter: {
        command: fixtureAgent("no-such-adapter"),
        args: [],
      },
      cwd: process.cwd(),
      configDir: CONFIG_DIR,
      mcpServers: [],
      teaching: TEACHING,
      taught: false,
      opens: { kind: "fresh" },
      log: silent,
      numbering: "continues",
      readCall,
      whenNewSession: "divide",
      whenLoadRefused: "fresh",
      whenReplayed: "drop",
      onChange: (change) => {
        if (change.kind === "state") states.push(change.state);
      },
    });
    await expect(starting).rejects.toMatchObject({
      name: "HarnessUnavailable",
    });
    // A reader is TOLD. Without this the panel is an idle-looking composer
    // over a host with no agent on it, and the only account of why is in a
    // log nobody reading the panel can see.
    const last = states[states.length - 1];
    expect(last?.phase).toBe("offline");
    expect(last?.refusal).toContain("could not start the agent");
  });

  test("a handshake the agent refuses stops the process it started", async () => {
    // The refusal comes AFTER the spawn, so there is a process to end — and
    // the fixture stays up reading stdin the way a real adapter does, so
    // nothing but this client can end it. One left behind per retry is the
    // leak the boot's `try` exists for.
    const dir = await mkdtemp(path.join(tmpdir(), "acp-harness-initialize-"));
    const pidFile = path.join(dir, "pid");
    try {
      await expect(
        startHarness<FixtureRow>({
          agent: "fixture-agent",
          leg,
          adapter: {
            command: process.execPath,
            args: [fixtureAgent("refused-initialize-agent.ts"), pidFile],
          },
          cwd: process.cwd(),
          configDir: CONFIG_DIR,
          mcpServers: [],
          teaching: TEACHING,
          taught: false,
          opens: { kind: "fresh" },
          log: silent,
          numbering: "continues",
          readCall,
          whenNewSession: "divide",
          whenLoadRefused: "fresh",
          whenReplayed: "drop",
          onChange: () => {},
        }),
      ).rejects.toMatchObject({ name: "HarnessRefused" });
      const pid = Number(await readFile(pidFile, "utf8"));
      // `kill(pid, 0)` asks only whether the process exists. The stop has
      // already been awaited by the time the boot rejects.
      expect(() => process.kill(pid, 0)).toThrow(
        expect.objectContaining({ code: "ESRCH" }),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the settings a conversation advertises", () => {
  test("offers every one of them, with the model FIRST and marked", async () => {
    // The four the pinned adapter really sends. The MODEL row used to be
    // pulled out of this list and kept only for the header's reading, which is
    // how a panel came to say "Opus 5.5" over a popover with MODE, EFFORT and
    // FAST MODE in it and no way to change the model at all.
    const running = await open("agent.ts");
    const options = running.harness.state().options;
    expect(options.map((one) => [one.id, one.kind])).toEqual([
      ["model", "model"],
      ["mode", "choice"],
      ["effort", "choice"],
      ["fast", "boolean"],
    ]);
    // ... and it is still the row the header reads its name and its size off.
    expect(running.harness.state().model).toEqual({
      id: "default",
      name: "Default",
      window: 200_000,
    });
    expect(options[0]?.choices.map((one) => one.value)).toEqual([
      "default",
      "sonnet",
      "haiku",
    ]);
    // A BOOLEAN OFFERS NO ROWS — its value is the whole control, which is what
    // a popover that only knew how to draw rows rendered as a heading with
    // nothing under it.
    expect(options.find((one) => one.id === "fast")).toMatchObject({
      value: "false",
      choices: [],
    });
    // The effort row keeps its own rows and its own description: a panel that
    // filtered by category would have lost it with the model.
    expect(options.find((one) => one.id === "effort")?.choices).toHaveLength(4);
  });

  test("a grouped picker offers its leaves and not its headings", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("groups", []), false);
    await settled(running, "the turn never ended");
    // ACP lets a select sort its rows under HEADINGS, and a heading is not a
    // value anybody can pick: a picker drawn with them in offers choices this
    // end could not send back, and one that dropped the grouped rows would be
    // missing most of its models.
    const model = running.harness
      .state()
      .options.find((one) => one.id === "model");
    expect(model?.kind).toBe("model");
    expect(model?.choices.map((one) => one.value)).toEqual([
      "sonnet",
      "haiku",
      "default",
    ]);
    expect(running.harness.state().model?.id).toBe("sonnet");
  });

  test("the picker the real adapter sent keeps every row, the new model included", async () => {
    // THE PAYLOAD IS A RECORDING, not a shape this file invented: one live
    // session's `configOptions` off the pinned adapter, pasted into
    // `@kolu/acp-client`'s `fixtures/agent.ts` as `RECORDED`. What made it worth recording is
    // `claude-fable-5-2` — a model the conductor's picker did not offer
    // while the adapter drove the CLI bundled in the Claude Agent SDK, whose
    // own picker has five rows and no Fable 5.2 at all. The fix was the floor
    // (`nix/packages/acp-adapter.nix` now drives agent-distro's `claude`), and
    // this is the half of it that can be asserted without a real CLI: nothing
    // between the wire and the panel drops a row because it does not
    // recognise its id.
    const running = await open("agent.ts");
    await running.harness.prompt(typed("recorded", []), false);
    await settled(running, "the turn never ended");
    const model = running.harness
      .state()
      .options.find((one) => one.id === "model");
    expect(model?.kind).toBe("model");
    // Every row the recording carries, in its order — a count rather than one
    // `toContain`, because a reading that offered only the ids it knew would
    // pass the narrower assertion and still be the bug.
    expect(model?.choices).toHaveLength(14);
    expect(
      model?.choices.find((one) => one.value === "claude-fable-5-2"),
    ).toEqual({
      value: "claude-fable-5-2",
      label: "Fable 5.2",
      hint: "For your toughest challenges",
    });
    // ... and the header NAMES it rather than printing the id back, off the
    // same payload: the live model the agent forwards is the new row.
    expect(running.harness.state().model).toEqual({
      id: "claude-fable-5-2",
      name: "Fable 5.2",
      window: 200_000,
    });
    // The rows beside it survive the recording's own shapes — `_meta` on every
    // mode row, six effort levels, and a `fast` the real adapter sends as a
    // SELECT rather than as the boolean this fixture's own settings send.
    expect(running.harness.state().options.map((one) => one.id)).toEqual([
      "model",
      "mode",
      "effort",
      "fast",
    ]);
  });

  test("a switch goes out as a boolean, not as the word for one", async () => {
    // `session/set_config_option` carries a select's value as the row's own id
    // and a boolean as `{type: "boolean", value: true}`; the pinned adapter
    // refuses the string `"true"` outright. padi's wire stays strings — this
    // end is the one that read the advertisement and knows which is which.
    const running = await open("agent.ts");
    await running.harness.setOption("fast", "true");
    expect(
      running.harness.state().options.find((one) => one.id === "fast")?.value,
    ).toBe("true");
    // ... and a word that is neither is refused HERE, before the wire.
    await expect(
      running.harness.setOption("fast", "maybe"),
    ).rejects.toMatchObject({
      name: "HarnessRefused",
      why: expect.stringContaining("takes `true` or `false`"),
    });
  });
});

describe("what a prompt can carry besides words", () => {
  test("an image arrives as an `image` block with its bytes intact", async () => {
    const running = await open("agent.ts");
    const shot = await picture();
    await running.harness.prompt(typed("look at this", [shot]), false);
    await settled(running, "the turn never ended");

    // WHAT CROSSED THE PIPE, asked of the only process that knows — and the
    // base64 came off the FILE, which is the only copy there is: the bytes
    // cannot ride the `prompt` frame.
    const [sent] = (await asked(running, "blocks")) as ReadonlyArray<
      ReadonlyArray<Record<string, unknown>>
    >;
    expect(sent?.[0]).toMatchObject({ type: "text" });
    expect(sent?.[1]).toEqual({
      type: "image",
      data: PNG,
      mimeType: "image/png",
    });

    // ... and the row a reader draws carries the attachment it was handed,
    // whole. It is the SAME shape a restored row has — a name, a size and a
    // path — which is what makes "send again" on an old message work.
    const row = running.rows().find((one) => one.kind === "user");
    expect(row?.kind === "user" ? row.attachments : null).toEqual([shot]);
  });

  test("a restored row's path is all the harness needs", async () => {
    // A row read back out of padi's store carries no bytes and never did.
    // The harness that wanted a `data:` URL refused every retry of an old
    // message with a sentence about missing bytes; this is that retry.
    const running = await open("agent.ts", { resume: "sess-1", resumedSeq: 9 });
    const restored = await written(
      {
        id: "att-old",
        name: "yesterday.png",
        mimeType: "image/png",
        bytes: 68,
      },
      Buffer.from(PNG, "base64"),
    );
    await running.harness.prompt(typed("again", [restored]), false);
    await settled(running, "the turn never ended");
    const [sent] = (await asked(running, "blocks")) as ReadonlyArray<
      ReadonlyArray<Record<string, unknown>>
    >;
    expect(sent?.[1]).toMatchObject({ type: "image", data: PNG });
  });

  test("a file that is gone is a refusal naming it, not a crash", async () => {
    // The attachment was swept, or the state root moved. A read that threw
    // inside the protocol callback would be a turn failing with node's own
    // `ENOENT` sentence; a person is told which file instead.
    const running = await open("agent.ts");
    const shot = await picture();
    await rm(shot.path);
    await expect(
      running.harness.prompt(typed("look at this", [shot]), false),
    ).rejects.toMatchObject({
      name: "HarnessRefused",
      why: expect.stringContaining("shot.png"),
    });
    expect(running.rows()).toEqual([]);
  });

  test("a text file arrives as a `resource` with its text embedded", async () => {
    const running = await open("agent.ts");
    const notes = await written(
      {
        id: "att-2",
        name: "notes.txt",
        // WITH ITS PARAMETERS, which is how a browser hands one over: a rule
        // that compared the whole string would send the commonest text file
        // there is as an opaque link.
        mimeType: "text/plain;charset=utf-8",
        bytes: 11,
      },
      Buffer.from("hello there"),
    );
    await running.harness.prompt(typed("read this", [notes]), false);
    await settled(running, "the turn never ended");
    const [sent] = (await asked(running, "blocks")) as ReadonlyArray<
      ReadonlyArray<Record<string, unknown>>
    >;
    expect(sent?.[1]).toEqual({
      type: "resource",
      resource: {
        uri: `file://${notes.path}`,
        mimeType: "text/plain",
        text: "hello there",
      },
    });
  });

  test("anything else arrives as a `resource_link` naming the path padi wrote", async () => {
    const running = await open("agent.ts");
    const report = await written(
      {
        id: "att-3",
        name: "report.pdf",
        mimeType: "application/pdf",
        bytes: 2048,
      },
      Buffer.alloc(2048),
    );
    await running.harness.prompt(typed("and this", [report]), false);
    await settled(running, "the turn never ended");
    const [sent] = (await asked(running, "blocks")) as ReadonlyArray<
      ReadonlyArray<Record<string, unknown>>
    >;
    // The ABSOLUTE path on the host the agent is running on, which is the only
    // one that exists for it: an agent with a shell can go and read it, and
    // every agent must accept the block whether it can or not. The bytes stay
    // on disk — a link is not an embed.
    expect(sent?.[1]).toEqual({
      type: "resource_link",
      uri: `file://${report.path}`,
      name: "report.pdf",
      mimeType: "application/pdf",
      size: 2048,
    });
  });

  test("an image an agent never advertised for is refused with a sentence", async () => {
    // ACP makes the image block opt-in at the AGENT's end. Sending one anyway
    // is a turn that fails somewhere inside the agent with a sentence nobody
    // wrote for a person; the refusal names the capability instead.
    const running = await open("text-only-agent.ts");
    await expect(
      running.harness.prompt(typed("look at this", [await picture()]), false),
    ).rejects.toMatchObject({
      name: "HarnessRefused",
      why: expect.stringContaining("`image`"),
    });
    // NOTHING WAS DRAWN and nothing went out: a person's message is still
    // theirs to send, with a sentence saying why.
    expect(running.rows()).toEqual([]);
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    expect(textOfKind(running, "agent")).toEqual(["text is all I take"]);
  });

  test("too much is refused with a sentence naming the limit", async () => {
    const running = await open("agent.ts");
    await expect(
      running.harness.prompt(
        typed("huge", [await picture({ bytes: 11 * 1024 * 1024 })]),
        false,
      ),
    ).rejects.toMatchObject({
      name: "HarnessRefused",
      why: expect.stringContaining("10 MiB"),
    });
    // ... and the whole message has a limit of its own, which three legal
    // attachments can pass. The SIZE is padi's reading of what it wrote, not
    // the file under it — the cap is checked before a byte is read.
    await expect(
      running.harness.prompt(
        typed("huge", [
          await picture({ id: "a", bytes: 9 * 1024 * 1024 }),
          await picture({ id: "b", bytes: 9 * 1024 * 1024 }),
          await picture({ id: "c", bytes: 9 * 1024 * 1024 }),
        ]),
        false,
      ),
    ).rejects.toMatchObject({
      name: "HarnessRefused",
      why: expect.stringContaining("20 MiB"),
    });
    expect(running.rows()).toEqual([]);
  });
});

describe("the break that says the agent's memory was reset", () => {
  test("a death and the harness that replaces it mint none", async () => {
    const first = await open("agent.ts");
    await first.harness.prompt(typed("hello", []), false);
    await settled(first, "the first turn never ended");
    // The adapter crashes mid-turn, which is the ending nobody asked for.
    await first.harness.prompt(typed("die", []), false);
    await dead(first);
    expect(first.rows().filter((one) => one.kind === "divider")).toEqual([]);

    // ... and padi's answer to a corpse: a REPLACEMENT over the rows it is
    // still holding, resuming the conversation the dead one was in. Nothing
    // about either is a reset of the agent's memory, and a divider that said
    // so would be a lie told once per crash.
    const second = await open("agent.ts", {
      resume: "sess-1",
      resumedSeq: 12,
    });
    await second.harness.prompt(typed("hello", []), false);
    await settled(second, "the turn never ended");
    expect(second.rows().filter((one) => one.kind === "divider")).toEqual([]);
  });

  test("`newSession` mints exactly one, however many times it is asked", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the first turn never ended");
    // FOUR, which is what the owner's screenshot had: a caller retrying a verb
    // nobody pressed twice, and four `— NEW SESSION —` lines with no
    // conversation between them. A second break says exactly what the first
    // one says.
    await running.harness.newSession();
    await running.harness.newSession();
    await running.harness.newSession();
    await running.harness.newSession();
    expect(dividers(running)).toHaveLength(1);

    // ... and once something has been said, a break means something again.
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the second turn never ended");
    await running.harness.newSession();
    expect(dividers(running)).toHaveLength(2);
  });

  test("the conversation being left is closed at the agent, not just dropped", async () => {
    // AN AGENT THAT HOLDS A PROCESS PER CONVERSATION, which is what the pinned
    // Claude adapter is: its SDK `query()` spawns a `claude` CLI when the
    // session is made and nothing but `session/close` ever ends it. The
    // fixture's children are real forks, so `live` below is a count of
    // processes rather than of bookkeeping.
    const running = await open("subprocess-agent.ts");

    // TWO CONSECUTIVE PROMPTS LEAVE EXACTLY ONE. A turn is not a session: the
    // conversation's process is spawned once, at the open, and the second
    // prompt rides the one that is already there.
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the first turn never ended");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the second turn never ended");
    expect(await asked(running, "children")).toEqual({ live: 1, closed: [] });

    // ... and a SECOND conversation REPLACES the first rather than stacking on
    // it: the id just left is named in a `session/close`, and the process it
    // was holding is gone before the new one is opened. Without that close the
    // count here was two — and five on the padi where this was found, one per
    // `— NEW SESSION —` anybody had ever pressed, at ~35% CPU each.
    await running.harness.newSession();
    expect(await asked(running, "children")).toEqual({
      live: 1,
      closed: ["sess-1"],
    });
  });

  test("a break for a conversation that would not open comes back out", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the first turn never ended");
    await running.harness.prompt(typed("die", []), false);
    await dead(running);
    // The verb was asked for and the conversation did not open, so the agent's
    // memory was not reset into anything: the mark is withdrawn rather than
    // left standing for the next attempt to stack on.
    await expect(running.harness.newSession()).rejects.toMatchObject({
      name: "HarnessUnavailable",
    });
    expect(dividers(running)).toEqual([]);
  });

  test("a respawned harness knows padi's last row was one", async () => {
    // The rule is about what a READER sees, and a reader sees padi's rows and
    // this instance's together. A replacement builds a fresh transcript, so
    // without the seed `newSession` straight after a respawn minted a second
    // `— NEW SESSION —` beside the one padi is already holding — once per
    // replacement, until the next daemon read collapsed them.
    const running = await open("agent.ts", {
      resume: "sess-1",
      resumedSeq: 12,
      resumedEndsWithDivider: true,
    });
    await running.harness.newSession();
    expect(dividers(running)).toEqual([]);

    // ... and once something has been said here, the seed is spent: a break
    // after a conversation means what it says again.
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    await running.harness.newSession();
    expect(dividers(running)).toHaveLength(1);
  });
});

describe("the wipe that deletes the conversation (`clearSession`)", () => {
  test("forgets the calls, so the next conversation's draw their cards", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("kolu", []), false);
    await settled(running, "the first turn never ended");
    expect(running.rows().filter((one) => one.kind === "tool")).toHaveLength(1);
    const left = running.harness.state().sessionId;

    // A ROW THE CALLER HOLDS AND THIS HARNESS NEVER MINTED goes with it: padi
    // read it out of its store at boot, and a wipe that left it standing
    // would be a conversation that comes back.
    await running.harness.clearSession(["user:restored"]);
    expect(running.rows()).toEqual([]);
    // ... and the agent's memory really was reset: a new conversation, not the
    // one just emptied.
    expect(running.harness.state().sessionId).not.toBe(left);

    // THE SAME CALL ID AGAIN, which is what the next conversation does: ids
    // are numbered inside a session and the next session starts at one. While
    // the wipe lived at the caller, this row was "a repeat" of something only
    // the harness was still holding — so nothing was published, and a panel a
    // person had just emptied stayed empty through a turn that really ran.
    await running.harness.prompt(typed("kolu", []), false);
    await settled(running, "the second turn never ended");
    expect(running.rows().filter((one) => one.kind === "tool")).toHaveLength(1);
  });

  test("leaves nothing for a break to divide", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    await running.harness.clearSession([]);
    // The wipe mints no break of its own, and the break beside it mints none
    // over the emptiness it left: a rule drawn between nothing and nothing.
    expect(dividers(running)).toEqual([]);
    await running.harness.newSession();
    expect(dividers(running)).toEqual([]);
  });

  test("a conversation that would not open keeps the rows", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    await running.harness.prompt(typed("die", []), false);
    await dead(running);
    // The rows go LAST, after the next conversation is open: a wipe that ran
    // anyway would have traded a transcript for a failure.
    await expect(running.harness.clearSession([])).rejects.toMatchObject({
      name: "HarnessUnavailable",
    });
    expect(running.rows().length).toBeGreaterThan(0);
  });
});

/** One nested reading of a handshake, by key — the two advertisements a
 *  steering leg is drawn from both sit several objects deep, and a chain of
 *  casts at each call site is three places for one spelling to drift. */
const flag = (value: unknown, ...keys: ReadonlyArray<string>): unknown =>
  keys.reduce<unknown>((held, key) => meta(held)?.[key], value);

/** A leg that STEERS, over the same fixture agent.
 *
 *  The pinned Claude leg's own values (`STEER_METHOD`, `STEER_WHEN_IDLE`,
 *  `steerTaken`, `STEERING_ADVERTISED`, `QUEUES_WHEN_BUSY` in
 *  `packages/acp-claude/src/leg.ts`) rather than invented
 *  ones: a test that agreed with a spelling nothing ships would pass over an
 *  agent kolu cannot actually steer. The timeout is the one thing shortened —
 *  a deadline is what a *silent* agent costs this suite, and nothing here is
 *  silent. */
const steersLeg: Leg = {
  ...leg,
  steering: {
    method: "_session/steering",
    meta: { steering: { idleBehavior: "promptRequired" } },
    timeout: "5 seconds",
    taken: (answered) => flag(answered, "outcome") === "injected",
    advertised: (initialized) =>
      flag(initialized, "_meta", "steering", "supported") === true,
  },
  queues: (initialized) =>
    flag(
      initialized,
      "agentCapabilities",
      "_meta",
      "claudeCode",
      "promptQueueing",
    ) === true,
};

/** Every body this process was handed through `_session/steering` — the only
 *  record that a steer really LANDED, since a taken steer sends nothing back
 *  down the session stream. */
const steeredInto = async (running: Running): Promise<ReadonlyArray<string>> =>
  (await asked(running, "steered")) as ReadonlyArray<string>;

/** The row that message was minted as. */
const rowOf = (running: Running, id: string): FixtureRow => {
  const found = running.rows().find((row) => row.id === id);
  if (found === undefined) throw new Error(`no row ${id}`);
  return found;
};

describe("putting a message INTO the turn that is running", () => {
  test("a steer while a turn runs reaches that turn, and starts none of its own", async () => {
    const running = await open("agent.ts", { leg: steersLeg });
    expect(running.harness.state().steers).toBe(true);
    // The fixture holds `slow` open until a second PROMPT arrives — a steer is
    // not one, so the turn is still running underneath the one below.
    await running.harness.prompt(typed("slow", []), false);
    const steer = await running.harness.prompt(
      typed("actually, the other branch", []),
      true,
    );

    // NOT QUEUED: the words are in the turn the agent is working on, so there
    // is no second turn to be behind. A `queued` mark here would be the panel
    // telling a person their message is waiting for something that already
    // has it.
    const row = rowOf(running, steer.rowId);
    expect(row.kind).toBe("user");
    expect(row.kind === "user" ? row.queued : "n/a").toBeUndefined();
    expect(row.kind === "user" ? row.delivery : "n/a").toBeUndefined();
    // ... and the latch is unspent: a steer is not a message held behind a
    // turn, which is the whole difference between the two lanes.
    expect(running.harness.state().steers).toBe(true);

    // THE PROCESS AT THE OTHER END is the only witness that it landed.
    expect(await steeredInto(running)).toEqual(["actually, the other branch"]);
  });

  test("a steer that carries FILES goes as a plain prompt, files and all", async () => {
    const running = await open("agent.ts", { leg: steersLeg });
    const shot = await picture();
    await running.harness.prompt(typed("slow", []), false);
    // Alt+Enter with a picture in the composer. A steer carries ONE text
    // block, so taking this one would have delivered the words and dropped
    // the picture — silently, with a chip still on screen saying it went.
    const sent = await running.harness.prompt(
      typed("look at this", [shot]),
      true,
    );
    await settled(running, "the turn carrying the picture never ended");

    // Nothing was steered ...
    expect(await steeredInto(running)).toEqual([]);
    // ... and the picture crossed the pipe with the words, as an ordinary
    // prompt's blocks.
    const blocks = (await asked(running, "blocks")) as ReadonlyArray<
      ReadonlyArray<Record<string, unknown>>
    >;
    const carried = blocks.find((one) =>
      one.some((block) => block.type === "image"),
    );
    expect(carried?.[0]).toMatchObject({ type: "text" });
    expect(carried?.[1]).toEqual({
      type: "image",
      data: PNG,
      mimeType: "image/png",
    });
    const row = rowOf(running, sent.rowId);
    expect(row.kind === "user" ? row.attachments : null).toEqual([shot]);
  });

  test("a steer with NOTHING RUNNING is an ordinary prompt", async () => {
    const running = await open("agent.ts", { leg: steersLeg });
    // Alt+Enter with an idle conversation: there is no turn to put words in,
    // so the gesture costs nothing and the message goes the way every message
    // goes. The agent is never asked — a steer into nothing is a turn the
    // adapter would start behind kolu's back.
    const sent = await running.harness.prompt(typed("hello", []), true);
    await settled(running, "the steered-while-idle turn never ended");

    const row = rowOf(running, sent.rowId);
    expect(row.kind === "user" ? row.queued : "n/a").toBeUndefined();
    expect(textOfKind(running, "agent")).toEqual(["hello back"]);
    expect(await steeredInto(running)).toEqual([]);
  });

  test("a steer into a turn SOMEBODY STOPPED keeps the words, and sends nothing", async () => {
    const running = await open("agent.ts", { leg: steersLeg });
    await running.harness.prompt(typed("slow", []), false);
    // THE ORDER IS THE SUBJECT, and it is deterministic: `cancel()` marks every
    // ticket stopped synchronously and writes the cancel first, the steer is
    // composed in the same tick (nothing it awaits touches the pipe) and is
    // written second, and the fixture reads one line at a time — so it ends
    // the turn and then answers *nothing to steer*.
    const stopping = running.harness.cancel();
    const steer = await running.harness.prompt(
      typed("while you are there, check the lock file", []),
      true,
    );
    await stopping;
    await settled(running, "the cancelled turn never ended");

    // REFUSED, not re-sent: starting a fresh turn with these words would be
    // this end un-cancelling on the person's behalf. The row keeps them, and
    // the notice says why they did not go.
    const row = rowOf(running, steer.rowId);
    expect(row.kind === "user" ? row.delivery : "n/a").toBe("refused");
    expect(textOfKind(running, "notice")).toContain(
      "the turn these words were steered into was cancelled, so they were not sent",
    );
    // Neither lane took them: not into the turn, and not as a prompt of their
    // own.
    expect(await steeredInto(running)).toEqual([]);
    const bodies = (await asked(running, "prompts")) as ReadonlyArray<string>;
    expect(
      bodies.filter((body) => body.includes("check the lock file")),
    ).toEqual([]);
  });

  test("one message sent while busy spends the steer for the rest of the session", async () => {
    const running = await open("agent.ts", { leg: steersLeg });
    await running.harness.prompt(typed("slow", []), false);
    // The ordinary lane, behind a running turn — which is what poisons a
    // steer into this session at the pinned adapter, so the gesture is
    // withdrawn from this conversation from here on.
    await running.harness.prompt(typed("hello", []), false);
    expect(running.harness.state().steers).toBe(false);
    await settled(running, "the queued turn never ended");
    expect(running.harness.state().steers).toBe(false);

    // ... and ASKING for one anyway is an ordinary prompt rather than a
    // request the agent is made to answer.
    await running.harness.prompt(typed("slow", []), false);
    const asking = await running.harness.prompt(
      typed("and another thing", []),
      true,
    );
    const queued = rowOf(running, asking.rowId);
    expect(queued.kind === "user" ? queued.queued : "n/a").toBe(true);
    await settled(running, "the second queued turn never ended");
    expect(await steeredInto(running)).toEqual([]);

    // A NEW SESSION CLEARS IT: the latch is about the conversation the adapter
    // poisoned, and that one is over.
    await running.harness.newSession();
    expect(running.harness.state().steers).toBe(true);
  });

  test("an agent that advertises nothing offers no steer at all", async () => {
    // The default leg of this file reads no steering out of the handshake,
    // which is what a leg for an agent without the extension looks like. The
    // fixture advertises it either way: what is under test is that the
    // composer's bit comes off the LEG's reading and not off the agent's
    // enthusiasm.
    const running = await open("agent.ts");
    expect(running.harness.state().steers).toBe(false);
  });
});

describe("the clock a reader counts “working · 2m” from", () => {
  test("starts with the FIRST turn in flight and stops with the last", async () => {
    const running = await open("agent.ts");
    expect(running.harness.state().busySince).toBe(null);

    await running.harness.prompt(typed("slow", []), false);
    const started = running.harness.state().busySince;
    expect(started).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // A message sent behind a running turn does not restart the stopwatch on
    // work that has been going for a minute.
    await running.harness.prompt(typed("hello", []), false);
    expect(running.harness.state().busySince).toBe(started);

    await settled(running, "the turns never ended");
    expect(running.harness.state().busySince).toBe(null);
  });
});

/** The fixture product's row for a turn the HOST started: who rang, and what
 *  it says. A product's own word, which is the whole point — this package
 *  knows the row only as content it was handed. */
const rung = (
  text: string,
  rang: ReadonlyArray<string> = ["local/one"],
): RowContent<FixtureRow> => ({ kind: "rung", text, rang });

describe("a turn this end started — nobody typed it", () => {
  test("mints the caller's own row and sends the words under it", async () => {
    const running = await open("agent.ts");
    const rang = ["local/one", "local/two"];
    const { rowId } = await running.harness.hostTurn(
      rung("two terminals need you", rang),
      "two terminals need you",
    );
    await settled(running, "the host turn never ended");

    const row = rowOf(running, rowId);
    expect(row.kind).toBe("rung");
    if (row.kind !== "rung") throw new Error("the host row went missing");
    expect(row.text).toBe("two terminals need you");
    // THE CONTENT IS COPIED AND NEVER READ: the product's own fields arrive on
    // the row exactly as they were handed over.
    expect(row.rang).toEqual(rang);
    // ... and the agent answered it like any other turn.
    expect(textOfKind(running, "agent")).toEqual(["hello back"]);
    // Whose words they are is the row's kind and nothing else: what crossed
    // the pipe is an ordinary prompt carrying the standing prompt.
    const bodies = (await asked(running, "prompts")) as ReadonlyArray<string>;
    expect(bodies[0]).toBe(`${TEACHING}\n\ntwo terminals need you`);
  });

  test("refused for want of a signature, it takes the mark and not the door", async () => {
    // THE ROW KIND THAT CANNOT CARRY A SIGN-IN REASON. A turn this end started
    // is nobody's message to send again — this product's row for one has
    // `delivery` and no `signIn` — so a refusal that offers a sign-in door
    // must offer it nowhere here. The harness asks the row's kind before it
    // passes the mark (`refusalMark`); the strict decode in `open` is what
    // would catch it if it stopped asking.
    const running = await open("agent.ts");
    const { rowId } = await running.harness.hostTurn(rung("locked"), "locked");
    await settled(running, "the refused host turn never ended");

    const row = rowOf(running, rowId);
    if (row.kind !== "rung") throw new Error("the host row went missing");
    expect(row.delivery).toBe("refused");
    expect(row).not.toHaveProperty("signIn");
  });

  test("waits behind a running turn with the mark a person's message takes", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("slow", []), false);
    const { rowId } = await running.harness.hostTurn(
      rung("a terminal stopped"),
      "a terminal stopped",
    );
    const waiting = rowOf(running, rowId);
    expect(waiting.kind === "rung" ? waiting.queued : "n/a").toBe(true);

    await settled(running, "the queued host turn never ended");
    const taken = rowOf(running, rowId);
    expect(taken.kind === "rung" ? taken.queued : "n/a").toBeUndefined();
  });

  test("ends under a cancel the way a person's turn does", async () => {
    const running = await open("agent.ts");
    // `slow` as the WORDS: the fixture reads the last line of the body, so a
    // turn this end started can hold its turn open exactly as a prompt can —
    // which is the only way to have a cancel land on one.
    const { rowId } = await running.harness.hostTurn(rung("slow"), "slow");
    expect(running.harness.state().busySince).not.toBe(null);

    await running.harness.cancel();
    await settled(running, "the cancelled host turn never ended");
    expect(textOfKind(running, "notice")).toContain("the turn was cancelled");
    expect(running.harness.state().busySince).toBe(null);
    // The row is still the caller's own, and it is not left claiming to be
    // waiting for a turn nothing is going to run.
    const row = rowOf(running, rowId);
    expect(row.kind === "rung" ? row.queued : "n/a").toBeUndefined();
  });
});

describe("the standing prompt around a compaction", () => {
  const compacts = ({ used }: { readonly used: number }): boolean =>
    used >= 200_000;

  const send = async (running: Running, text: string): Promise<void> => {
    await running.harness.prompt(typed(text, []), false);
    await settled(running, `the \`${text}\` turn never ended`);
  };

  /** Which of the messages sent so far carried the standing prompt. */
  const taughtSoFar = async (
    running: Running,
  ): Promise<ReadonlyArray<boolean>> => {
    const bodies = (await asked(running, "prompts")) as ReadonlyArray<string>;
    return bodies.map((body) => body.startsWith(TEACHING));
  };

  test("a message sent past the limit is taught, and only that one while nothing compacts", async () => {
    const running = await open("agent.ts", { compacts });
    await send(running, "used 250000");
    await send(running, "hello");
    await send(running, "hello");
    expect(await taughtSoFar(running)).toEqual([true, true, false]);
  });

  test("the compaction that message sets off leaves the rules where they are", async () => {
    const seen: Array<Compaction> = [];
    const running = await open("agent.ts", {
      compacts,
      onCompaction: (compaction) => seen.push(compaction),
    });
    await send(running, "used 250000");
    await send(running, "compact");
    expect(running.harness.state().taught).toBe(true);
    await send(running, "hello");
    expect(await taughtSoFar(running)).toEqual([true, true, false]);
    expect(seen.map(({ status, teaching }) => [status, teaching])).toEqual([
      ["in_progress", null],
      ["in_progress", null],
      ["in_progress", null],
      ["completed", "sent"],
      ["completed", "sent"],
    ]);
    expect(seen.at(-1)?.summary).toBe(
      "Two works are open. Nothing waits on you.",
    );
  });

  test("a compaction nobody saw coming sends the rules with the next message", async () => {
    const seen: Array<Compaction> = [];
    const running = await open("agent.ts", {
      compacts,
      onCompaction: (compaction) => seen.push(compaction),
    });
    await send(running, "used 1000");
    await send(running, "compactLate");
    expect(running.harness.state().taught).toBe(false);
    expect(seen.at(-1)).toMatchObject({
      status: "completed",
      teaching: "next",
      summary: "The turn was half done.",
    });
    await send(running, "hello");
    expect(await taughtSoFar(running)).toEqual([true, false, true]);
  });

  test("a compaction that failed after the rules rode its message does not send them again", async () => {
    const running = await open("agent.ts", { compacts });
    await send(running, "used 250000");
    await send(running, "compactFails");
    await send(running, "hello");
    expect(await taughtSoFar(running)).toEqual([true, true, false]);
  });

  test("a compaction that failed changes nothing", async () => {
    const seen: Array<Compaction> = [];
    const running = await open("agent.ts", {
      compacts,
      onCompaction: (compaction) => seen.push(compaction),
    });
    await send(running, "used 1000");
    await send(running, "compactFails");
    expect(seen.at(-1)).toMatchObject({
      status: "failed",
      teaching: null,
      error: "the summary request was refused (overloaded)",
    });
    await send(running, "hello");
    expect(await taughtSoFar(running)).toEqual([true, false, false]);
  });

  test("a loaded session whose usage is not known is taught once, until a reading says it is under the limit", async () => {
    const running = await open("agent.ts", {
      resume: "sess-1",
      resumedSeq: 12,
      taught: true,
      compacts,
      args: ["--quiet-load"],
    });
    expect(running.harness.state().usage).toBeNull();
    await send(running, "used 1000");
    await send(running, "hello");
    await send(running, "used 250000");
    await send(running, "hello");
    expect(await taughtSoFar(running)).toEqual([true, false, false, true]);
  });

  test("a compaction before the first message of a session is answered keeps the rules that message carried", async () => {
    const seen: Array<Compaction> = [];
    const running = await open("agent.ts", {
      compacts,
      onCompaction: (compaction) => seen.push(compaction),
    });
    await send(running, "compact");
    expect(seen.at(-1)).toMatchObject({
      status: "completed",
      teaching: "sent",
    });
    expect(running.harness.state().taught).toBe(true);
    await send(running, "hello");
    expect(await taughtSoFar(running)).toEqual([true, false]);
  });

  test("a new session is taught its first message and not the second, usage or none", async () => {
    const running = await open("agent.ts", { compacts });
    await send(running, "hello");
    await send(running, "hello");
    expect(running.harness.state().usage).toBeNull();
    expect(await taughtSoFar(running)).toEqual([true, false]);
  });
});
