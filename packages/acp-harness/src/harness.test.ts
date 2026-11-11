/**
 * The harness, against a REALLY SPAWNED agent.
 *
 * Every hazard this package exists to handle is a fact about two processes and
 * a pipe — a frame from a session we left, a question still open when a turn is
 * cancelled, a prompt that arrives while the agent is busy — so the fixture is
 * a process ({@link ./fixtures/agent.ts}) rather than a mock of a connection. A
 * mock able to express those races would be the harness written twice.
 *
 * Which is also why this is the `test:daemon` lane: every case here forks a
 * detached process group, and the one `afterEach` below is what guarantees a
 * failing assertion cannot walk away from one.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  type Harness,
  type HarnessChange,
  type HarnessOptions,
  HarnessRefused,
  type HarnessState,
  startHarness,
} from "./harness.ts";
import type { OrchestratorAttachment, OrchestratorRow } from "./rows.ts";

const FIXTURES = path.join(import.meta.dirname, "fixtures");

/** The standing prompt, as DATA — padi's words now
 *  (`packages/padi/src/orchestrator/teaching.ts`), and all this package has to
 *  keep about them is that they ride the first message and no later one. */
const TEACHING = ["[kolu] you are kolu's orchestrator on hostname"];

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
  toolNameIn: (value) => {
    const name = meta(value)?.name;
    return typeof name === "string" ? name : null;
  },
  toolNameOf: () => null,
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
  readonly harness: Harness;
  /** Every row the harness has published, folded the way padi folds them — so
   *  the assertions below are about what a READER sees rather than about the
   *  harness's own copy. */
  readonly rows: () => ReadonlyArray<OrchestratorRow>;
  readonly states: ReadonlyArray<HarnessState>;
}

/** Every harness this file has started, so a failed assertion cannot leave a
 *  detached process group behind — `stop()` is the only thing that closes the
 *  pipe and kills the child, and a test that threw never reached its own. */
const started: Array<Harness> = [];

afterEach(async () => {
  const live = started.splice(0, started.length);
  await Promise.all(live.map((harness) => harness.stop()));
});

const open = async (
  fixture: string,
  extra: {
    resume?: string | null;
    resumedSeq?: number;
    resumedEndsWithDivider?: boolean;
    fleet?: ReadonlyArray<string>;
    model?: string | null;
    leg?: Leg;
    mcpServers?: HarnessOptions["mcpServers"];
  } = {},
): Promise<Running> => {
  const rows = new Map<string, OrchestratorRow>();
  const states: Array<HarnessState> = [];
  const fold = (change: HarnessChange): void => {
    if (change.kind === "state") {
      states.push(change.state);
      return;
    }
    for (const row of change.upserts) rows.set(row.id, row);
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
  const harness = await startHarness({
    leg: extra.leg ?? leg,
    adapter: {
      command: process.execPath,
      args: [path.join(FIXTURES, fixture)],
    },
    cwd: process.cwd(),
    mcpServers: extra.mcpServers ?? [
      { kind: "stdio", name: "kolu", command: "/bin/true", args: [], env: {} },
    ],
    teaching: TEACHING,
    log: silent,
    resume: extra.resume ?? null,
    ...(extra.resumedSeq === undefined ? {} : { resumedSeq: extra.resumedSeq }),
    ...(extra.resumedEndsWithDivider === undefined
      ? {}
      : { resumedEndsWithDivider: extra.resumedEndsWithDivider }),
    ...(extra.fleet === undefined ? {} : { fleet: extra.fleet }),
    ...(extra.model === undefined ? {} : { model: extra.model }),
    onChange: fold,
  });
  started.push(harness);
  return {
    harness,
    rows: () => [...rows.values()].sort((a, b) => a.seq - b.seq),
    states,
  };
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

const textOfKind = (
  running: Running,
  kind: OrchestratorRow["kind"],
): ReadonlyArray<string> =>
  running
    .rows()
    .filter((row) => row.kind === kind)
    .map((row) => ("text" in row ? row.text : ""));

/** What the fixture said back to a question only it can answer — the `servers`,
 *  `meta`, `modes` and `prompts` turns, which report what this process was
 *  TOLD. The last agent row is the answer, parsed. */
const asked = async (running: Running, about: string): Promise<unknown> => {
  await running.harness.prompt(about, [], []);
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

/** One attachment as padi hands it over: a NAME, a size and the PATH the
 *  bytes were written to. Nothing carries base64 on this wire — it cannot
 *  ride the frame — so the file below is the only copy there is. */
const written = async (
  fields: Omit<OrchestratorAttachment, "path">,
  contents: Buffer,
): Promise<OrchestratorAttachment> => {
  const where = path.join(ATTACHMENTS, fields.id);
  await writeFile(where, contents);
  return { ...fields, path: where };
};

/** One pasted image, written out. */
const picture = (
  over: Partial<Omit<OrchestratorAttachment, "path">> = {},
): Promise<OrchestratorAttachment> =>
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

const dividers = (running: Running): ReadonlyArray<OrchestratorRow> =>
  running.rows().filter((one) => one.kind === "divider");

describe("one conversation with a real agent", () => {
  test("a prompt goes out and the answer comes back as one growing row", async () => {
    const running = await open("agent.ts");
    const { rowId } = await running.harness.prompt("hello", [], []);
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
    await running.harness.prompt("hello", [], []);
    await settled(running, "the first turn never ended");
    await running.harness.prompt("hello", [], []);
    await settled(running, "the second turn never ended");
    // What a PERSON typed is what the row says, both times: the teaching rides
    // the wire, not the transcript's record of what they said.
    expect(textOfKind(running, "user")).toEqual(["hello", "hello"]);

    // ... and the WIRE is asked, which is the half that used to pass whether
    // the teaching rode both turns or neither. The fixture kept every body:
    // the first carries the standing prompt above the word, and the second is
    // the word alone.
    const bodies = (await asked(running, "prompts")) as ReadonlyArray<string>;
    expect(bodies[0]).toBe(`${TEACHING.join("\n")}\n\nhello`);
    expect(bodies[0]).toContain("hostname");
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
    await running.harness.prompt("stale", [], []);
    await settled(running, "the turn never ended");
    expect(textOfKind(running, "agent")).toEqual(["live"]);
  });

  test("a new session keeps the history, with a divider between them", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt("hello", [], []);
    await settled(running, "the first turn never ended");
    await running.harness.newSession();
    await running.harness.prompt("hello", [], []);
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

  test("a cancel settles the question the turn was holding, withdrawn", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt("ask", [], []);
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

  test("a prompt sent while the agent is busy is marked queued, and unmarked when taken", async () => {
    const running = await open("agent.ts");
    // The fixture holds `slow` open until a SECOND prompt arrives, so the
    // queue is exercised by the thing that exercises it rather than by a
    // timer: a race this test cannot lose is one it also cannot lie about.
    const first = await running.harness.prompt("slow", [], []);
    const second = await running.harness.prompt("hello", [], []);
    const queued = running.rows().find((row) => row.id === second.rowId);
    expect(queued?.kind === "user" ? queued.queued : undefined).toBe(true);
    expect(first.rowId).not.toBe(second.rowId);

    await settled(running, "the queued turn never ended");
    const taken = running.rows().find((row) => row.id === second.rowId);
    expect(taken?.kind === "user" ? taken.queued : undefined).toBeUndefined();
  });

  test("a background task outlives its turn and its death lands as a notice", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt("background", [], []);
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

    await running.harness.prompt("reap", [], []);
    await settled(running, "the reaping turn never ended");
    expect(textOfKind(running, "notice").join("\n")).toContain(
      "ended (completed)",
    );
    expect(running.harness.state().watching).toEqual([]);
  });

  test("a kolu call is read onto the row as host + terminal, and the terminal joins the fleet", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt("kolu", [], []);
    await settled(running, "the turn never ended");

    const call = running.rows().find((row) => row.kind === "tool");
    expect(call?.kind === "tool" ? call.server : null).toBe("kolu");
    // THE REF IS SPLIT on the way onto the row: a card draws which host and
    // which terminal, and the host key of a remote carries its own `:` and may
    // carry a `/`, which is why the split is at the LAST one and belongs to
    // the fleet's own grammar rather than to this reader.
    expect(call?.kind === "tool" ? call.kolu : null).toEqual({
      kind: "create",
      terminalId: "7f3e0a91-0000-4000-8000-000000000000",
      host: "remote:prod",
      name: "fix-parser",
      cwd: null,
      agent: "claude",
    });
    // ... and the fleet remembers the whole REF, because one conversation
    // covers every host and a bare id names nothing on its own.
    expect(running.harness.state().fleet).toEqual([
      "remote:prod/7f3e0a91-0000-4000-8000-000000000000",
    ]);
  });

  test("a turn the agent refuses marks the row refused and leaves the conversation alive", async () => {
    const running = await open("agent.ts");
    const { rowId } = await running.harness.prompt("fail", [], []);
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
    await fresh.harness.stop();

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
    // that "completed" the union would hand the orchestrator a session with no
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
    await fresh.harness.stop();

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
    await running.harness.prompt("hello", [], []);
    await settled(running, "the turn never ended");
    expect(textOfKind(running, "agent")).toEqual(["hello back"]);
  });

  test("a leg that REQUIRES the mode gets a bring-up that fails loudly", async () => {
    // The other arm of the declaration, for an engine whose work is unsafe
    // without the mode: the open does not happen, the refusal is published,
    // and the subprocess goes with it rather than idling on a host with a
    // conversation nobody may use.
    const states: Array<HarnessState> = [];
    const starting = startHarness({
      leg: { ...leg, bypassMode: "yolo", bypassModeRequired: true },
      adapter: {
        command: process.execPath,
        args: [path.join(FIXTURES, "agent.ts")],
      },
      cwd: process.cwd(),
      mcpServers: [],
      teaching: TEACHING,
      log: silent,
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
    await running.harness.prompt("roster", [], []);
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

    await running.harness.prompt("roster", [], []);
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

    await running.harness.prompt("hello", [], []);
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

  test("comes back with the fleet the caller remembered, and adds to it", async () => {
    // Membership accrues from tool-call frames alone, and a resumed
    // conversation's frames are the replay — dropped. A harness that started
    // empty would publish an empty fleet on its first breath and the caller
    // would write that emptiness back over its own record, so a resumed
    // conversation would forget every terminal it had been working with.
    const remembered = ["local/a1b2c3d4-0000-4000-8000-000000000000"];
    const running = await open("agent.ts", {
      resume: "sess-1",
      resumedSeq: 12,
      fleet: remembered,
    });

    // THE FIRST PUBLISH, not merely the state at the end: it is the one the
    // caller persists, and the one that used to be empty.
    expect(running.states[0]?.fleet).toEqual(remembered);

    await running.harness.prompt("kolu", [], []);
    await settled(running, "the turn never ended");
    // ... and a terminal this visit touches joins what was remembered rather
    // than replacing it.
    expect(running.harness.state().fleet).toEqual([
      ...remembered,
      "remote:prod/7f3e0a91-0000-4000-8000-000000000000",
    ]);
  });
});

describe("an agent nobody is signed in to", () => {
  test("keeps the child, says why, and opens the conversation once signed in", async () => {
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
    expect(offline.signIn?.why).toContain("Authentication required");
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

    // ... and the conversation the refusal cost is open, without anybody
    // asking for it a second time.
    const after = running.harness.state();
    expect(after.phase).toBe("idle");
    expect(after.sessionId).toBe("sess-1");
    expect(after.signIn).toBeNull();
    expect(after.refusal).toBeNull();
  });

  test("a sign-in nobody offers is refused, and the harness stays up", async () => {
    const running = await open("signed-out-agent.ts");
    await expect(running.harness.signIn("api-key")).rejects.toBeInstanceOf(
      HarnessRefused,
    );
    expect(running.harness.alive()).toBe(true);
  });
});

describe("a bring-up nothing can be done about", () => {
  test("publishes the refusal before it throws, and takes the child with it", async () => {
    const states: Array<HarnessState> = [];
    const starting = startHarness({
      leg,
      adapter: {
        command: path.join(FIXTURES, "no-such-adapter"),
        args: [],
      },
      cwd: process.cwd(),
      mcpServers: [],
      teaching: TEACHING,
      log: silent,
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
    await running.harness.prompt("groups", [], []);
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
    // `fixtures/agent.ts` as `RECORDED`. What made it worth recording is
    // `claude-fable-5-2` — a model the orchestrator's picker did not offer
    // while the adapter drove the CLI bundled in the Claude Agent SDK, whose
    // own picker has five rows and no Fable 5.2 at all. The fix was the floor
    // (`nix/packages/acp-adapter.nix` now drives agent-distro's `claude`), and
    // this is the half of it that can be asserted without a real CLI: nothing
    // between the wire and the panel drops a row because it does not
    // recognise its id.
    const running = await open("agent.ts");
    await running.harness.prompt("recorded", [], []);
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
    await running.harness.prompt("look at this", [], [shot]);
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
    await running.harness.prompt("again", [], [restored]);
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
      running.harness.prompt("look at this", [], [shot]),
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
    await running.harness.prompt("read this", [], [notes]);
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
    await running.harness.prompt("and this", [], [report]);
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
      running.harness.prompt("look at this", [], [await picture()]),
    ).rejects.toMatchObject({
      name: "HarnessRefused",
      why: expect.stringContaining("`image`"),
    });
    // NOTHING WAS DRAWN and nothing went out: a person's message is still
    // theirs to send, with a sentence saying why.
    expect(running.rows()).toEqual([]);
    await running.harness.prompt("hello", [], []);
    await settled(running, "the turn never ended");
    expect(textOfKind(running, "agent")).toEqual(["text is all I take"]);
  });

  test("too much is refused with a sentence naming the limit", async () => {
    const running = await open("agent.ts");
    await expect(
      running.harness.prompt(
        "huge",
        [],
        [await picture({ bytes: 11 * 1024 * 1024 })],
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
        "huge",
        [],
        [
          await picture({ id: "a", bytes: 9 * 1024 * 1024 }),
          await picture({ id: "b", bytes: 9 * 1024 * 1024 }),
          await picture({ id: "c", bytes: 9 * 1024 * 1024 }),
        ],
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
    await first.harness.prompt("hello", [], []);
    await settled(first, "the first turn never ended");
    // The adapter crashes mid-turn, which is the ending nobody asked for.
    await first.harness.prompt("die", [], []);
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
    await second.harness.prompt("hello", [], []);
    await settled(second, "the turn never ended");
    expect(second.rows().filter((one) => one.kind === "divider")).toEqual([]);
  });

  test("`newSession` mints exactly one, however many times it is asked", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt("hello", [], []);
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
    await running.harness.prompt("hello", [], []);
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
    await running.harness.prompt("hello", [], []);
    await settled(running, "the first turn never ended");
    await running.harness.prompt("hello", [], []);
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
    await running.harness.prompt("hello", [], []);
    await settled(running, "the first turn never ended");
    await running.harness.prompt("die", [], []);
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
    await running.harness.prompt("hello", [], []);
    await settled(running, "the turn never ended");
    await running.harness.newSession();
    expect(dividers(running)).toHaveLength(1);
  });
});
